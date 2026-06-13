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
import { useAuth } from '@/lib/auth';
import {
  CardInfo,
  DeckRow,
  GAME,
  baseCode,
  capFor,
  fetchValidity,
  isBase,
  loadRules,
  lookupCards,
  parseDecklist,
  standardLegal,
} from '@/lib/decks';
import { supabase } from '@/lib/supabase';
import { colors, fonts, radius } from '@/lib/theme';

type Format = 'standard' | 'eternal';

type DeckTile = DeckRow & { leader?: CardInfo; valid?: boolean; total?: number };

export default function DecksScreen() {
  const { session } = useAuth();
  const router = useRouter();
  const scrollRef = useRef<ScrollView>(null);
  const loadedOnce = useRef(false);
  const [tiles, setTiles] = useState<DeckTile[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [newOpen, setNewOpen] = useState(false);

  const load = useCallback(
    async (mode: 'initial' | 'focus' | 'pull' = 'focus') => {
      if (!session?.user.id) return;
      if (mode === 'initial') setLoading(true);
      if (mode === 'pull') setRefreshing(true);
      await loadRules();
      const { data: decks } = await supabase
        .from('decks')
        .select('id,user_id,game,leader_card_code,name,is_public,listing_type,format,created_at')
        .eq('user_id', session.user.id)
        .order('created_at', { ascending: true });
      const rows = (decks ?? []) as DeckRow[];
      const leaderCodes = [...new Set(rows.map((d) => d.leader_card_code))];
      const leaderMap: Record<string, CardInfo> = leaderCodes.length
        ? await lookupCards(leaderCodes)
        : {};
      const validity = await Promise.all(rows.map((d) => fetchValidity(d.id)));
      if (mode === 'initial') setLoading(false);
      if (mode === 'pull') setRefreshing(false);
      loadedOnce.current = true;
      setTiles(
        rows.map((d, i) => ({
          ...d,
          leader: leaderMap[d.leader_card_code],
          valid: validity[i]?.valid,
          total: validity[i]?.total_cards,
        })),
      );
    },
    [session?.user.id],
  );

  useFocusEffect(
    useCallback(() => {
      load(loadedOnce.current ? 'focus' : 'initial');
      scrollRef.current?.scrollTo({ y: 0, animated: false });
    }, [load]),
  );

  const openDeck = (id: string) => router.push({ pathname: '/deck/[id]', params: { id } });

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Pressable
              onPress={() => setNewOpen(true)}
              style={({ pressed }) => ({ paddingHorizontal: 12, opacity: pressed ? 0.6 : 1 })}
              accessibilityLabel="New deck">
              <Ionicons name="add" size={26} color={colors.accent} />
            </Pressable>
          ),
        }}
      />
      {loading && tiles.length === 0 ? (
        <View style={{ alignItems: 'center', marginTop: 32 }}>
          <DiceLoader />
        </View>
      ) : (
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => load('pull')} tintColor={colors.accent} />
          }>
          <View style={styles.grid}>
            <Pressable
              style={({ pressed }) => [styles.addTile, pressed && { backgroundColor: colors.bgCard }]}
              onPress={() => setNewOpen(true)}
              accessibilityLabel="New deck">
              <Text style={styles.addPlus}>＋</Text>
            </Pressable>
            {tiles.map((d) => (
              <Pressable key={d.id} style={styles.deckTile} onPress={() => openDeck(d.id)}>
                {d.leader?.image_url ? (
                  <Image source={{ uri: d.leader.image_url }} style={styles.deckImg} contentFit="cover" />
                ) : (
                  <View style={[styles.deckImg, styles.deckImgEmpty]} />
                )}
                <View style={styles.deckBody}>
                  <Text style={styles.deckName} numberOfLines={1}>
                    {d.name}
                  </Text>
                  <View style={styles.badgeRow}>
                    <Badge label={d.valid ? 'valid' : 'cooking'} tone={d.valid ? 'ok' : 'bad'} />
                    {d.format === 'eternal' ? <Badge label="eternal" tone="etern" /> : null}
                    {d.is_public ? <Badge label={d.listing_type ?? 'public'} tone="pub" /> : null}
                  </View>
                </View>
              </Pressable>
            ))}
          </View>
          {tiles.length === 0 ? <Text style={styles.empty}>No decks yet — tap ＋ to start building.</Text> : null}
        </ScrollView>
      )}

      <NewDeckModal
        visible={newOpen}
        onClose={() => setNewOpen(false)}
        userId={session?.user.id}
        onCreated={(id) => {
          setNewOpen(false);
          openDeck(id);
        }}
      />
    </View>
  );
}

