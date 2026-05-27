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
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { FlairPill } from '@/components/flair-pill';
import { useAuth } from '@/lib/auth';
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

function groupByGame(rows: Binder[]): { game: Category; data: Binder[] }[] {
  const buckets: Record<string, Binder[]> = {};
  for (const r of rows) (buckets[r.category] ??= []).push(r);
  return GAME_ORDER.filter((g) => buckets[g]?.length).map((g) => ({ game: g, data: buckets[g] }));
}

export default function MyBindersScreen() {
  const { session } = useAuth();
  const router = useRouter();
  const sectionListRef = useRef<SectionList<Binder>>(null);
  const [rows, setRows] = useState<Binder[]>([]);
  const [loading, setLoading] = useState(false);
  const [newOpen, setNewOpen] = useState(false);

  useFocusEffect(
    useCallback(() => {
      // SectionList.scrollToLocation requires non-empty sections; guard for empty state.
      try {
        sectionListRef.current?.scrollToLocation({
          sectionIndex: 0,
          itemIndex: 0,
          animated: false,
          viewOffset: 0,
        });
      } catch {}
    }, []),
  );

  const load = useCallback(async () => {
    if (!session?.user.id) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('binders')
      .select('id,name,description,category,flair')
      .eq('user_id', session.user.id)
      .order('created_at', { ascending: true });
    setLoading(false);
    if (error) {
      console.warn('binders fetch error', error.message);
      return;
    }
    setRows(data ?? []);
  }, [session?.user.id]);

  useEffect(() => {
    load();
  }, [load]);

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
        <ActivityIndicator style={{ marginTop: 32 }} color={colors.accent} />
      ) : (
        <SectionList
          ref={sectionListRef}
          sections={groupByGame(rows)}
          keyExtractor={(r) => r.id}
          refreshControl={
            <RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.accent} />
          }
          stickySectionHeadersEnabled={false}
          ListEmptyComponent={<Text style={styles.empty}>No binders yet — tap + to create one.</Text>}
          renderSectionHeader={({ section }) => (
            <View style={styles.sectionHeader}>
              <FlairPill value={section.game} kind="category" />
              <Text style={styles.sectionCount}>
                {section.data.length} binder{section.data.length === 1 ? '' : 's'}
              </Text>
            </View>
          )}
          renderItem={({ item }) => (
            <Pressable
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              onPress={() => router.push({ pathname: '/binder/[id]', params: { id: item.id } })}>
              <Text style={styles.rowTitle}>{item.name}</Text>
              <View style={styles.rowPills}>
                <FlairPill value={item.flair} kind="flair" size="sm" />
              </View>
            </Pressable>
          )}
        />
      )}

      <NewBinderModal
        visible={newOpen}
        onClose={() => setNewOpen(false)}
        userId={session?.user.id}
        onCreated={() => {
          setNewOpen(false);
          load();
        }}
      />
    </View>
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
  row: { paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderColor: colors.border },
  rowPressed: { backgroundColor: colors.bgSecondary },
  rowTitle: { fontSize: 16, fontFamily: fonts.serif, color: colors.textPrimary, letterSpacing: 1 },
  rowSub: { fontSize: 12, color: colors.textMuted, marginTop: 4, fontFamily: fonts.body, letterSpacing: 1 },
  rowPills: { flexDirection: 'row', gap: 6, marginTop: 6 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
    backgroundColor: colors.bgPrimary,
  },
  sectionCount: { color: colors.textMuted, fontFamily: fonts.body, fontSize: 12 },
  empty: { textAlign: 'center', marginTop: 48, color: colors.textMuted, fontFamily: fonts.body },

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
