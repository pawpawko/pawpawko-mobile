import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { DiceLoader } from '@/components/dice-loader';
import { FlairPill } from '@/components/flair-pill';
import { useAuth } from '@/lib/auth';
import { cacheKeys, readCache, writeCache } from '@/lib/offline-cache';
import { supabase } from '@/lib/supabase';
import { colors, fonts, radius } from '@/lib/theme';

type Binder = {
  id: string;
  name: string;
  description: string | null;
  category: string;
  flair: string;
  sleeve_image_url: string | null;
  _shared?: boolean; // a binder shared WITH me (I'm a co-editor, not the owner)
};

type Category = 'optcg' | 'pokemon';
type Flair = 'trade' | 'wishlist';

const LAST_GAME_KEY = 'pawpaw:lastGame';
const CATEGORIES: { value: Category; label: string }[] = [
  { value: 'optcg', label: 'OPTCG' },
  { value: 'pokemon', label: 'Pokémon' },
];
const FLAIRS: { value: Flair; label: string }[] = [
  { value: 'trade', label: 'Trade' },
  { value: 'wishlist', label: 'Wishlist' },
];

// OPTCG before Pokémon. Within each game, preserve created_at order from the query.
const GAME_ORDER: Category[] = ['optcg', 'pokemon'];
const GAME_LABEL: Record<Category, string> = {
  optcg: 'One Piece TCG',
  pokemon: 'Pokémon',
};

function groupByGame(rows: Binder[]): { game: Category; data: Binder[] }[] {
  const buckets: Record<string, Binder[]> = {};
  for (const r of rows) (buckets[r.category] ??= []).push(r);
  return GAME_ORDER.filter((g) => buckets[g]?.length).map((g) => ({ game: g, data: buckets[g] }));
}