const TONE: Record<string, string> = {
  ok: '#7ec96a',
  bad: '#d98a8a',
  pub: '#ddb896',
  etern: '#b07cc6',
};

function Badge({ label, tone }: { label: string; tone: keyof typeof TONE | string }) {
  const color = TONE[tone] ?? colors.textMuted;
  return (
    <View style={[styles.badge, { borderColor: color }]}>
      <Text style={[styles.badgeText, { color }]}>{label}</Text>
    </View>
  );
}

function NewDeckModal({
  visible,
  onClose,
  userId,
  onCreated,
}: {
  visible: boolean;
  onClose: () => void;
  userId: string | undefined;
  onCreated: (deckId: string) => void;
}) {
  const [format, setFormat] = useState<Format>('standard');
  const [list, setList] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CardInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!visible) return;
    setFormat('standard');
    setList('');
    setQuery('');
    setResults([]);
    setErr('');
  }, [visible]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from('cards')
        .select('card_code,name,color,cost,type,image_url')
        .eq('game', GAME)
        .eq('type', 'LEADER')
        .or(`name.ilike.%${q}%,card_code.ilike.%${q}%`)
        .order('release_order', { ascending: false })
        .limit(40);
      if (cancelled) return;
      const rows = (data ?? []).filter(
        (c: any) =>
          isBase(c.card_code) && capFor(c.card_code) !== 0 && (format !== 'standard' || standardLegal(c.card_code)),
      );
      setResults(rows.slice(0, 20));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, format]);

  async function pickLeader(leader: CardInfo) {
    if (!userId || busy) return;
    setErr('');
    setBusy(true);

    // Validate an optional pasted list before creating anything.
    let listRows: Map<string, number> | null = null;
    let info: Record<string, CardInfo> = {};
    const text = list.trim();
    if (text) {
      const { rows, errors } = parseDecklist(text);
      if (errors.length) {
        setBusy(false);
        setErr('Bad decklist lines: ' + errors.slice(0, 3).join(', '));
        return;
      }
      info = await lookupCards([...rows.keys()]);
      const missing = [...rows.keys()].filter((c) => !info[c]);
      if (missing.length) {
        setBusy(false);
        setErr('Unknown card(s): ' + missing.join(', '));
        return;
      }
      for (const code of [...rows.keys()]) {
        if (info[code].type !== 'LEADER') continue;
        if (code !== baseCode(leader.card_code)) {
          setBusy(false);
          setErr(`That list is led by ${info[code].name} — pick that leader.`);
          return;
        }
        rows.delete(code);
      }
      listRows = rows;
    }

    const { data, error } = await supabase
      .from('decks')
      .insert({
        user_id: userId,
        game: GAME,
        leader_card_code: leader.card_code,
        name: `${leader.color ? leader.color + ' ' : ''}${leader.name} Deck`,
        format,
      })
      .select('id')
      .single();
    if (error || !data) {
      setBusy(false);
      setErr(
        error?.code === '23505' && /one_deck_per_leader/.test(error.message ?? '')
          ? `You already have a deck for ${leader.name}.`
          : error?.message ?? 'Could not create deck.',
      );
      return;
    }
    if (listRows) {
      for (const [code, qty] of listRows) {
        await supabase.from('deck_cards').insert({ deck_id: data.id, card_code: code, quantity: qty });
      }
    }
    setBusy(false);
    onCreated(data.id as string);
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalWrap}>
          <View style={styles.card}>
            <Pressable style={styles.closeBtn} onPress={onClose}>
              <Ionicons name="close" size={24} color={colors.textPrimary} />
            </Pressable>
            <Text style={styles.modalTitle}>NEW DECK</Text>

            <Text style={styles.label}>Format</Text>
            <View style={styles.pillRow}>
              {(['standard', 'eternal'] as Format[]).map((f) => (
                <Pressable
                  key={f}
                  onPress={() => setFormat(f)}
                  style={[styles.pill, format === f && styles.pillActive]}>
                  <Text style={[styles.pillText, format === f && styles.pillTextActive]}>
                    {f === 'standard' ? 'Standard' : 'Eternal'}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.label}>Decklist (optional)</Text>
            <TextInput
              value={list}
              onChangeText={setList}
              placeholder={'4xOP16-091\n4xOP16-092…'}
              placeholderTextColor={colors.textMuted}
              multiline
              style={[styles.input, styles.listInput]}
            />

            <Text style={styles.label}>Search Leaders</Text>
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="e.g. Uta, OP01-001"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              style={styles.input}
            />

            {err ? <Text style={styles.err}>{err}</Text> : null}
            {busy ? <ActivityIndicator color={colors.accent} style={{ marginTop: 10 }} /> : null}

            <ScrollView style={styles.results} keyboardShouldPersistTaps="handled">
              {results.map((c) => (
                <Pressable key={c.card_code} style={styles.resultRow} onPress={() => pickLeader(c)}>
                  {c.image_url ? (
                    <Image source={{ uri: c.image_url }} style={styles.resultImg} contentFit="cover" />
                  ) : (
                    <View style={[styles.resultImg, styles.deckImgEmpty]} />
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.resultName} numberOfLines={1}>
                      {c.name}
                    </Text>
                    <Text style={styles.resultSub}>
                      {c.card_code} · {c.color}
                    </Text>
                  </View>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const TILE_GAP = 12;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgPrimary },
  scrollContent: { padding: 16, paddingBottom: 32 },
  empty: { textAlign: 'center', marginTop: 32, color: colors.textMuted, fontFamily: fonts.body },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: TILE_GAP },

  addTile: {
    width: '47%',
    aspectRatio: 0.72,
    borderWidth: 1,
    borderColor: colors.accent,
    backgroundColor: colors.bgSecondary,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addPlus: { color: colors.accent, fontSize: 44, fontFamily: fonts.serif, lineHeight: 48 },

  deckTile: {
    width: '47%',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  deckImg: { width: '100%', aspectRatio: 0.72 },
  deckImgEmpty: { backgroundColor: colors.bgCard },
  deckBody: { padding: 8 },
  deckName: { color: colors.textPrimary, fontFamily: fonts.serif, fontSize: 12, marginBottom: 5 },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  badge: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 1 },
  badgeText: { fontSize: 9, letterSpacing: 0.5, textTransform: 'uppercase', fontFamily: fonts.body },

  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', padding: 18 },
  modalWrap: { width: '100%' },
  card: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderAccent,
    padding: 20,
    maxHeight: '88%',
  },
  closeBtn: { position: 'absolute', top: 8, right: 8, padding: 8, zIndex: 1 },
  modalTitle: {
    color: colors.accent,
    fontFamily: fonts.serifBold,
    letterSpacing: 3,
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 6,
  },
  label: { color: colors.textMuted, fontFamily: fonts.serif, letterSpacing: 2, fontSize: 11, marginTop: 12 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgCard,
    borderRadius: radius.sm,
    padding: 12,
    fontSize: 15,
    color: colors.textPrimary,
    fontFamily: fonts.body,
    marginTop: 6,
  },
  listInput: { height: 90, textAlignVertical: 'top', fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }) },
  pillRow: { flexDirection: 'row', gap: 8, marginTop: 6 },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgCard,
  },
  pillActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  pillText: { color: colors.textSecondary, fontFamily: fonts.body, fontSize: 13, letterSpacing: 1 },
  pillTextActive: { color: colors.bgPrimary, fontFamily: fonts.serifBold },
  err: { color: colors.danger, fontFamily: fonts.body, fontSize: 13, marginTop: 8 },

  results: { marginTop: 8, maxHeight: 240 },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  resultImg: { width: 36, height: 50, borderRadius: 4 },
  resultName: { color: colors.textPrimary, fontFamily: fonts.body, fontSize: 14 },
  resultSub: { color: colors.textMuted, fontFamily: fonts.body, fontSize: 12 },
});
