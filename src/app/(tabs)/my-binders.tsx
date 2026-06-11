import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
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
import { FLAIR_STYLES } from '@/lib/binder-constants';
import { supabase } from '@/lib/supabase';
import { colors, fonts, radius } from '@/lib/theme';

type Binder = {
  id: string;
  name: string;
  description: string | null;
  category: string;
  flair: string;
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

// Per-IP shelf banner treatment. Color + text styling differ to evoke each
// IP's brand identity — One Piece bold Jolly-Roger red, Pokémon yellow with
// a hard blue drop-shadow nodding at the classic logo.
type ShelfBanner = {
  label: string;
  lineColor: string;
  textColor: string;
  fontSize: number;
  letterSpacing: number;
  textShadowColor?: string;
  textShadowOffset?: { width: number; height: number };
  textShadowRadius?: number;
};

const SHELF_BANNER: Record<Category, ShelfBanner> = {
  optcg: {
    label: 'ONE PIECE',
    lineColor: '#c8232a',
    textColor: '#c8232a',
    fontSize: 15,
    letterSpacing: 8,
  },
  pokemon: {
    label: 'POKÉMON',
    lineColor: '#3d7dca',
    textColor: '#ffcb05',
    fontSize: 16,
    letterSpacing: 5,
    textShadowColor: '#3d7dca',
    textShadowOffset: { width: 1.5, height: 1.5 },
    textShadowRadius: 0,
  },
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
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [newOpen, setNewOpen] = useState(false);

  const load = useCallback(
    async (mode: 'initial' | 'focus' | 'pull' = 'focus') => {
      if (!session?.user.id) return;
      if (mode === 'initial') setLoading(true);
      if (mode === 'pull') setRefreshing(true);
      const { data, error } = await supabase
        .from('binders')
        .select('id,name,description,category,flair')
        .eq('user_id', session.user.id)
        .order('created_at', { ascending: true });
      if (mode === 'initial') setLoading(false);
      if (mode === 'pull') setRefreshing(false);
      hasLoadedOnce.current = true;
      if (error) {
        console.warn('binders fetch error', error.message);
        return;
      }
      setRows(data ?? []);
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
              onPress={() => setNewOpen(true)}
              style={({ pressed }) => ({ paddingHorizontal: 12, opacity: pressed ? 0.6 : 1 })}
              accessibilityLabel="New binder">
              <Ionicons name="add" size={26} color={colors.accent} />
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
            <Text style={styles.empty}>No binders yet — tap + to create one.</Text>
          ) : (
            groups.map(({ game, data }) => (
              <Shelf key={game} game={game} binders={data} onOpen={openBinder} />
            ))
          )}
        </ScrollView>
      )}

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

const BINDER_W = 96;
const BINDER_H = 132;

function Shelf({
  game,
  binders,
  onOpen,
}: {
  game: Category;
  binders: Binder[];
  onOpen: (id: string) => void;
}) {
  const banner = SHELF_BANNER[game];
  const rows: Binder[][] = [];
  for (let i = 0; i < binders.length; i += 2) rows.push(binders.slice(i, i + 2));

  return (
    <View style={styles.shelfWrap}>
      <View style={styles.shelfLabel}>
        <View style={[styles.shelfLabelLine, { backgroundColor: banner.lineColor }]} />
        <Text
          style={[
            styles.shelfLabelText,
            {
              color: banner.textColor,
              fontSize: banner.fontSize,
              letterSpacing: banner.letterSpacing,
              textShadowColor: banner.textShadowColor,
              textShadowOffset: banner.textShadowOffset,
              textShadowRadius: banner.textShadowRadius,
            },
          ]}>
          {banner.label}
        </Text>
        <View style={[styles.shelfLabelLine, { backgroundColor: banner.lineColor }]} />
      </View>

      <View style={styles.shelfContent}>
        {rows.map((row, i) => (
          <View key={i} style={styles.binderRow}>
            {row.map((b) => (
              <BinderIcon key={b.id} binder={b} onPress={() => onOpen(b.id)} />
            ))}
            {row.length === 1 ? <View style={{ width: BINDER_W }} /> : null}
          </View>
        ))}
      </View>

      <View style={styles.shelfPlankTop} />
      <View style={styles.shelfPlank} />
      <View style={styles.shelfPlankShadow} />
    </View>
  );
}

