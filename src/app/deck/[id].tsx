import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
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
import { useAuth } from '@/lib/auth';
import {
  CardInfo,
  DeckCardRow,
  DeckRow,
  GAME,
  Validity,
  capFor,
  fetchValidity,
  isBase,
  loadRules,
  lookupCards,
  standardLegal,
} from '@/lib/decks';
import { supabase } from '@/lib/supabase';
import { colors, fonts, radius } from '@/lib/theme';

export default function DeckEditorScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { session } = useAuth();

  const [loading, setLoading] = useState(true);
  const [deck, setDeck] = useState<DeckRow | null>(null);
  const [leader, setLeader] = useState<CardInfo | null>(null);
  const [cards, setCards] = useState<DeckCardRow[]>([]);
  const [info, setInfo] = useState<Record<string, CardInfo>>({});
  const [validity, setValidity] = useState<Validity | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [err, setErr] = useState('');
  const infoRef = useRef(info);
  infoRef.current = info;

  const reloadCards = useCallback(
    async (deckId: string) => {
      const { data } = await supabase
        .from('deck_cards')
        .select('card_code,quantity,owned')
        .eq('deck_id', deckId);
      const rows = (data ?? []) as DeckCardRow[];
      const missing = rows.map((r) => r.card_code).filter((c) => !infoRef.current[c]);
      if (missing.length) {
        const fetched = await lookupCards(missing);
        setInfo((prev) => ({ ...prev, ...fetched }));
      }
      setCards(rows);
      setValidity(await fetchValidity(deckId));
    },
    [],
  );

  const open = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    await loadRules();
    const { data: d } = await supabase.from('decks').select('*').eq('id', id).single();
    if (!d) {
      router.back();
      return;
    }
    setDeck(d as DeckRow);
    const lmap = await lookupCards([d.leader_card_code]);
    setLeader(lmap[d.leader_card_code] ?? null);
    await reloadCards(d.id);
    setLoading(false);
  }, [id, reloadCards, router]);

  useEffect(() => {
    open();
  }, [open]);

  async function step(code: string, kind: 'qty' | 'owned', delta: number) {
    const row = cards.find((r) => r.card_code === code);
    if (!row || !deck) return;
    setErr('');
    if (kind === 'qty') {
      const q = row.quantity + delta;
      if (q <= 0) {
        await supabase.from('deck_cards').delete().eq('deck_id', deck.id).eq('card_code', code);
        setSelected(null);
      } else {
        const { error } = await supabase
          .from('deck_cards')
          .update({ quantity: q, owned: Math.min(row.owned, q) })
          .eq('deck_id', deck.id)
          .eq('card_code', code);
        if (error) {
          setErr(error.message);
          return;
        }
      }
    } else {
      const o = Math.max(0, Math.min(row.quantity, row.owned + delta));
      const { error } = await supabase
        .from('deck_cards')
        .update({ owned: o })
        .eq('deck_id', deck.id)
        .eq('card_code', code);
      if (error) {
        setErr(error.message);
        return;
      }
    }
    await reloadCards(deck.id);
  }

  async function addCard(card: CardInfo) {
    if (!deck) return;
    setErr('');
    setInfo((prev) => ({ ...prev, [card.card_code]: card }));
    const existing = cards.find((r) => r.card_code === card.card_code);
    const { error } = existing
      ? await supabase
          .from('deck_cards')
          .update({ quantity: existing.quantity + 1 })
          .eq('deck_id', deck.id)
          .eq('card_code', card.card_code)
      : await supabase.from('deck_cards').insert({ deck_id: deck.id, card_code: card.card_code, quantity: 1 });
    if (error) {
      setErr(error.message);
      return;
    }
    await reloadCards(deck.id);
  }

  async function setFormat(fmt: 'standard' | 'eternal') {
    if (!deck || deck.format === fmt) return;
    setErr('');
    const { error } = await supabase.from('decks').update({ format: fmt }).eq('id', deck.id);
    if (error) {
      setErr(error.message);
      return;
    }
    setDeck({ ...deck, format: fmt });
    setValidity(await fetchValidity(deck.id));
  }

  async function rename(name: string) {
    if (!deck) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    await supabase.from('decks').update({ name: trimmed }).eq('id', deck.id);
    setDeck({ ...deck, name: trimmed });
  }

  async function togglePublish(listingType?: string) {
    if (!deck) return;
    setErr('');
    if (deck.is_public && !listingType) {
      const { error } = await supabase.rpc('unpublish_deck', { p_deck_id: deck.id });
      if (error) {
        setErr(error.message);
        return;
      }
      setDeck({ ...deck, is_public: false, listing_type: null });
    } else {
      const lt = listingType ?? 'trade';
      const { error } = await supabase.rpc('publish_deck', { p_deck_id: deck.id, p_listing_type: lt });
      if (error) {
        setErr(error.message);
        return;
      }
      setDeck({ ...deck, is_public: true, listing_type: lt });
    }
    setValidity(await fetchValidity(deck.id));
  }

  function confirmDelete() {
    if (!deck) return;
    Alert.alert('Delete deck?', `"${deck.name}" will be permanently removed.`, [
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
  }

  if (loading || !deck) {
    return (
      <View style={styles.center}>
        <DiceLoader />
      </View>
    );
  }

  const sorted = cards.slice().sort((a, b) => {
    const ca = info[a.card_code], cb = info[b.card_code];
    return (ca?.cost ?? 99) - (cb?.cost ?? 99) || a.card_code.localeCompare(b.card_code);
  });
  const selectedRow = cards.find((r) => r.card_code === selected) ?? null;
  const total = validity?.total_cards ?? 0;
  const publishable = !!(validity?.valid && validity?.owned_complete);

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: deck.name }} />
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Leader + name + format */}
        <View style={styles.head}>
          {leader?.image_url_lg || leader?.image_url ? (
            <Image
              source={{ uri: leader.image_url_lg || leader.image_url! }}
              style={styles.leaderImg}
              contentFit="contain"
            />
          ) : null}
          <View style={styles.headRight}>
            <TextInput
              defaultValue={deck.name}
              onEndEditing={(e) => rename(e.nativeEvent.text)}
              maxLength={24}
              style={styles.nameInput}
            />
            <View style={styles.pillRow}>
              {(['standard', 'eternal'] as const).map((f) => (
                <Pressable key={f} onPress={() => setFormat(f)} style={[styles.pill, deck.format === f && styles.pillActive]}>
                  <Text style={[styles.pillText, deck.format === f && styles.pillTextActive]}>
                    {f === 'standard' ? 'Standard' : 'Eternal'}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        </View>

        {/* Counts + validity */}
        <Text style={styles.counts}>
          {total}/50 cards · {validity?.owned_cards ?? 0} owned · {validity?.missing_cards ?? 0} missing
        </Text>
        <View style={styles.barTrack}>
          <View style={[styles.barFill, { width: `${Math.min(100, (total / 50) * 100)}%`, backgroundColor: total > 50 ? '#d98a8a' : '#7ec96a' }]} />
        </View>
        {validity?.problems?.length ? (
          <View style={styles.problems}>
            {validity.problems.slice(0, 6).map((p, i) => (
              <Text key={i} style={styles.problem}>
                • {p}
              </Text>
            ))}
          </View>
        ) : null}

        {/* Publish + delete row */}
        <View style={styles.actionRow}>
          <Pressable
            onPress={() => togglePublish()}
            disabled={!deck.is_public && !publishable}
            style={[styles.eyeBtn, deck.is_public && styles.eyeBtnPublic, !deck.is_public && !publishable && { opacity: 0.35 }]}>
            <Ionicons name={deck.is_public ? 'eye' : 'eye-off'} size={18} color={deck.is_public ? '#7ec96a' : colors.textSecondary} />
            <Text style={[styles.eyeLabel, deck.is_public && { color: '#7ec96a' }]}>
              {deck.is_public ? `Public · ${deck.listing_type}` : 'Make public'}
            </Text>
          </Pressable>
          <Pressable onPress={confirmDelete} style={styles.trashBtn}>
            <Ionicons name="trash-outline" size={18} color={colors.danger} />
          </Pressable>
        </View>
        {deck.is_public ? (
          <View style={styles.pillRow}>
            {['trade', 'sell', 'borrow'].map((lt) => (
              <Pressable key={lt} onPress={() => togglePublish(lt)} style={[styles.pill, deck.listing_type === lt && styles.pillActive]}>
                <Text style={[styles.pillText, deck.listing_type === lt && styles.pillTextActive]}>{lt}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        {err ? <Text style={styles.err}>{err}</Text> : null}

        {/* Selected card editor */}
        {selectedRow ? (
          <View style={styles.editor}>
            <Image source={{ uri: info[selectedRow.card_code]?.image_url ?? undefined }} style={styles.editorImg} contentFit="cover" />
            <View style={{ flex: 1 }}>
              <Text style={styles.editorName} numberOfLines={1}>
                {info[selectedRow.card_code]?.name ?? selectedRow.card_code}
              </Text>
              <Stepper
                label="Qty"
                value={selectedRow.quantity}
                onMinus={() => step(selectedRow.card_code, 'qty', -1)}
                onPlus={() => step(selectedRow.card_code, 'qty', 1)}
                plusDisabled={capFor(selectedRow.card_code) !== null && selectedRow.quantity >= (capFor(selectedRow.card_code) as number)}
              />
              <Stepper
                label="Owned"
                value={`${selectedRow.owned}/${selectedRow.quantity}`}
                onMinus={() => step(selectedRow.card_code, 'owned', -1)}
                onPlus={() => step(selectedRow.card_code, 'owned', 1)}
                minusDisabled={selectedRow.owned <= 0}
                plusDisabled={selectedRow.owned >= selectedRow.quantity}
              />
            </View>
          </View>
        ) : null}

        {/* Add Cards */}
        <Pressable style={styles.addCardsBtn} onPress={() => setAddOpen(true)}>
          <Text style={styles.addCardsText}>＋ Add Cards</Text>
        </Pressable>

        {/* Card grid */}
        <View style={styles.cardGrid}>
          {sorted.map((r) => {
            const c = info[r.card_code];
            const isSel = r.card_code === selected;
            return (
              <Pressable
                key={r.card_code}
                style={styles.cardTile}
                onPress={() => setSelected(isSel ? null : r.card_code)}>
                <Image
                  source={{ uri: c?.image_url ?? undefined }}
                  style={[styles.cardImg, isSel && styles.cardImgSel]}
                  contentFit="cover"
                />
                <View style={styles.qtyBadge}>
                  <Text style={styles.qtyText}>{r.quantity > 4 ? 'X' : `x${r.quantity}`}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      <AddCardsModal
        visible={addOpen}
        onClose={() => setAddOpen(false)}
        deck={deck}
        leader={leader}
        cards={cards}
        onAdd={addCard}
      />
    </View>
  );
}

function Stepper({
  label,
  value,
  onMinus,
  onPlus,
  minusDisabled,
  plusDisabled,
}: {
  label: string;
  value: number | string;
  onMinus: () => void;
  onPlus: () => void;
  minusDisabled?: boolean;
  plusDisabled?: boolean;
}) {
  return (
    <View style={styles.stepRow}>
      <Text style={styles.stepLabel}>{label}</Text>
      <Pressable onPress={onMinus} disabled={minusDisabled} style={[styles.stepBtn, minusDisabled && styles.stepBtnOff]}>
        <Text style={styles.stepBtnText}>−</Text>
      </Pressable>
      <Text style={styles.stepVal}>{value}</Text>
      <Pressable onPress={onPlus} disabled={plusDisabled} style={[styles.stepBtn, plusDisabled && styles.stepBtnOff]}>
        <Text style={styles.stepBtnText}>＋</Text>
      </Pressable>
    </View>
  );
}

function AddCardsModal({
  visible,
  onClose,
  deck,
  leader,
  cards,
  onAdd,
}: {
  visible: boolean;
  onClose: () => void;
  deck: DeckRow;
  leader: CardInfo | null;
  cards: DeckCardRow[];
  onAdd: (c: CardInfo) => void;
}) {
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<CardInfo[]>([]);
  const [loading, setLoading] = useState(false);

  const search = useCallback(async () => {
    if (!leader) return;
    setLoading(true);
    const colorOr = String(leader.color ?? '')
      .split('/')
      .filter(Boolean)
      .map((c) => `color.ilike.%${c}%`)
      .join(',');
    let q = supabase
      .from('cards')
      .select('card_code,name,color,cost,type,image_url')
      .eq('game', GAME)
      .neq('type', 'LEADER')
      .order('release_order', { ascending: false })
      .limit(120);
    const term = query.trim();
    if (term) q = q.or(`name.ilike.%${term}%,card_code.ilike.%${term}%`);
    if (colorOr) q = q.or(colorOr);
    const { data } = await q;
    const filtered = (data ?? []).filter(
      (c: any) =>
        isBase(c.card_code) && capFor(c.card_code) !== 0 && (deck.format !== 'standard' || standardLegal(c.card_code)),
    );
    setRows(filtered.slice(0, 60));
    setLoading(false);
  }, [leader, query, deck.format]);

  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(search, 250);
    return () => clearTimeout(t);
  }, [visible, search]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.addModal}>
        <View style={styles.addHeader}>
          <Text style={styles.addTitle}>Add Cards</Text>
          <Pressable onPress={onClose} style={{ padding: 6 }}>
            <Ionicons name="close" size={26} color={colors.textPrimary} />
          </Pressable>
        </View>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search cards by name or code"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          style={styles.input}
        />
        {loading ? <ActivityIndicator color={colors.accent} style={{ marginTop: 16 }} /> : null}
        <ScrollView contentContainerStyle={styles.addGrid} keyboardShouldPersistTaps="handled">
          {rows.map((c) => {
            const inDeck = cards.find((r) => r.card_code === c.card_code);
            return (
              <Pressable key={c.card_code} style={styles.addCardTile} onPress={() => onAdd(c)}>
                <Image source={{ uri: c.image_url ?? undefined }} style={styles.addCardImg} contentFit="cover" />
                <Text style={styles.addCardName} numberOfLines={1}>
                  {c.name}
                  {inDeck ? <Text style={{ color: '#7ec96a' }}> x{inDeck.quantity}</Text> : null}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgPrimary },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bgPrimary },
  scroll: { padding: 16, paddingBottom: 48 },

  head: { flexDirection: 'row', gap: 14 },
  leaderImg: { width: 110, height: 154, borderRadius: 8 },
  headRight: { flex: 1, justifyContent: 'flex-start', gap: 12 },
  nameInput: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgCard,
    borderRadius: radius.sm,
    padding: 10,
    fontSize: 15,
    color: colors.textPrimary,
    fontFamily: fonts.body,
  },

  counts: { color: colors.textSecondary, fontFamily: fonts.body, fontSize: 13, marginTop: 16 },
  barTrack: { height: 10, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.08)', overflow: 'hidden', marginTop: 8 },
  barFill: { height: '100%' },
  problems: { marginTop: 8 },
  problem: { color: '#d98a8a', fontFamily: fonts.body, fontSize: 12, lineHeight: 18 },

  actionRow: { flexDirection: 'row', gap: 10, marginTop: 14, alignItems: 'center' },
  eyeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  eyeBtnPublic: { borderColor: '#7ec96a' },
  eyeLabel: { color: colors.textSecondary, fontFamily: fonts.body, fontSize: 13 },
  trashBtn: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 9 },

  err: { color: colors.danger, fontFamily: fonts.body, fontSize: 13, marginTop: 8 },

  editor: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: 10,
    marginTop: 16,
  },
  editorImg: { width: 46, height: 64, borderRadius: 4 },
  editorName: { color: colors.textPrimary, fontFamily: fonts.body, fontSize: 14, marginBottom: 6 },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  stepLabel: { color: colors.textMuted, fontFamily: fonts.body, fontSize: 11, width: 48 },
  stepBtn: {
    width: 30,
    height: 30,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtnOff: { opacity: 0.3 },
  stepBtnText: { color: colors.textPrimary, fontSize: 16, lineHeight: 18 },
  stepVal: { color: colors.textPrimary, fontFamily: fonts.body, fontSize: 14, minWidth: 44, textAlign: 'center' },

  addCardsBtn: {
    alignSelf: 'flex-end',
    backgroundColor: colors.accent,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: radius.sm,
    marginTop: 16,
  },
  addCardsText: { color: colors.bgPrimary, fontFamily: fonts.serifBold, fontSize: 13, letterSpacing: 1 },

  cardGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  cardTile: { width: '18.5%', position: 'relative' },
  cardImg: { width: '100%', aspectRatio: 0.72, borderRadius: 6 },
  cardImgSel: { borderWidth: 2, borderColor: colors.accent },
  qtyBadge: {
    position: 'absolute',
    top: 3,
    right: 3,
    backgroundColor: 'rgba(12,10,18,0.85)',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  qtyText: { color: colors.textPrimary, fontFamily: fonts.body, fontSize: 11 },

  pillRow: { flexDirection: 'row', gap: 8, marginTop: 8, flexWrap: 'wrap' },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgCard,
  },
  pillActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  pillText: { color: colors.textSecondary, fontFamily: fonts.body, fontSize: 13, letterSpacing: 1 },
  pillTextActive: { color: colors.bgPrimary, fontFamily: fonts.serifBold },

  input: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgCard,
    borderRadius: radius.sm,
    padding: 12,
    fontSize: 15,
    color: colors.textPrimary,
    fontFamily: fonts.body,
  },

  addModal: { flex: 1, backgroundColor: colors.bgPrimary, paddingTop: 56, paddingHorizontal: 16 },
  addHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  addTitle: { color: colors.textPrimary, fontFamily: fonts.serifBold, fontSize: 18 },
  addGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingVertical: 14 },
  addCardTile: { width: '30%' },
  addCardImg: { width: '100%', aspectRatio: 0.72, borderRadius: 6 },
  addCardName: { color: colors.textSecondary, fontFamily: fonts.body, fontSize: 11, marginTop: 4 },
});