export default function MyBindersScreen() {
  const { session } = useAuth();
  const router = useRouter();
  const scrollRef = useRef<ScrollView>(null);
  const hasLoadedOnce = useRef(false);
  const [rows, setRows] = useState<Binder[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [newOpen, setNewOpen] = useState(false);

  const load = useCallback(
    async (mode: 'initial' | 'focus' | 'pull' = 'focus') => {
      if (!session?.user.id) return;
      const uid = session.user.id;
      if (mode === 'initial') setLoading(true);
      if (mode === 'pull') setRefreshing(true);

      // Instant paint from cache on the first load (also the offline path):
      // own binders + their counts. Shared binders stay online-only.
      if (mode === 'initial' && !hasLoadedOnce.current) {
        const cached = await readCache<{ own: Binder[]; counts: Record<string, number> }>(
          cacheKeys.myBinders(uid),
        );
        if (cached) {
          setRows(cached.own);
          setCounts(cached.counts);
          setLoading(false);
        }
      }

      const fetched = await Promise.all([
        supabase
          .from('binders')
          .select('id,name,description,category,flair,sleeve_image_url')
          .eq('user_id', uid)
          .order('created_at', { ascending: true }),
        supabase.rpc('shared_binders'), // binders shared WITH me
      ]).catch(() => null);
      if (mode === 'initial') setLoading(false);
      if (mode === 'pull') setRefreshing(false);
      if (!fetched) return; // offline / transport error — keep the cached view
      const [ownRes, sharedRes] = fetched;
      hasLoadedOnce.current = true;
      if (ownRes.error) {
        console.warn('binders fetch error', ownRes.error.message);
        return;
      }
      const own = (ownRes.data ?? []) as Binder[];
      const shared = ((sharedRes.data ?? []) as Binder[]).map((b) => ({
        id: b.id,
        name: b.name,
        description: b.description,
        category: b.category,
        flair: b.flair,
        sleeve_image_url: b.sleeve_image_url,
        _shared: true,
      }));
      const binders = [...own, ...shared];
      setRows(binders);
      // Listing counts per binder, in parallel — mirrors the web card's "N listings".
      const entries = await Promise.all(
        binders.map(async (b) => {
          const { count } = await supabase
            .from('listings')
            .select('id', { count: 'exact', head: true })
            .eq('binder_id', b.id);
          return [b.id, count ?? 0] as const;
        }),
      ).catch(() => null);
      if (!entries) return;
      setCounts(Object.fromEntries(entries));
      // Cache OWN binders + their counts for offline (scope: my binders only).
      const ownIds = new Set(own.map((b) => b.id));
      const ownCounts = Object.fromEntries(entries.filter(([bid]) => ownIds.has(bid)));
      void writeCache(cacheKeys.myBinders(uid), { own, counts: ownCounts });
    },
    [session?.user.id],
  );

  useFocusEffect(
    useCallback(() => {
      // First focus = initial load (show DiceLoader). Subsequent focuses do
      // a silent background refresh so switching tabs doesn't flash a
      // RefreshControl spinner.
      load(hasLoadedOnce.current ? 'focus' : 'initial');
      scrollRef.current?.scrollTo({ y: 0, animated: false });
    }, [load]),
  );

  const groups = groupByGame(rows);
  const openBinder = (id: string) =>
    router.push({ pathname: '/binder/[id]', params: { id } });

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Pressable
              onPress={() => router.push({ pathname: '/scan', params: { scope: 'card' } })}
              style={({ pressed }) => ({ paddingHorizontal: 12, opacity: pressed ? 0.6 : 1 })}
              accessibilityLabel="Scan a card into a binder">
              <Ionicons name="camera-outline" size={24} color={colors.accent} />
            </Pressable>
          ),
        }}
      />
      {loading && rows.length === 0 ? (
        <View style={{ alignItems: 'center', marginTop: 32 }}>
          <DiceLoader />
        </View>
      ) : (
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => load('pull')}
              tintColor={colors.accent}
            />
          }>
          {groups.length === 0 ? (
            <Text style={styles.empty}>No binders yet — tap the + button to create one.</Text>
          ) : (
            groups.map(({ game, data }) => (
              <GameSection
                key={game}
                game={game}
                binders={data}
                counts={counts}
                onOpen={openBinder}
              />
            ))
          )}
        </ScrollView>
      )}

      <Pressable
        style={({ pressed }) => [styles.fab, pressed && styles.fabPressed]}
        onPress={() => setNewOpen(true)}
        accessibilityLabel="New binder">
        <Ionicons name="add" size={32} color={colors.bgPrimary} />
      </Pressable>

      <NewBinderModal
        visible={newOpen}
        onClose={() => setNewOpen(false)}
        userId={session?.user.id}
        onCreated={() => {
          setNewOpen(false);
          load('focus');
        }}
      />
    </View>
  );
}