function BinderIcon({ binder, onPress }: { binder: Binder; onPress: () => void }) {
  const flair = FLAIR_STYLES[binder.flair] ?? { label: 'Binder', color: colors.accent };
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.binderSlot, pressed && { transform: [{ translateY: 1 }] }]}
      accessibilityLabel={`${binder.name} binder`}>
      <View style={[styles.binderBody, { backgroundColor: flair.color }]}>
        <View style={styles.binderTopHighlight} />
        <View style={styles.binderRightShade} />
        <View style={styles.binderBottomShadow} />
        <View style={styles.binderLabel}>
          <Text
            style={styles.binderLabelText}
            numberOfLines={3}
            ellipsizeMode="tail"
            textBreakStrategy="simple">
            {binder.name}
          </Text>
        </View>
      </View>
      <View style={styles.binderFlairWrap}>
        <FlairPill value={binder.flair} kind="flair" size="sm" />
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
  scrollContent: { paddingBottom: 32 },
  empty: { textAlign: 'center', marginTop: 48, color: colors.textMuted, fontFamily: fonts.body },

  // ---- Shelf ----
  shelfWrap: { paddingTop: 28 },
  shelfLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 24,
    marginBottom: 18,
  },
  shelfLabelLine: { flex: 1, height: 1, opacity: 0.55 },
  shelfLabelText: {
    fontFamily: fonts.serifBold,
    fontSize: 13,
    letterSpacing: 6,
  },
  shelfContent: { paddingHorizontal: 16 },
  binderRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'flex-end',
    marginBottom: 10,
  },
  // Wooden shelf plank — a thin highlighted top, the plank body, then a
  // darker underside-shadow band to suggest depth beneath.
  shelfPlankTop: { height: 1, backgroundColor: '#a07c52' },
  shelfPlank: {
    height: 9,
    backgroundColor: '#6b4a2a',
    borderTopWidth: 1,
    borderTopColor: '#8a6841',
    borderBottomWidth: 1,
    borderBottomColor: '#2e1d10',
  },
  shelfPlankShadow: {
    height: 6,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },

  // ---- Binder icon ----
  binderSlot: {
    width: BINDER_W,
    alignItems: 'center',
    gap: 8,
  },
  binderBody: {
    width: BINDER_W,
    height: BINDER_H,
    borderRadius: 3,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOpacity: 0.4,
        shadowOffset: { width: 2, height: 5 },
        shadowRadius: 5,
      },
      android: { elevation: 6 },
    }),
  },
  binderTopHighlight: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  binderRightShade: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 0,
    width: 6,
    backgroundColor: 'rgba(0,0,0,0.28)',
  },
  binderBottomShadow: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 5,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  binderLabel: {
    backgroundColor: 'rgba(0,0,0,0.22)',
    paddingHorizontal: 4,
    paddingVertical: 6,
    borderRadius: 2,
    // Right shade is absolutely positioned, so it doesn't consume layout
    // space — just nudge the label slightly off the right edge.
    marginLeft: 2,
    marginRight: 10,
    width: BINDER_W - 14,
  },
  binderLabelText: {
    color: '#fff',
    fontFamily: fonts.serifBold,
    fontSize: 10,
    lineHeight: 13,
    letterSpacing: 0.5,
    textAlign: 'center',
    includeFontPadding: false,
  },
  binderFlairWrap: {
    height: 22, // reserve a constant pill-height so binder bottoms align across the row
    justifyContent: 'flex-start',
    alignItems: 'center',
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
