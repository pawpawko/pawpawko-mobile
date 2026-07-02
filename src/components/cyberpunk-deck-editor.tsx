import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Stack, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { DiceLoader } from '@/components/dice-loader';
import {
  CYBERPUNK_COLORS,
  CYBERPUNK_COSTS,
  CYBERPUNK_RAM,
  CYBERPUNK_RARITIES,
  CYBERPUNK_TAGS,
  CYBERPUNK_TYPES,
} from '@/lib/binder-constants';
import type { DeckRow } from '@/lib/decks';
import {
  CpCard,
  CpCardInfo,
  CpLegend,
  CpSearchOpts,
  CpValidity,
  cpSyncLeader,
  cyberpunkCaps,
  cyberpunkValidity,
  loadCyberpunkDeck,
  searchCyberpunkCards,
} from '@/lib/decks-cyberpunk';
import { supabase } from '@/lib/supabase';
import { fonts, radius, type Palette } from '@/lib/theme';
import { useTheme } from '@/lib/theme-context';

const COLS = 3;

export function CyberpunkDeckEditor({ deck: initialDeck, isOwner }: { deck: DeckRow; isOwner: boolean }) {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [deck, setDeck] = useState<DeckRow>(initialDeck);
  const [legends, setLegends] = useState<CpLegend[]>([]);
  const [cards, setCards] = useState<CpCard[]>([]);
  const [info, setInfo] = useState<Record<string, CpCardInfo>>({});
  const [validity, setValidity] = useState<CpValidity | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [name, setName] = useState(initialDeck.name);
  const [browserOpen, setBrowserOpen] = useState(false);
  const [browserMode, setBrowserMode] = useState<'card' | 'legend'>('card');

  const caps = useMemo(() => cyberpunkCaps(legends, info), [legends, info]);

  const load = useCallback(async () => {
    const res = await loadCyberpunkDeck(deck.id);
    setLegends(res.legends);
    setCards(res.cards);
    setInfo(res.info);
    setValidity(await cyberpunkValidity(deck.id));
    setLoading(false);
    return res;
  }, [deck.id]);

  useEffect(() => {
    load();
  }, [load]);

  // ---- mutations (await + reload; deck edits aren't rapid-fire) ----
  const addCard = async (code: string, ci?: CpCardInfo) => {
    if (!isOwner) return;
    setErr('');
    const row = cards.find((c) => c.card_code === code);
    if (row) {
      if (row.quantity >= 3) return;
      await supabase.from('deck_cards').update({ quantity: row.quantity + 1 }).eq('deck_id', deck.id).eq('card_code', code);
    } else {
      const { error } = await supabase.from('deck_cards').insert({ deck_id: deck.id, card_code: code, quantity: 1, owned: 0 });
      if (error) { setErr(error.message); return; }
      if (ci) setInfo((m) => ({ ...m, [code]: ci }));
    }
    await load();
  };
  const stepQty = async (code: string, delta: number) => {
    if (!isOwner) return;
    const row = cards.find((c) => c.card_code === code);
    if (!row) return;
    const q = Math.max(0, Math.min(3, row.quantity + delta));
    if (q === 0) await supabase.from('deck_cards').delete().eq('deck_id', deck.id).eq('card_code', code);
    else await supabase.from('deck_cards').update({ quantity: q, owned: Math.min(row.owned, q) }).eq('deck_id', deck.id).eq('card_code', code);
    await load();
  };
  const cycleOwned = async (code: string) => {
    if (!isOwner) return;
    const row = cards.find((c) => c.card_code === code);
    if (!row) return;
    const o = row.owned < row.quantity ? row.owned + 1 : 0; // increment, wrap at full
    await supabase.from('deck_cards').update({ owned: o }).eq('deck_id', deck.id).eq('card_code', code);
    await load();
  };
  const addLegend = async (code: string) => {
    if (!isOwner) return;
    const { error } = await supabase.from('deck_legends').insert({ deck_id: deck.id, card_code: code });
    if (error) { setErr(error.message); return; }
    const nl = await cpSyncLeader(deck.id, deck.leader_card_code);
    if (nl !== deck.leader_card_code) setDeck((d) => ({ ...d, leader_card_code: nl }));
    const res = await load();
    if (res.legends.length >= 3) setBrowserOpen(false);
  };
  const removeLegend = async (code: string) => {
    if (!isOwner) return;
    await supabase.from('deck_legends').delete().eq('deck_id', deck.id).eq('card_code', code);
    const nl = await cpSyncLeader(deck.id, deck.leader_card_code);
    if (nl !== deck.leader_card_code) setDeck((d) => ({ ...d, leader_card_code: nl }));
    await load();
  };
  const toggleLegendOwned = async (l: CpLegend) => {
    if (!isOwner) return;
    await supabase.from('deck_legends').update({ owned: l.owned ? 0 : 1 }).eq('deck_id', deck.id).eq('card_code', l.card_code);
    await load();
  };
  const saveName = async () => {
    if (!isOwner) return;
    const n = name.trim().slice(0, 24) || 'Cyberpunk Deck';
    setName(n);
    await supabase.from('decks').update({ name: n }).eq('id', deck.id);
    setDeck((d) => ({ ...d, name: n }));
  };
  const togglePublish = async () => {
    if (!isOwner) return;
    setErr('');
    if (deck.is_public) {
      await supabase.rpc('unpublish_deck', { p_deck_id: deck.id });
      setDeck((d) => ({ ...d, is_public: false, listing_type: null }));
    } else {
      const { error } = await supabase.rpc('publish_deck', { p_deck_id: deck.id, p_listing_type: 'trade' });
      if (error) { setErr(error.message); return; }
      setDeck((d) => ({ ...d, is_public: true, listing_type: 'trade' }));
    }
    setValidity(await cyberpunkValidity(deck.id));
  };
  const confirmDelete = () => {
    if (!isOwner) return;
    Alert.alert('Delete deck?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await supabase.from('decks').delete().eq('id', deck.id);
          router.back();
        },
      },
    ]);
  };

  const openBrowser = (mode: 'card' | 'legend') => {
    setBrowserMode(mode);
    setBrowserOpen(true);
  };

  const sortedCards = useMemo(
    () =>
      cards.slice().sort((a, b) => {
        const ca = info[a.card_code], cb = info[b.card_code];
        return (ca?.cost ?? 99) - (cb?.cost ?? 99) || a.card_code.localeCompare(b.card_code);
      }),
    [cards, info],
  );

  if (loading) {
    return (
      <View style={styles.loaderWrap}>
        <Stack.Screen options={{ title: deck.name }} />
        <DiceLoader />
      </View>
    );
  }

  const usableColors = CYBERPUNK_COLORS.filter((c) => caps[c]);

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: name }} />
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* header: name + publish + delete */}
        <View style={styles.nameRow}>
          <TextInput
            style={styles.nameInput}
            value={name}
            onChangeText={setName}
            onBlur={saveName}
            editable={isOwner}
            maxLength={24}
          />
          {isOwner ? (
            <>
              <Pressable style={styles.iconBtn} onPress={togglePublish}>
                <Ionicons name={deck.is_public ? 'eye' : 'eye-off'} size={20} color={deck.is_public ? '#7ec96a' : colors.textMuted} />
              </Pressable>
              <Pressable style={styles.iconBtn} onPress={confirmDelete}>
                <Ionicons name="trash-outline" size={20} color={colors.danger} />
              </Pressable>
            </>
          ) : null}
        </View>

        {/* Legends */}
        <Text style={styles.section}>
          Legends <Text style={styles.sub}>({legends.length}/3)</Text>
        </Text>
        <View style={styles.grid}>
          {legends.map((l) => {
            const c = info[l.card_code] ?? ({} as CpCardInfo);
            return (
              <View key={l.card_code} style={styles.tile}>
                <Image source={{ uri: c.image_url ?? '' }} style={styles.tileImg} contentFit="cover" />
                <Pressable
                  style={[styles.ownedPill, l.owned ? styles.ownedYes : styles.ownedNo]}
                  onPress={() => toggleLegendOwned(l)}
                  disabled={!isOwner}>
                  <Text style={styles.ownedText}>{l.owned ? '✓ owned' : 'need'}</Text>
                </Pressable>
                {isOwner ? (
                  <Pressable style={styles.rmBtn} onPress={() => removeLegend(l.card_code)}>
                    <Ionicons name="close" size={14} color="#fff" />
                  </Pressable>
                ) : null}
              </View>
            );
          })}
          {isOwner && legends.length < 3 ? (
            <Pressable style={[styles.tile, styles.addTile]} onPress={() => openBrowser('legend')}>
              <Text style={styles.addPlus}>＋</Text>
              <Text style={styles.addLabel}>Legend</Text>
            </Pressable>
          ) : null}
        </View>

        {/* RAM caps */}
        <View style={styles.capRow}>
          {usableColors.length ? (
            usableColors.map((col) => (
              <View key={col} style={styles.capChip}>
                <Text style={styles.capText}>
                  {col}: RAM ≤ {caps[col]}
                </Text>
              </View>
            ))
          ) : (
            <Text style={styles.muted}>Add Legends to unlock colors.</Text>
          )}
        </View>

        {/* validity */}
        {validity ? (
          <View style={styles.validity}>
            <View style={[styles.badge, { borderColor: validity.valid && validity.owned_complete ? '#7ec96a' : '#d98a8a' }]}>
              <Text style={[styles.badgeText, { color: validity.valid && validity.owned_complete ? '#7ec96a' : '#d98a8a' }]}>
                {validity.valid && validity.owned_complete ? 'valid' : 'cooking'}
              </Text>
            </View>
            <Text style={styles.countsText}>
              Main deck {validity.total_cards} / 40–50 · owned {validity.owned_cards}, missing {validity.missing_cards}
            </Text>
            {validity.problems?.length ? (
              <View style={styles.problems}>
                {validity.problems.map((p, i) => (
                  <Text key={i} style={styles.problem}>
                    • {p}
                  </Text>
                ))}
              </View>
            ) : null}
          </View>
        ) : null}
        {err ? <Text style={styles.err}>{err}</Text> : null}

        {/* Main deck */}
        <View style={styles.mainHead}>
          <Text style={styles.section}>Main deck</Text>
          {isOwner ? (
            <Pressable style={styles.addCardsBtn} onPress={() => openBrowser('card')}>
              <Text style={styles.addCardsText}>＋ Add Cards</Text>
            </Pressable>
          ) : null}
        </View>
        {sortedCards.length === 0 ? (
          <Text style={styles.muted}>No cards yet. Tap “Add Cards”.</Text>
        ) : (
          <View style={styles.grid}>
            {sortedCards.map((r) => {
              const c = info[r.card_code] ?? ({} as CpCardInfo);
              const cap = caps[c.color ?? ''] ?? 0;
              const over = (c.ram ?? 0) > cap;
              return (
                <View key={r.card_code} style={styles.tile}>
                  <Image
                    source={{ uri: c.image_url ?? '' }}
                    style={[styles.tileImg, over && styles.overCap]}
                    contentFit="cover"
                  />
                  <Pressable
                    style={[styles.ownedPill, r.owned >= r.quantity ? styles.ownedYes : styles.ownedNo]}
                    onPress={() => cycleOwned(r.card_code)}
                    disabled={!isOwner}>
                    <Text style={styles.ownedText}>{r.owned}/{r.quantity}</Text>
                  </Pressable>
                  {isOwner ? (
                    <View style={styles.qtyRow}>
                      <Pressable style={styles.qtyBtn} onPress={() => stepQty(r.card_code, -1)}>
                        <Text style={styles.qtyBtnText}>−</Text>
                      </Pressable>
                      <Text style={styles.qtyNum}>×{r.quantity}</Text>
                      <Pressable
                        style={[styles.qtyBtn, r.quantity >= 3 && styles.qtyBtnOff]}
                        onPress={() => stepQty(r.card_code, 1)}
                        disabled={r.quantity >= 3}>
                        <Text style={styles.qtyBtnText}>＋</Text>
                      </Pressable>
                    </View>
                  ) : (
                    <Text style={styles.qtyNum}>×{r.quantity}</Text>
                  )}
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>

      <CyberpunkBrowser
        visible={browserOpen}
        mode={browserMode}
        onClose={() => setBrowserOpen(false)}
        onPick={(c) => (browserMode === 'legend' ? addLegend(c.card_code) : addCard(c.card_code, c))}
        inDeck={cards}
      />
    </View>
  );
}

// ---- Card browser (also picks Legends via mode) ----
function CyberpunkBrowser({
  visible,
  mode,
  onClose,
  onPick,
  inDeck,
}: {
  visible: boolean;
  mode: 'card' | 'legend';
  onClose: () => void;
  onPick: (c: CpCardInfo) => void;
  inDeck: CpCard[];
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [f, setF] = useState<CpSearchOpts>({});
  const [name, setName] = useState('');
  const [results, setResults] = useState<CpCardInfo[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible) {
      setF({});
      setName('');
      setResults([]);
    }
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setBusy(true);
    const t = setTimeout(async () => {
      const r = await searchCyberpunkCards({ ...f, name: name.trim() || undefined, legendOnly: mode === 'legend' });
      if (!cancelled) {
        setResults(r);
        setBusy(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [visible, mode, f, name]);

  const set = (key: keyof CpSearchOpts, val: string) =>
    setF((p) => ({ ...p, [key]: p[key] === val ? undefined : val }));

  const rows: { key: keyof CpSearchOpts; label: string; opts: string[] }[] = [
    { key: 'color', label: 'Color', opts: CYBERPUNK_COLORS },
    ...(mode === 'legend' ? [] : [{ key: 'type' as const, label: 'Type', opts: CYBERPUNK_TYPES }]),
    { key: 'cost', label: 'Cost', opts: CYBERPUNK_COSTS.map(String) },
    { key: 'ram', label: 'RAM', opts: CYBERPUNK_RAM.map(String) },
    { key: 'rarity', label: 'Rarity', opts: CYBERPUNK_RARITIES },
    { key: 'tag', label: 'Tag', opts: CYBERPUNK_TAGS },
  ];

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.browserWrap}>
        <View style={styles.browserHead}>
          <Text style={styles.browserTitle}>{mode === 'legend' ? 'Add a Legend' : 'Add Cards'}</Text>
          <Pressable onPress={onClose} style={styles.iconBtn}>
            <Ionicons name="close" size={24} color={colors.textPrimary} />
          </Pressable>
        </View>
        <TextInput
          style={styles.search}
          value={name}
          onChangeText={setName}
          placeholder="Name or cb-…"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
        />
        {rows.map((r) => (
          <View key={r.key} style={styles.filterRow}>
            <Text style={styles.filterLabel}>{r.label}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
              {r.opts.map((o) => {
                const active = f[r.key] === o;
                return (
                  <Pressable key={o} onPress={() => set(r.key, o)} style={[styles.chip, active && styles.chipActive]}>
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>{o}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        ))}
        {busy ? <ActivityIndicator color={colors.accent} style={{ marginVertical: 8 }} /> : null}
        <ScrollView contentContainerStyle={styles.resultGrid}>
          {results.map((c) => {
            const dc = inDeck.find((x) => x.card_code === c.card_code);
            return (
              <Pressable key={c.card_code} style={styles.tile} onPress={() => onPick(c)}>
                <Image source={{ uri: c.image_url ?? '' }} style={styles.tileImg} contentFit="cover" />
                <Text style={styles.resultCode} numberOfLines={1}>
                  {c.card_code}
                  {dc ? ` ·×${dc.quantity}` : ''}
                </Text>
              </Pressable>
            );
          })}
          {!busy && results.length === 0 ? <Text style={styles.muted}>No cards match.</Text> : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bgPrimary },
    loaderWrap: { flex: 1, backgroundColor: colors.bgPrimary, alignItems: 'center', justifyContent: 'center' },
    scroll: { padding: 16, paddingBottom: 40 },
    nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
    nameInput: {
      flex: 1,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.bgCard,
      borderRadius: radius.sm,
      paddingHorizontal: 12,
      paddingVertical: 8,
      color: colors.textPrimary,
      fontFamily: fonts.display,
      fontSize: 16,
    },
    iconBtn: { padding: 8 },
    section: { color: colors.textPrimary, fontFamily: fonts.serifBold, fontSize: 14, letterSpacing: 1, marginTop: 6, marginBottom: 8 },
    sub: { color: colors.textMuted, fontFamily: fonts.body, fontSize: 12 },
    muted: { color: colors.textMuted, fontFamily: fonts.body, fontSize: 13, marginVertical: 6 },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    tile: { width: `${100 / COLS - 3}%`, marginBottom: 4 },
    tileImg: { width: '100%', aspectRatio: 0.72, borderRadius: 6, backgroundColor: colors.bgCard },
    overCap: { borderWidth: 2, borderColor: '#c0453a' },
    addTile: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.accent, borderRadius: 6, aspectRatio: 0.72, backgroundColor: colors.bgSecondary },
    addPlus: { color: colors.accent, fontSize: 28, fontFamily: fonts.serif },
    addLabel: { color: colors.accent, fontSize: 11, fontFamily: fonts.body },
    ownedPill: { position: 'absolute', left: 4, bottom: 22, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999 },
    ownedYes: { backgroundColor: 'rgba(126,201,106,0.85)' },
    ownedNo: { backgroundColor: 'rgba(0,0,0,0.6)' },
    ownedText: { color: '#fff', fontSize: 10, fontFamily: fonts.body },
    rmBtn: { position: 'absolute', top: 4, right: 4, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 999, padding: 2 },
    qtyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 3 },
    qtyBtn: { width: 24, height: 24, borderRadius: 6, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
    qtyBtnOff: { opacity: 0.3 },
    qtyBtnText: { color: colors.textPrimary, fontSize: 15, lineHeight: 18 },
    qtyNum: { color: colors.textPrimary, fontFamily: fonts.body, fontSize: 13, textAlign: 'center', marginTop: 3 },
    capRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
    capChip: { borderWidth: 1, borderColor: colors.border, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
    capText: { color: colors.textSecondary, fontFamily: fonts.bodyBold, fontSize: 12 },
    validity: { marginTop: 12 },
    badge: { alignSelf: 'flex-start', borderWidth: 1, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 2, marginBottom: 6 },
    badgeText: { fontSize: 10, letterSpacing: 0.5, textTransform: 'uppercase', fontFamily: fonts.body },
    countsText: { color: colors.textSecondary, fontFamily: fonts.body, fontSize: 13 },
    problems: { marginTop: 4 },
    problem: { color: colors.textMuted, fontFamily: fonts.body, fontSize: 12 },
    err: { color: colors.danger, fontFamily: fonts.body, fontSize: 13, marginTop: 8 },
    mainHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 18 },
    addCardsBtn: { borderWidth: 1, borderColor: colors.accent, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
    addCardsText: { color: colors.accent, fontFamily: fonts.bodyBold, fontSize: 13 },
    // browser
    browserWrap: { flex: 1, backgroundColor: colors.bgPrimary, padding: 16, paddingTop: 48 },
    browserHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
    browserTitle: { color: colors.accent, fontFamily: fonts.serifBold, fontSize: 16, letterSpacing: 1 },
    search: {
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.bgCard,
      borderRadius: radius.sm,
      paddingHorizontal: 12,
      paddingVertical: 8,
      color: colors.textPrimary,
      fontFamily: fonts.body,
      marginBottom: 8,
    },
    filterRow: { marginBottom: 6 },
    filterLabel: { color: colors.textMuted, fontFamily: fonts.serif, fontSize: 10, letterSpacing: 1.5, marginBottom: 3 },
    chips: { gap: 6, paddingRight: 8 },
    chip: { borderWidth: 1, borderColor: colors.border, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
    chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
    chipText: { color: colors.textSecondary, fontFamily: fonts.body, fontSize: 12 },
    chipTextActive: { color: colors.onAccent, fontFamily: fonts.bodyBold },
    resultGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingTop: 8, paddingBottom: 40 },
    resultCode: { color: colors.textMuted, fontFamily: fonts.body, fontSize: 10, marginTop: 2 },
  });