function GameSection({
  game,
  binders,
  counts,
  onOpen,
}: {
  game: Category;
  binders: Binder[];
  counts: Record<string, number>;
  onOpen: (id: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <View style={styles.groupWrap}>
      <Pressable
        onPress={() => setCollapsed((c) => !c)}
        style={({ pressed }) => [styles.groupHeader, pressed && { opacity: 0.6 }]}
        accessibilityRole="button"
        accessibilityLabel={`${collapsed ? 'Expand' : 'Collapse'} ${GAME_LABEL[game]}`}>
        <Ionicons
          name={collapsed ? 'chevron-forward' : 'chevron-down'}
          size={16}
          color={colors.textSecondary}
        />
        <Text style={styles.groupTitle}>{GAME_LABEL[game].toUpperCase()}</Text>
        <Text style={styles.groupCount}>{binders.length}</Text>
      </Pressable>
      {collapsed
        ? null
        : binders.map((b) => (
            <BinderCard key={b.id} binder={b} count={counts[b.id] ?? 0} onPress={() => onOpen(b.id)} />
          ))}
    </View>
  );
}

function BinderCard({
  binder,
  count,
  onPress,
}: {
  binder: Binder;
  count: number;
  onPress: () => void;
}) {
  const hasCover = !!binder.sleeve_image_url;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.binderCard, pressed && { borderColor: colors.accent }]}
      accessibilityLabel={`${binder.name} binder`}>
      <View style={styles.cardSleeve}>
        {hasCover ? (
          <Image
            source={{ uri: binder.sleeve_image_url! }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
          />
        ) : (
          <Ionicons name="albums-outline" size={40} color={colors.textMuted} style={{ opacity: 0.5 }} />
        )}
      </View>
      <View style={styles.cardBody}>
        <Text style={styles.cardName} numberOfLines={1} ellipsizeMode="tail">
          {binder.name}
        </Text>
        <View style={styles.cardPills}>
          <FlairPill value={binder.category} kind="category" size="sm" />
          <FlairPill value={binder.flair} kind="flair" size="sm" />
          {binder._shared ? (
            <View style={styles.sharedPill}>
              <Text style={styles.sharedPillText}>SHARED</Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.cardCount}>
          {count} {count === 1 ? 'listing' : 'listings'}
        </Text>
      </View>
    </Pressable>
  );
}

function NewBinderModal({
  visible,
  onClose,
  userId,
  onCreated,
}: {
  visible: boolean;
  onClose: () => void;
  userId: string | undefined;
  onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState<Category>('optcg');
  const [flair, setFlair] = useState<Flair>('trade');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // Default category to whatever the user last picked (across the app)
  useEffect(() => {
    if (!visible) return;
    setName('');
    setErr('');
    setFlair('trade');
    AsyncStorage.getItem(LAST_GAME_KEY).then((g) => {
      if (g === 'pokemon' || g === 'optcg') setCategory(g);
      else setCategory('optcg');
    });
  }, [visible]);

  async function submit() {
    if (!userId) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    setErr('');
    const { error } = await supabase
      .from('binders')
      .insert({ user_id: userId, name: trimmed, category, flair });
    setBusy(false);
    if (error) {
      if (
        error.code === '23505' &&
        /one_(trade|wishlist)_per_user_game/.test(error.message || '')
      ) {
        const flairName = flair === 'wishlist' ? 'wishlist' : 'trade';
        const gameName = category === 'pokemon' ? 'Pokémon' : 'OPTCG';
        setErr(`You already have a ${flairName} binder for ${gameName}. Only one per game is allowed.`);
      } else {
        setErr(error.message);
      }
      return;
    }
    AsyncStorage.setItem(LAST_GAME_KEY, category).catch(() => {});
    onCreated();
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalWrap}>
          <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
            <Pressable style={styles.closeBtn} onPress={onClose}>
              <Ionicons name="close" size={24} color={colors.textPrimary} />
            </Pressable>
            <Text style={styles.modalTitle}>NEW BINDER</Text>

            <Text style={styles.label}>Name</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="e.g. My trade binder"
              placeholderTextColor={colors.textMuted}
              autoFocus
              autoCapitalize="sentences"
              style={styles.input}
            />

            <Text style={styles.label}>Game</Text>
            <PillRow
              options={CATEGORIES}
              value={category}
              onChange={(v) => setCategory(v as Category)}
            />

            <Text style={styles.label}>Flair</Text>
            <PillRow
              options={FLAIRS}
              value={flair}
              onChange={(v) => setFlair(v as Flair)}
            />

            {err ? <Text style={styles.err}>{err}</Text> : null}

            <Pressable
              style={({ pressed }) => [
                styles.submitBtn,
                pressed && styles.submitBtnPressed,
                (!name.trim() || busy) && styles.submitBtnDisabled,
              ]}
              disabled={busy || !name.trim()}
              onPress={submit}>
              {busy ? (
                <ActivityIndicator color={colors.bgPrimary} />
              ) : (
                <Text style={styles.submitBtnText}>CREATE</Text>
              )}
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}

function PillRow({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <View style={styles.pillRow}>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            onPress={() => onChange(opt.value)}
            style={({ pressed }) => [
              styles.pill,
              active && styles.pillActive,
              pressed && !active && styles.pillPressed,
            ]}>
            <Text style={[styles.pillText, active && styles.pillTextActive]}>{opt.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgPrimary },
  scrollContent: { paddingBottom: 96 },
  empty: { textAlign: 'center', marginTop: 48, color: colors.textMuted, fontFamily: fonts.body },

  // Floating "new binder" button — pinned to the bottom of the screen, above
  // the tab bar.
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 24,
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 5,
    elevation: 6,
  },
  fabPressed: { backgroundColor: colors.accentLight },

  // ---- Game section ----
  groupWrap: { paddingHorizontal: 16, paddingTop: 24 },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingBottom: 8,
    marginBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  groupTitle: {
    flex: 1,
    fontFamily: fonts.serif,
    fontSize: 12,
    letterSpacing: 3,
    color: colors.textSecondary,
  },
  groupCount: {
    fontFamily: fonts.serif,
    fontSize: 12,
    letterSpacing: 1,
    color: colors.textMuted,
  },

  // ---- Binder card ----
  binderCard: {
    backgroundColor: colors.bgCard,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    overflow: 'hidden',
    marginBottom: 14,
  },
  cardSleeve: {
    width: '100%',
    aspectRatio: 1.4,
    backgroundColor: colors.bgSecondary,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardBody: { padding: 14 },
  cardName: {
    fontFamily: fonts.serif,
    fontSize: 16,
    letterSpacing: 0.5,
    color: colors.textPrimary,
    marginBottom: 8,
  },
  cardPills: { flexDirection: 'row', gap: 8, marginBottom: 8, flexWrap: 'wrap' },
  sharedPill: {
    borderWidth: 1,
    borderColor: colors.borderAccent,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
    justifyContent: 'center',
  },
  sharedPillText: { color: colors.accent, fontFamily: fonts.serifBold, fontSize: 9, letterSpacing: 1 },
  cardCount: {
    fontFamily: fonts.serif,
    fontSize: 11,
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    color: colors.accent,
  },

  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', padding: 24 },
  modalWrap: { width: '100%' },
  card: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderAccent,
    padding: 24,
    gap: 10,
  },
  closeBtn: { position: 'absolute', top: 8, right: 8, padding: 8, zIndex: 1 },
  modalTitle: {
    color: colors.accent,
    fontFamily: fonts.serifBold,
    letterSpacing: 3,
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 8,
  },
  label: {
    color: colors.textMuted,
    fontFamily: fonts.serif,
    letterSpacing: 2,
    fontSize: 11,
    marginTop: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgCard,
    borderRadius: radius.sm,
    padding: 12,
    fontSize: 16,
    color: colors.textPrimary,
    fontFamily: fonts.body,
  },
  pillRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgCard,
  },
  pillActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  pillPressed: { backgroundColor: colors.bgCardHover },
  pillText: { color: colors.textSecondary, fontFamily: fonts.body, fontSize: 13, letterSpacing: 1 },
  pillTextActive: { color: colors.bgPrimary, fontFamily: fonts.serifBold },
  err: { color: colors.danger, fontFamily: fonts.body, fontSize: 13, marginTop: 6 },
  submitBtn: {
    backgroundColor: colors.accent,
    paddingVertical: 14,
    borderRadius: radius.sm,
    alignItems: 'center',
    marginTop: 12,
  },
  submitBtnPressed: { backgroundColor: colors.accentLight },
  submitBtnDisabled: { opacity: 0.4 },
  submitBtnText: {
    color: colors.bgPrimary,
    fontFamily: fonts.serifBold,
    letterSpacing: 2,
    fontSize: 13,
  },
});
