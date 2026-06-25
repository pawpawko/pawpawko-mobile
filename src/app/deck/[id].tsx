import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';

import { DiceLoader } from '@/components/dice-loader';
import { useAuth } from '@/lib/auth';
import {
  CardInfo,
  DeckCardRow,
  DeckRow,
  GAME,
  OwnedElsewhere,
  SearcherMeta,
  Validity,
  capFor,
  cardMatchesSub,
  evalSearcherGate,
  fetchValidity,
  formatDecklist,
  hitChance,
  isBase,
  leaderLocked,
  loadOwnedElsewhere,
  loadRules,
  lookupCards,
  parseDecklist,
  parseSearcher,
  searcherTargetLabel,
  standardLegal,
} from '@/lib/decks';
import { supabase } from '@/lib/supabase';
import { colors, fonts, radius } from '@/lib/theme';

const artKey = (deckId: string) => `pawpaw:deckArt:${deckId}`;
// Per-card alt-art override map, persisted separately from the leader's art.
const cardArtKey = (deckId: string) => `pawpaw:deckCardArt:${deckId}`;
type ArtRow = { card_code: string; image_url: string | null; image_url_lg: string | null };

// Deck card grid: a fixed column count whose tile width is derived from the
// screen width so cards scale across phone sizes (and fill the row edge-to-edge).
const GRID_COLS = 5;
const GRID_GAP = 8;
const SCROLL_PAD = 16;

type PriceRow = {
  code: string;
  name: string;
  rarity: string;
  img: string | null;
  need: number;
  price: number | null;
  line: number | null;
};

export default function DeckEditorScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { session } = useAuth();
  const { width: screenW } = useWindowDimensions();
  const cardW = (screenW - SCROLL_PAD * 2 - GRID_GAP * (GRID_COLS - 1)) / GRID_COLS;

  const [loading, setLoading] = useState(true);
  const [deck, setDeck] = useState<DeckRow | null>(null);
  const [leader, setLeader] = useState<CardInfo | null>(null);
  // Leader alt-arts: base print + its _p variants. Chosen art is a display-only
  // preference persisted per deck in AsyncStorage; it never changes the deck's
  // leader_card_code (which is the validity-relevant identity).
  const [leaderArts, setLeaderArts] = useState<
    { card_code: string; image_url: string | null; image_url_lg: string | null }[]
  >([]);
  const [artIdx, setArtIdx] = useState(0);
  // Per-card alt-art: the deck stores BASE codes, so a chosen print is a
  // display-only override persisted per deck+card (mirrors web cardArt).
  // `cardArt` maps base code → chosen alt-print row (drives the grid tiles);
  // `selArts`/`selArtIdx` drive the swap button in the selected-card editor.
  const [cardArt, setCardArt] = useState<Record<string, ArtRow>>({});
  const [selArts, setSelArts] = useState<ArtRow[]>([]);
  const [selArtIdx, setSelArtIdx] = useState(0);
  const cardArtRef = useRef<Record<string, ArtRow>>({});
  cardArtRef.current = cardArt;
  const [cards, setCards] = useState<DeckCardRow[]>([]);
  // Copies of each base card you physically hold in non-wishlist binders —
  // powers the 📦 owned-elsewhere badge (tap to mark owned).
  const [ownedElsewhere, setOwnedElsewhere] = useState<OwnedElsewhere>({});
  const [info, setInfo] = useState<Record<string, CardInfo>>({});
  const [validity, setValidity] = useState<Validity | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [showMissing, setShowMissing] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [err, setErr] = useState('');

  // Decklist import (paste NxCODE lines → merge into this deck)
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const infoRef = useRef(info);
  infoRef.current = info;

  // Owner vs shared-deck collaborator. Card editing works for any member via
  // RLS, so we only gate owner-only controls (publish / delete / partner mgmt).
  const isOwner = !!(deck && session?.user.id && deck.user_id === session.user.id);

  // Partner management (owner-only; share_deck validates the named account is
  // your trade-binder co-owner for this game).
  const [partners, setPartners] = useState<{ user_id: string; display_name: string }[]>([]);
  const [pendingInvite, setPendingInvite] = useState<{ user_id: string; display_name: string } | null>(null);
  const [partnerName, setPartnerName] = useState('');
  const [partnerBusy, setPartnerBusy] = useState(false);
  const [partnerMsg, setPartnerMsg] = useState<string | null>(null);

  // Cost to Finish (missing copies) / Cost of Deck (whole deck) — each card at
  // its cached cheapest single price (cards.price_usd, kept fresh by the weekly
  // update_prices cron). Mirrors the web js/decks.js price breakdown.
  const [priceOpen, setPriceOpen] = useState(false);
  const [priceMode, setPriceMode] = useState<'finish' | 'deck'>('finish');
  const [priceLoading, setPriceLoading] = useState(false);
  const [priceRows, setPriceRows] = useState<PriceRow[]>([]);
  const [priceTotal, setPriceTotal] = useState(0);
  const [priceCopies, setPriceCopies] = useState(0);
  const [priceFoot, setPriceFoot] = useState('');
  const [priceErr, setPriceErr] = useState<string | null>(null);

  async function openPrices(mode: 'finish' | 'deck') {
    if (!deck) return;
    setPriceMode(mode);
    setPriceOpen(true);
    setPriceLoading(true);
    setPriceErr(null);
    setPriceRows([]);
    setPriceTotal(0);
    setPriceCopies(0);
    setPriceFoot('');

    // Deck = leader + every card at full quantity; Finish = only the copies short.
    const items =
      mode === 'deck'
        ? [{ code: deck.leader_card_code, need: 1 }, ...cards.map((r) => ({ code: r.card_code, need: r.quantity }))]
        : cards.map((r) => ({ code: r.card_code, need: r.quantity - r.owned })).filter((x) => x.need > 0);

    if (!items.length) {
      setPriceLoading(false);
      setPriceFoot(
        mode === 'deck'
          ? 'This deck has no cards yet.'
          : 'Nothing missing — every card in this deck is owned. 🎉',
      );
      return;
    }

    const codes = items.map((x) => x.code);
    const priceMap: Record<
      string,
      { name?: string; rarity?: string; image_url?: string | null; price_usd?: number | null; price_updated_at?: string | null }
    > = {};
    for (let i = 0; i < codes.length; i += 100) {
      const { data, error } = await supabase
        .from('cards')
        .select('card_code,name,rarity,image_url,price_usd,price_updated_at')
        .eq('game', GAME)
        .in('card_code', codes.slice(i, i + 100));
      if (error) {
        setPriceErr(error.message);
        setPriceLoading(false);
        return;
      }
      (data ?? []).forEach((c: any) => {
        priceMap[c.card_code] = c;
      });
    }

    let total = 0;
    let unpriced = 0;
    let lastUpdated: string | null = null;
    const rows: PriceRow[] = items
      .map((x) => {
        const c = priceMap[x.code] ?? {};
        const fb = info[x.code] ?? ({} as CardInfo);
        const price = c.price_usd != null ? Number(c.price_usd) : null;
        if (price == null) unpriced++;
        else total += price * x.need;
        if (c.price_updated_at && (!lastUpdated || c.price_updated_at > lastUpdated)) lastUpdated = c.price_updated_at;
        return {
          code: x.code,
          name: c.name || fb.name || x.code,
          rarity: c.rarity || '',
          img: c.image_url || fb.image_url || null,
          need: x.need,
          price,
          line: price == null ? null : price * x.need,
        };
      })
      .sort((a, b) => (b.line ?? -1) - (a.line ?? -1)); // dearest first (cost drivers on top)

    const copies = rows.reduce((s, r) => s + r.need, 0);
    let foot: string;
    if (total === 0 && unpriced === rows.length) {
      foot = 'No prices loaded yet.';
    } else {
      const parts = ['Cheapest single · TCGplayer via Limitless'];
      if (lastUpdated) parts.push('updated ' + new Date(lastUpdated).toLocaleDateString());
      if (unpriced) parts.push(`${unpriced} card${unpriced === 1 ? '' : 's'} not priced yet`);
      foot = parts.join(' · ');
    }

    setPriceRows(rows);
    setPriceTotal(total);
    setPriceCopies(copies);
    setPriceFoot(foot);
    setPriceLoading(false);
  }

  // Accepted collaborator(s) plus any still-pending invite, so the UI can show
  // the invited partner's name (awaiting acceptance) instead of the add form.
  const loadPartners = useCallback(async () => {
    if (!id) return;
    const [{ data: collabs }, { data: pending }] = await Promise.all([
      supabase.rpc('deck_collaborators_list', { p_deck_id: id }),
      supabase.rpc('deck_pending_invite', { p_deck_id: id }),
    ]);
    setPartners((collabs as { user_id: string; display_name: string }[]) ?? []);
    setPendingInvite(((pending as { user_id: string; display_name: string }[]) ?? [])[0] ?? null);
  }, [id]);

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

    // Alt arts: the base print plus its _p variants (same card number).
    const { data: arts } = await supabase
      .from('cards')
      .select('card_code,image_url,image_url_lg')
      .eq('game', GAME)
      .like('card_code', d.leader_card_code + '%');
    const artRe = new RegExp(
      `^${String(d.leader_card_code).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(_p\\d+)?$`,
      'i',
    );
    const list = (arts ?? [])
      .filter((c: any) => artRe.test(c.card_code))
      .sort((a: any, b: any) => a.card_code.localeCompare(b.card_code));
    setLeaderArts(list);
    const saved = await AsyncStorage.getItem(artKey(d.id));
    setArtIdx(Math.max(0, list.findIndex((c) => c.card_code === saved)));

    // Restore per-card alt-art choices (deck-grid display overrides). Only
    // alt prints (_p…) are persisted; base prints use the default image.
    const restored: Record<string, ArtRow> = {};
    try {
      const raw = await AsyncStorage.getItem(cardArtKey(d.id));
      const savedMap: Record<string, string> = raw ? JSON.parse(raw) : {};
      const codes = Object.values(savedMap).filter((x) => /_p\d+$/i.test(String(x)));
      if (codes.length) {
        const { data: artRows } = await supabase
          .from('cards')
          .select('card_code,image_url,image_url_lg')
          .eq('game', GAME)
          .in('card_code', codes);
        const byCode: Record<string, ArtRow> = {};
        (artRows ?? []).forEach((c: any) => {
          byCode[c.card_code] = c;
        });
        Object.keys(savedMap).forEach((base) => {
          const row = byCode[savedMap[base]];
          if (row) restored[base] = row;
        });
      }
    } catch {}
    setCardArt(restored);

    if (session?.user.id) setOwnedElsewhere(await loadOwnedElsewhere(session.user.id));

    await reloadCards(d.id);
    setLoading(false);
  }, [id, reloadCards, router, session?.user.id]);

  function cycleArt() {
    if (leaderArts.length < 2 || !deck) return;
    const next = (artIdx + 1) % leaderArts.length;
    setArtIdx(next);
    AsyncStorage.setItem(artKey(deck.id), leaderArts[next].card_code).catch(() => {});
  }

  // Load the selected card's prints (base + _p variants) so the editor can
  // offer an art swap. Reads cardArt via a ref so cycling doesn't re-fetch.
  useEffect(() => {
    if (!selected) {
      setSelArts([]);
      setSelArtIdx(0);
      return;
    }
    const base = selected;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('cards')
        .select('card_code,image_url,image_url_lg')
        .eq('game', GAME)
        .like('card_code', base + '%');
      const re = new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(_p\\d+)?$`, 'i');
      const arts = (data ?? [])
        .filter((c: any) => re.test(c.card_code))
        .sort((a: any, b: any) => a.card_code.localeCompare(b.card_code)) as ArtRow[];
      if (cancelled) return;
      setSelArts(arts);
      const chosen = cardArtRef.current[base]?.card_code;
      setSelArtIdx(Math.max(0, arts.findIndex((c) => c.card_code === chosen)));
    })();
    return () => {
      cancelled = true;
    };
  }, [selected]);

  function persistCardArt(deckId: string, m: Record<string, ArtRow>) {
    const out: Record<string, string> = {};
    Object.keys(m).forEach((base) => {
      if (m[base]) out[base] = m[base].card_code;
    });
    AsyncStorage.setItem(cardArtKey(deckId), JSON.stringify(out)).catch(() => {});
  }

  function cycleCardArt() {
    if (selArts.length < 2 || !deck || !selected) return;
    const base = selected;
    const next = (selArtIdx + 1) % selArts.length;
    setSelArtIdx(next);
    const row = selArts[next];
    setCardArt((prev) => {
      const m = { ...prev };
      if (/_p\d+$/i.test(row.card_code)) m[base] = row; // alt print → grid override
      else delete m[base]; // back to base print → no override
      persistCardArt(deck.id, m);
      return m;
    });
  }

  useEffect(() => {
    if (deck && isOwner) loadPartners();
  }, [deck, isOwner, loadPartners]);

  // Prefill the invite box with your trade-binder partner for this game — the
  // only account a deck can be shared with. Editable; user still taps Invite.
  // Never clobbers text the user has already typed.
  useEffect(() => {
    if (!deck || !isOwner || !id) return;
    if (partners.length || pendingInvite) return; // already shared / pending
    let cancelled = false;
    (async () => {
      const { data } = await supabase.rpc('deck_trade_partner', { p_deck_id: id });
      const tp = ((data as { user_id: string; display_name: string }[]) ?? [])[0];
      if (!cancelled && tp?.display_name) setPartnerName((cur) => cur || tp.display_name);
    })();
    return () => {
      cancelled = true;
    };
  }, [deck, isOwner, id, partners.length, pendingInvite]);

  async function invitePartner() {
    const nm = partnerName.trim();
    if (!nm) return;
    setPartnerBusy(true);
    setPartnerMsg(null);
    const { error } = await supabase.rpc('share_deck', { p_deck_id: id, p_display_name: nm });
    setPartnerBusy(false);
    if (error) {
      setPartnerMsg(error.message);
      return;
    }
    setPartnerName('');
    setPartnerMsg(`Invite sent to ${nm} — they'll get a notification to accept.`);
    loadPartners();
  }

  async function removePartner(uid: string) {
    const { error } = await supabase.rpc('unshare_deck', { p_deck_id: id, p_user_id: uid });
    if (error) {
      setPartnerMsg(error.message);
      return;
    }
    loadPartners();
  }

  // Cancel a still-pending invite (before the partner accepts).
  async function rescindInvite() {
    setPartnerBusy(true);
    setPartnerMsg(null);
    const { error } = await supabase.rpc('rescind_deck_invite', { p_deck_id: id });
    setPartnerBusy(false);
    if (error) {
      setPartnerMsg(error.message);
      return;
    }
    loadPartners();
  }

  useEffect(() => {
    open();
  }, [open]);

  // ---- Realtime: a partner's edit on a shared deck refreshes it live ----
  // (public.deck_cards is in the Realtime publication.) Steps are
  // write-then-reloadCards, so a debounced reload here only adds partner edits.
  const rtTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!id) return;
    const channel = supabase
      .channel('deckcards-' + id)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'deck_cards', filter: 'deck_id=eq.' + id },
        () => {
          if (rtTimer.current) clearTimeout(rtTimer.current);
          rtTimer.current = setTimeout(() => reloadCards(id), 350);
        },
      )
      .subscribe();
    return () => {
      if (rtTimer.current) clearTimeout(rtTimer.current);
      supabase.removeChannel(channel);
    };
  }, [id, reloadCards]);

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

  // Press-and-hold a stepper to jump to the extreme (mirrors web setCardValue):
  // qty min→1 / max→cap (or 50 for unlimited cards); owned min→0 / max→qty.
  async function jump(code: string, kind: 'qty' | 'owned', dir: 'min' | 'max') {
    const row = cards.find((r) => r.card_code === code);
    if (!row || !deck) return;
    setErr('');
    if (kind === 'qty') {
      const cap = capFor(code);
      const q = dir === 'min' ? 1 : cap ?? 50;
      if (q === row.quantity) return;
      const { error } = await supabase
        .from('deck_cards')
        .update({ quantity: q, owned: Math.min(row.owned, q) })
        .eq('deck_id', deck.id)
        .eq('card_code', code);
      if (error) {
        setErr(error.message);
        return;
      }
    } else {
      const o = dir === 'min' ? 0 : row.quantity;
      if (o === row.owned) return;
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

  // Mark owned up to an absolute value (clamped to [0, qty]); used by the
  // owned-elsewhere badge to reconcile the deck against your binder count.
  async function markOwned(code: string, value: number) {
    const row = cards.find((r) => r.card_code === code);
    if (!row || !deck) return;
    const o = Math.max(0, Math.min(row.quantity, value));
    if (o === row.owned) return;
    setErr('');
    const { error } = await supabase
      .from('deck_cards')
      .update({ owned: o })
      .eq('deck_id', deck.id)
      .eq('card_code', code);
    if (error) {
      setErr(error.message);
      return;
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

  // Export the current deck as NxCODE text (leader as a 1x line) via the native
  // share sheet (which offers Copy). Mirrors web formatDecklist export.
  async function exportList() {
    if (!deck) return;
    try {
      await Share.share({ message: formatDecklist(deck.leader_card_code, cards, info) });
    } catch {}
  }

  // Import a pasted NxCODE list and merge it into this deck. The leader line is
  // ignored (leader is fixed here); each card is set to its listed quantity
  // (clamped to the copy cap). Cards the gatekeeper rejects (wrong color / ban /
  // rotation) are reported, not silently dropped.
  async function doImport() {
    if (!deck) return;
    setImportBusy(true);
    setImportMsg(null);
    const { rows: parsed, errors } = parseDecklist(importText);
    parsed.delete(deck.leader_card_code);
    let added = 0;
    const failed: string[] = [];
    for (const [code, qtyRaw] of parsed) {
      const cap = capFor(code);
      if (cap === 0) {
        failed.push(code); // banned
        continue;
      }
      const qty = cap != null ? Math.min(qtyRaw, cap) : qtyRaw;
      const existing = cards.find((r) => r.card_code === code);
      const { error } = existing
        ? await supabase
            .from('deck_cards')
            .update({ quantity: qty, owned: Math.min(existing.owned, qty) })
            .eq('deck_id', deck.id)
            .eq('card_code', code)
        : await supabase.from('deck_cards').insert({ deck_id: deck.id, card_code: code, quantity: qty });
      if (error) failed.push(code);
      else added++;
    }
    await reloadCards(deck.id);
    setImportBusy(false);
    const parts = [`Imported ${added} card${added === 1 ? '' : 's'}.`];
    if (errors.length) parts.push(`${errors.length} line${errors.length === 1 ? '' : 's'} unreadable.`);
    if (failed.length)
      parts.push(`${failed.length} not legal here: ${failed.slice(0, 6).join(', ')}${failed.length > 6 ? '…' : ''}.`);
    setImportMsg(parts.join(' '));
    if (added && !failed.length && !errors.length) setImportText('');
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
  const missingCount = validity?.missing_cards ?? 0;
  const art = leaderArts[artIdx];
  const leaderUri =
    art?.image_url_lg || art?.image_url || leader?.image_url_lg || leader?.image_url || undefined;

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: deck.name }} />
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Leader (tap swap icon to cycle alt arts) + name + format + actions */}
        <View style={styles.head}>
          <View style={styles.leaderWrap}>
            {leaderUri ? (
              <Image source={{ uri: leaderUri }} style={styles.leaderImg} contentFit="contain" />
            ) : null}
            {leaderArts.length > 1 ? (
              <Pressable onPress={cycleArt} style={styles.artSwap} accessibilityLabel="Swap leader art">
                <Ionicons name="sync" size={16} color="#fff" />
              </Pressable>
            ) : null}
          </View>
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
            {/* Publish (eye only) + delete, sized to the leader's height.
                Publish/delete are owner-only; collaborators co-edit cards. */}
            <View style={styles.actionRow}>
              {isOwner ? (
                <>
                  <Pressable
                    onPress={() => togglePublish()}
                    disabled={!deck.is_public && !publishable}
                    accessibilityLabel={deck.is_public ? 'Unpublish deck' : 'Make deck public'}
                    style={[
                      styles.eyeBtn,
                      deck.is_public && styles.eyeBtnPublic,
                      !deck.is_public && !publishable && { opacity: 0.35 },
                    ]}>
                    <Ionicons
                      name={deck.is_public ? 'eye' : 'eye-off'}
                      size={18}
                      color={deck.is_public ? '#7ec96a' : colors.textSecondary}
                    />
                  </Pressable>
                  <Pressable onPress={confirmDelete} style={styles.trashBtn} accessibilityLabel="Delete deck">
                    <Ionicons name="trash-outline" size={18} color={colors.danger} />
                  </Pressable>
                </>
              ) : null}
              {/* Stats — counters / cost curve / searcher hit-rates */}
              <Pressable onPress={() => setStatsOpen(true)} style={styles.statsBtn} accessibilityLabel="Deck stats">
                <Ionicons name="stats-chart-outline" size={18} color={colors.textSecondary} />
              </Pressable>
              {/* Cost to Finish — price of the cards still needed */}
              <Pressable onPress={() => openPrices('finish')} style={styles.statsBtn} accessibilityLabel="Cost to finish">
                <Ionicons name="cash-outline" size={18} color={colors.textSecondary} />
              </Pressable>
              {/* Export / import decklist (NxCODE) */}
              <Pressable onPress={exportList} style={styles.statsBtn} accessibilityLabel="Export decklist">
                <Ionicons name="share-outline" size={18} color={colors.textSecondary} />
              </Pressable>
              <Pressable
                onPress={() => {
                  setImportMsg(null);
                  setImportOpen(true);
                }}
                style={styles.statsBtn}
                accessibilityLabel="Import decklist">
                <Ionicons name="download-outline" size={18} color={colors.textSecondary} />
              </Pressable>
            </View>
          </View>
        </View>

        {/* Counts + validity — tap "N missing" to highlight unowned cards */}
        <Text style={styles.counts}>
          {total}/50 cards · {validity?.owned_cards ?? 0} owned ·{' '}
          <Text
            onPress={missingCount > 0 ? () => setShowMissing((v) => !v) : undefined}
            style={[missingCount > 0 && styles.missingLink, showMissing && styles.missingLinkActive]}>
            {missingCount} missing
          </Text>
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

        {/* Listing type — shown when public so the eye stays word-free */}
        {deck.is_public ? (
          <View style={styles.pillRow}>
            {['trade', 'sell', 'borrow'].map((lt) => (
              <Pressable key={lt} onPress={() => togglePublish(lt)} style={[styles.pill, deck.listing_type === lt && styles.pillActive]}>
                <Text style={[styles.pillText, deck.listing_type === lt && styles.pillTextActive]}>{lt}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        {/* Share with partner (owner-only; goes to your trade-binder partner) */}
        {isOwner ? (
          <View style={styles.partnerSection}>
            <Text style={styles.partnerLabel}>Share with partner</Text>
            {partners.length > 0 ? (
              partners.map((p) => (
                <View key={p.user_id} style={styles.partnerChip}>
                  <Text style={styles.partnerChipName}>{p.display_name || 'partner'}</Text>
                  <Pressable
                    onPress={() => removePartner(p.user_id)}
                    hitSlop={8}
                    accessibilityLabel="Remove partner">
                    <Ionicons name="close" size={16} color={colors.textMuted} />
                  </Pressable>
                </View>
              ))
            ) : pendingInvite ? (
              <View style={styles.partnerChip}>
                <View style={styles.partnerPendingRow}>
                  <Text style={styles.partnerChipName}>
                    {pendingInvite.display_name || 'partner'}
                  </Text>
                  <Text style={styles.partnerPending}>pending</Text>
                </View>
                <Pressable
                  onPress={rescindInvite}
                  hitSlop={8}
                  accessibilityLabel="Cancel invite">
                  <Ionicons name="close" size={16} color={colors.textMuted} />
                </Pressable>
              </View>
            ) : (
              <View style={styles.partnerRow}>
                <TextInput
                  value={partnerName}
                  onChangeText={setPartnerName}
                  placeholder="Partner's display name"
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="none"
                  style={styles.partnerInput}
                />
                <Pressable
                  disabled={partnerBusy || !partnerName.trim()}
                  onPress={invitePartner}
                  style={[styles.partnerBtn, (partnerBusy || !partnerName.trim()) && { opacity: 0.4 }]}>
                  {partnerBusy ? (
                    <ActivityIndicator color={colors.bgPrimary} />
                  ) : (
                    <Text style={styles.partnerBtnText}>Invite</Text>
                  )}
                </Pressable>
              </View>
            )}
            {partnerMsg ? <Text style={styles.partnerMsg}>{partnerMsg}</Text> : null}
          </View>
        ) : null}

        {err ? <Text style={styles.err}>{err}</Text> : null}

        {/* Selected card editor */}
        {selectedRow ? (
          <View style={styles.editor}>
            <View style={styles.editorImgWrap}>
              <Image
                source={{
                  uri:
                    selArts[selArtIdx]?.image_url ??
                    cardArt[selectedRow.card_code]?.image_url ??
                    info[selectedRow.card_code]?.image_url ??
                    undefined,
                }}
                style={styles.editorImg}
                contentFit="cover"
              />
              {selArts.length > 1 ? (
                <Pressable onPress={cycleCardArt} style={styles.cardArtSwap} accessibilityLabel="Swap card art">
                  <Ionicons name="sync" size={12} color="#fff" />
                </Pressable>
              ) : null}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.editorName} numberOfLines={1}>
                {info[selectedRow.card_code]?.name ?? selectedRow.card_code}
              </Text>
              <Stepper
                label="Qty"
                value={selectedRow.quantity}
                onMinus={() => step(selectedRow.card_code, 'qty', -1)}
                onPlus={() => step(selectedRow.card_code, 'qty', 1)}
                onLongMinus={() => jump(selectedRow.card_code, 'qty', 'min')}
                onLongPlus={() => jump(selectedRow.card_code, 'qty', 'max')}
                plusDisabled={capFor(selectedRow.card_code) !== null && selectedRow.quantity >= (capFor(selectedRow.card_code) as number)}
              />
              <Stepper
                label="Owned"
                value={`${selectedRow.owned}/${selectedRow.quantity}`}
                onMinus={() => step(selectedRow.card_code, 'owned', -1)}
                onPlus={() => step(selectedRow.card_code, 'owned', 1)}
                onLongMinus={() => jump(selectedRow.card_code, 'owned', 'min')}
                onLongPlus={() => jump(selectedRow.card_code, 'owned', 'max')}
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
            const isShort = r.owned < r.quantity;
            const highlight = showMissing && isShort; // unowned copies → flag it
            const dim = showMissing && !isShort; // fully owned → fade back
            // Owned-elsewhere: this card is short in the deck but you hold more
            // copies in a non-wishlist binder than you've marked owned. Badge →
            // tap to mark owned up to your held count (never down).
            const oeRow = ownedElsewhere[r.card_code];
            const oe = isShort && oeRow && oeRow.qty > r.owned ? oeRow : null;
            return (
              <Pressable
                key={r.card_code}
                style={[styles.cardTile, { width: cardW }, dim && styles.tileDim]}
                onPress={() => setSelected(isSel ? null : r.card_code)}>
                <Image
                  source={{ uri: cardArt[r.card_code]?.image_url ?? c?.image_url ?? undefined }}
                  style={[styles.cardImg, isSel && styles.cardImgSel, highlight && styles.cardImgMissing]}
                  contentFit="cover"
                />
                <View style={[styles.qtyBadge, highlight && styles.qtyBadgeMissing]}>
                  <Text style={styles.qtyText}>
                    {highlight ? `x${r.quantity - r.owned}` : r.quantity > 4 ? 'X' : `x${r.quantity}`}
                  </Text>
                </View>
                {oe ? (
                  <Pressable
                    style={styles.oeBadge}
                    onPress={() => markOwned(r.card_code, Math.min(r.quantity, Math.max(r.owned, oe.qty)))}
                    accessibilityLabel={`You have ${oe.qty} in ${oe.binders.join(', ')} — tap to mark owned`}>
                    <Text style={styles.oeText}>📦 ×{oe.qty}</Text>
                  </Pressable>
                ) : null}
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

      <StatsModal visible={statsOpen} onClose={() => setStatsOpen(false)} cards={cards} info={info} leader={leader} />

      <Modal visible={importOpen} animationType="slide" onRequestClose={() => setImportOpen(false)}>
        <View style={styles.addModal}>
          <View style={styles.addHeader}>
            <Text style={styles.addTitle}>Import decklist</Text>
            <Pressable onPress={() => setImportOpen(false)} style={{ padding: 6 }}>
              <Ionicons name="close" size={26} color={colors.textPrimary} />
            </Pressable>
          </View>
          <Text style={styles.importHint}>
            Paste NxCODE lines (e.g. “4xOP01-016”). The leader line is ignored; cards merge into this deck and are
            clamped to the copy cap.
          </Text>
          <TextInput
            value={importText}
            onChangeText={setImportText}
            placeholder={'4xOP01-016\n3xOP01-024'}
            placeholderTextColor={colors.textMuted}
            autoCapitalize="characters"
            autoCorrect={false}
            multiline
            style={styles.importInput}
          />
          {importMsg ? <Text style={styles.partnerMsg}>{importMsg}</Text> : null}
          <Pressable
            disabled={importBusy || !importText.trim()}
            onPress={doImport}
            style={[styles.partnerBtn, { marginTop: 12 }, (importBusy || !importText.trim()) && { opacity: 0.4 }]}>
            {importBusy ? (
              <ActivityIndicator color={colors.bgPrimary} />
            ) : (
              <Text style={styles.partnerBtnText}>Import</Text>
            )}
          </Pressable>
        </View>
      </Modal>

      <Modal visible={priceOpen} animationType="slide" onRequestClose={() => setPriceOpen(false)}>
        <View style={styles.priceModal}>
          <View style={styles.addHeader}>
            <Text style={styles.addTitle}>{priceMode === 'deck' ? 'Cost of Deck' : 'Cost to Finish'}</Text>
            <Pressable onPress={() => setPriceOpen(false)} style={{ padding: 6 }}>
              <Ionicons name="close" size={26} color={colors.textPrimary} />
            </Pressable>
          </View>
          <View style={styles.priceToggle}>
            {(['finish', 'deck'] as const).map((m) => (
              <Pressable key={m} onPress={() => openPrices(m)} style={[styles.pill, priceMode === m && styles.pillActive]}>
                <Text style={[styles.pillText, priceMode === m && styles.pillTextActive]}>
                  {m === 'finish' ? 'Cards I need' : 'Whole deck'}
                </Text>
              </Pressable>
            ))}
          </View>
          {priceLoading ? (
            <ActivityIndicator color={colors.accent} style={{ marginTop: 24 }} />
          ) : priceErr ? (
            <Text style={styles.priceErr}>Couldn’t load prices: {priceErr}</Text>
          ) : priceRows.length === 0 ? (
            <Text style={styles.priceEmpty}>{priceFoot}</Text>
          ) : (
            <>
              <Text style={styles.priceTotal}>
                Total ≈ ${priceTotal.toFixed(2)}{' '}
                <Text style={styles.priceTotalSub}>
                  for {priceCopies} card{priceCopies === 1 ? '' : 's'}
                </Text>
              </Text>
              <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
                {priceRows.map((r) => (
                  <View key={r.code} style={[styles.priceRow, r.price == null && { opacity: 0.5 }]}>
                    <Image source={{ uri: r.img ?? undefined }} style={styles.priceImg} contentFit="cover" />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.priceName} numberOfLines={1}>
                        {r.name}
                      </Text>
                      <Text style={styles.priceCode}>
                        {r.code}
                        {r.rarity ? ` · ${r.rarity}` : ''}
                      </Text>
                    </View>
                    <Text style={styles.priceNeed}>×{r.need}</Text>
                    <Text style={styles.priceEach}>{r.price == null ? '—' : `$${r.price.toFixed(2)}`}</Text>
                    <Text style={styles.priceLine}>{r.line == null ? '—' : `$${r.line.toFixed(2)}`}</Text>
                  </View>
                ))}
                <Text style={styles.priceFoot}>{priceFoot}</Text>
              </ScrollView>
            </>
          )}
        </View>
      </Modal>
    </View>
  );
}

function Stepper({
  label,
  value,
  onMinus,
  onPlus,
  onLongMinus,
  onLongPlus,
  minusDisabled,
  plusDisabled,
}: {
  label: string;
  value: number | string;
  onMinus: () => void;
  onPlus: () => void;
  // Press-and-hold jumps to the extreme; RN suppresses onPress after a long
  // press fires, so no separate guard is needed (cf. web's holdJustFired).
  onLongMinus?: () => void;
  onLongPlus?: () => void;
  minusDisabled?: boolean;
  plusDisabled?: boolean;
}) {
  return (
    <View style={styles.stepRow}>
      <Text style={styles.stepLabel}>{label}</Text>
      <Pressable
        onPress={onMinus}
        onLongPress={onLongMinus}
        delayLongPress={450}
        disabled={minusDisabled}
        style={[styles.stepBtn, minusDisabled && styles.stepBtnOff]}>
        <Text style={styles.stepBtnText}>−</Text>
      </Pressable>
      <Text style={styles.stepVal}>{value}</Text>
      <Pressable
        onPress={onPlus}
        onLongPress={onLongPlus}
        delayLongPress={450}
        disabled={plusDisabled}
        style={[styles.stepBtn, plusDisabled && styles.stepBtnOff]}>
        <Text style={styles.stepBtnText}>＋</Text>
      </Pressable>
    </View>
  );
}

type Ability = '' | 'Blocker' | 'Rush' | 'Searcher';
type Counter = '' | '1000' | '2000' | 'None';
const CB_PAGE = 60; // render this many at a time
const CB_FETCH = 300; // server page size

function FilterRow({
  label,
  value,
  options,
  onPick,
}: {
  label: string;
  value: string;
  options: { label: string; value: string }[];
  onPick: (v: string) => void;
}) {
  return (
    <View style={styles.filterRow}>
      <Text style={styles.filterLabel}>{label}</Text>
      <View style={styles.filterPills}>
        {options.map((opt) => (
          <Pressable
            key={opt.value}
            onPress={() => onPick(opt.value)}
            style={[styles.fpill, value === opt.value && styles.fpillActive]}>
            <Text style={[styles.fpillText, value === opt.value && styles.fpillTextActive]}>{opt.label}</Text>
          </Pressable>
        ))}
      </View>
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
  const [fType, setFType] = useState('');
  const [fCost, setFCost] = useState<number | null>(null);
  const [fAbility, setFAbility] = useState<Ability>('');
  const [fCounter, setFCounter] = useState<Counter>('');
  const [trait, setTrait] = useState('');
  const [traitPool, setTraitPool] = useState<string[]>([]);
  const [traitFocused, setTraitFocused] = useState(false);

  const [rows, setRows] = useState<CardInfo[]>([]);
  const [shown, setShown] = useState(0);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errMsg, setErrMsg] = useState('');

  // Paging cursors live in refs so the fetch loop sees current values without
  // re-rendering; seq guards against a filter change landing a stale page.
  const fromRef = useRef(0);
  const doneRef = useRef(false);
  const seqRef = useRef(0);
  const rowsRef = useRef<CardInfo[]>([]);

  const colorOr = useMemo(
    () =>
      String(leader?.color ?? '')
        .split('/')
        .filter(Boolean)
        .map((c) => `color.ilike.%${c}%`)
        .join(','),
    [leader?.color],
  );

  // The query filter applies only on an exact trait (picked or fully typed),
  // matching web activeTrait().
  const activeTrait = useMemo(() => {
    const typed = trait.trim();
    if (!typed) return null;
    return traitPool.find((t) => t.toLowerCase() === typed.toLowerCase()) ?? null;
  }, [trait, traitPool]);

  // Trait pool = traits with ≥1 addable card in this deck's legal pool, built
  // once per deck+format when the modal opens (port of web ensureTraitPool).
  const traitKeyRef = useRef('');
  useEffect(() => {
    if (!visible || !leader) return;
    const key = `${deck.id}:${deck.format}`;
    if (traitKeyRef.current === key) return;
    traitKeyRef.current = key;
    let cancelled = false;
    (async () => {
      const set = new Set<string>();
      let from = 0;
      while (from < 20000) {
        let q = supabase
          .from('cards')
          .select('card_code,types')
          .eq('game', GAME)
          .neq('type', 'LEADER')
          .not('types', 'is', null)
          .range(from, from + 999);
        if (colorOr) q = q.or(colorOr);
        const { data, error } = await q;
        if (error || !data || data.length === 0) break;
        data.forEach((c: any) => {
          if (
            isBase(c.card_code) &&
            capFor(c.card_code) !== 0 &&
            (deck.format !== 'standard' || standardLegal(c.card_code))
          ) {
            (c.types ?? []).forEach((t: string) => set.add(t));
          }
        });
        if (data.length < 1000) break;
        from += 1000;
      }
      if (!cancelled) setTraitPool([...set].sort((a, b) => a.localeCompare(b)));
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, leader, deck.id, deck.format, colorOr]);

  // Fetch one server page (filtered), append the legal subset to rowsRef.
  const fetchChunk = useCallback(async (): Promise<string | null> => {
    let q = supabase
      .from('cards')
      .select('card_code,name,color,cost,type,image_url,counter,effect_text,types')
      .eq('game', GAME)
      .neq('type', 'LEADER')
      .order('release_order', { ascending: false })
      .range(fromRef.current, fromRef.current + CB_FETCH - 1);
    const name = query.trim();
    if (name) q = q.or(`name.ilike.%${name}%,card_code.ilike.%${name}%`);
    if (fType) q = q.eq('type', fType);
    if (activeTrait) q = q.contains('types', [activeTrait]);
    if (fCost !== null) q = q.eq('cost', fCost);
    // Ability filters key off effect-text conventions ([Blocker]/[Rush] keywords;
    // searchers phrase as "look at … top of your deck … add … hand").
    if (fAbility === 'Blocker') q = q.ilike('effect_text', '%[Blocker]%');
    else if (fAbility === 'Rush') q = q.ilike('effect_text', '%[Rush]%');
    else if (fAbility === 'Searcher')
      q = q.ilike('effect_text', '%look at%top of your deck%').ilike('effect_text', '%add%hand%');
    if (fCounter === 'None') q = q.is('counter', null);
    else if (fCounter) q = q.eq('counter', Number(fCounter));
    if (colorOr) q = q.or(colorOr);
    const { data, error } = await q;
    if (error) return error.message;
    const batch = (data ?? []) as CardInfo[];
    fromRef.current += batch.length;
    if (batch.length < CB_FETCH) doneRef.current = true;
    rowsRef.current = rowsRef.current.concat(
      batch.filter(
        (c) =>
          isBase(c.card_code) &&
          capFor(c.card_code) !== 0 &&
          (deck.format !== 'standard' || standardLegal(c.card_code)),
      ),
    );
    return null;
  }, [query, fType, activeTrait, fCost, fAbility, fCounter, colorOr, deck.format]);

  const load = useCallback(async () => {
    if (!leader) return;
    const seq = ++seqRef.current;
    rowsRef.current = [];
    fromRef.current = 0;
    doneRef.current = false;
    setLoading(true);
    setErrMsg('');
    setRows([]);
    setShown(0);
    setDone(false);
    while (rowsRef.current.length < CB_PAGE && !doneRef.current) {
      const err = await fetchChunk();
      if (seq !== seqRef.current) return; // filters changed mid-flight
      if (err) {
        setErrMsg(err);
        setLoading(false);
        return;
      }
    }
    if (seq !== seqRef.current) return;
    setRows(rowsRef.current.slice());
    setShown(Math.min(CB_PAGE, rowsRef.current.length));
    setDone(doneRef.current);
    setLoading(false);
  }, [leader, fetchChunk]);

  const loadMore = useCallback(async () => {
    const seq = seqRef.current;
    while (rowsRef.current.length < shown + CB_PAGE && !doneRef.current) {
      const err = await fetchChunk();
      if (seq !== seqRef.current) return;
      if (err) break;
    }
    if (seq !== seqRef.current) return;
    setRows(rowsRef.current.slice());
    setShown((s) => Math.min(s + CB_PAGE, rowsRef.current.length));
    setDone(doneRef.current);
  }, [shown, fetchChunk]);

  // Debounced reload whenever the modal opens or any filter changes.
  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [visible, load]);

  const renderRows = rows.slice(0, shown);
  const hasMore = shown < rows.length || !done;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.addModal}>
        <View style={styles.addHeader}>
          <Text style={styles.addTitle}>Add Cards</Text>
          <Pressable onPress={onClose} style={{ padding: 6 }}>
            <Ionicons name="close" size={26} color={colors.textPrimary} />
          </Pressable>
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 32 }}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search cards by name or code"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            style={styles.input}
          />

          <View style={styles.traitWrap}>
            <TextInput
              value={trait}
              onChangeText={setTrait}
              onFocus={() => setTraitFocused(true)}
              onBlur={() => setTraitFocused(false)}
              placeholder="Type trait (e.g. Straw Hat Crew)"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              style={[styles.input, { marginTop: 8 }]}
            />
            {traitFocused && trait.trim() && !activeTrait ? (
              <View style={styles.traitList}>
                {traitPool
                  .filter((t) => t.toLowerCase().includes(trait.trim().toLowerCase()))
                  .slice(0, 8)
                  .map((t) => (
                    <Pressable
                      key={t}
                      onPress={() => {
                        setTrait(t);
                        setTraitFocused(false);
                      }}
                      style={styles.traitItem}>
                      <Text style={styles.traitItemText}>{t}</Text>
                    </Pressable>
                  ))}
              </View>
            ) : null}
          </View>

          <FilterRow
            label="Type"
            value={fType}
            onPick={setFType}
            options={[
              { label: 'Any', value: '' },
              { label: 'Character', value: 'CHARACTER' },
              { label: 'Event', value: 'EVENT' },
              { label: 'Stage', value: 'STAGE' },
            ]}
          />
          <FilterRow
            label="Ability"
            value={fAbility}
            onPick={(v) => setFAbility(v as Ability)}
            options={[
              { label: 'Any', value: '' },
              { label: 'Blocker', value: 'Blocker' },
              { label: 'Rush', value: 'Rush' },
              { label: 'Searcher', value: 'Searcher' },
            ]}
          />
          <FilterRow
            label="Counter"
            value={fCounter}
            onPick={(v) => setFCounter(v as Counter)}
            options={[
              { label: 'Any', value: '' },
              { label: '+1000', value: '1000' },
              { label: '+2000', value: '2000' },
              { label: 'None', value: 'None' },
            ]}
          />
          <FilterRow
            label="Cost"
            value={fCost === null ? '' : String(fCost)}
            onPick={(v) => setFCost(v === '' ? null : Number(v))}
            options={[
              { label: 'Any', value: '' },
              ...Array.from({ length: 11 }, (_, i) => ({ label: String(i), value: String(i) })),
            ]}
          />

          {errMsg ? <Text style={styles.err}>{errMsg}</Text> : null}
          <Text style={styles.cbCount}>
            {loading ? 'Loading…' : renderRows.length ? `${shown}${hasMore ? '+' : ''} cards` : 'No legal cards match.'}
          </Text>

          <View style={styles.addGrid}>
            {renderRows.map((c) => {
              const inDeck = cards.find((r) => r.card_code === c.card_code);
              const locked = leaderLocked(c.effect_text, leader);
              return (
                <Pressable
                  key={c.card_code}
                  style={[styles.addCardTile, locked && styles.cbLocked]}
                  onPress={() => onAdd(c)}
                  accessibilityHint={
                    locked ? "Leader-locked — this card's effect needs a different leader. Still legal to add." : undefined
                  }>
                  <Image source={{ uri: c.image_url ?? undefined }} style={styles.addCardImg} contentFit="cover" />
                  <Text style={styles.addCardName} numberOfLines={1}>
                    {c.name}
                    {inDeck ? <Text style={{ color: '#7ec96a' }}> x{inDeck.quantity}</Text> : null}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {hasMore && !loading && renderRows.length > 0 ? (
            <Pressable style={styles.cbMore} onPress={loadMore}>
              <Text style={styles.cbMoreText}>Load more</Text>
            </Pressable>
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

const hitColor = (p: number) => (p >= 75 ? '#7ec96a' : p >= 50 ? '#e8b757' : '#b0506a');

// Gate flag shown beside a searcher's name (null when it always fires).
function gateFlag(status: string): { text: string; color: string } | null {
  if (status === 'fires') return { text: '✓ fires', color: '#7ec96a' };
  if (status === 'dead') return { text: "✗ won't fire", color: '#b0506a' };
  if (status === 'situational') return { text: 'if active', color: '#e8b757' };
  return null;
}

// Deck stats over the 50 (excludes leader). Faithful port of web openStats:
// counters bar, play-cost curve, and per-searcher hit-rates with leader-gate
// evaluation, modeled at the turn you'd play each searcher.
function StatsModal({
  visible,
  onClose,
  cards,
  info,
  leader,
}: {
  visible: boolean;
  onClose: () => void;
  cards: DeckCardRow[];
  info: Record<string, CardInfo>;
  leader: CardInfo | null;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const stats = useMemo(() => {
    let c2000 = 0;
    let c1000 = 0;
    let cNone = 0;
    let total = 0;
    const costB: Record<number, number> = {};
    cards.forEach((r) => {
      const c = info[r.card_code] ?? ({} as CardInfo);
      total += r.quantity;
      if (c.counter === 2000) c2000 += r.quantity;
      else if (c.counter === 1000) c1000 += r.quantity;
      else cNone += r.quantity;
      if (c.cost != null) costB[c.cost] = (costB[c.cost] ?? 0) + r.quantity;
    });
    const costs = Object.keys(costB).map(Number);
    const maxCost = costs.length ? Math.max(...costs) : 0;
    const maxN = costs.length ? Math.max(...costs.map((k) => costB[k])) : 0;
    const curve: { cost: number; n: number; pct: number }[] = [];
    for (let cc = 0; cc <= maxCost; cc++) {
      const n = costB[cc] ?? 0;
      curve.push({ cost: cc, n, pct: maxN ? Math.round((n / maxN) * 100) : 0 });
    }

    const searchers = cards
      .map((r) => ({ r, meta: parseSearcher(info[r.card_code]?.effect_text) }))
      .filter((x): x is { r: DeckCardRow; meta: SearcherMeta } => !!x.meta)
      .map(({ r, meta }) => {
        const c = info[r.card_code] ?? ({} as CardInfo);
        // Cards this searcher can reveal (excludes its own copies — that one's gone).
        const hits = cards
          .filter(
            (x) =>
              x.card_code !== r.card_code &&
              meta.filters.some((f) => cardMatchesSub(info[x.card_code] ?? ({} as CardInfo), f)),
          )
          .map((x) => ({ name: info[x.card_code]?.name || x.card_code, qty: x.quantity }))
          .sort((a, b) => b.qty - a.qty);
        const T = hits.reduce((s, h) => s + h.qty, 0);
        const fresh = hitChance(total, T, meta.look);
        // Draw-accurate: a cost-C searcher resolves ~turn C, by when you've seen
        // ~5 (opening hand) + C cards; dig the rest for targets still in the deck.
        const seen = Math.min(total - meta.look, 5 + (c.cost || 0));
        const Dleft = Math.max(meta.look, total - seen);
        const live = total > 0 ? hitChance(Dleft, (T * Dleft) / total, meta.look) : 0;
        const gate = evalSearcherGate(meta.gate, leader);
        return { r, c, meta, T, hits, fresh, live, gate };
      })
      .sort((a, b) => {
        const ad = a.gate.status === 'dead' ? 1 : 0;
        const bd = b.gate.status === 'dead' ? 1 : 0;
        return ad - bd || b.live - a.live; // dead gates last, else most reliable first
      });

    const searcherCopies = searchers.reduce((s, x) => s + x.r.quantity, 0);
    const openRaw = searchers.length ? hitChance(total, searcherCopies, 5) : 0;
    // OPTCG gives a free mulligan (redraw all 5 once) → two shots at it.
    const openAccess = searchers.length ? 1 - (1 - openRaw) * (1 - openRaw) : 0;

    return { c2000, c1000, cNone, total, curve, searchers, searcherCopies, openAccess };
  }, [cards, info, leader]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.addModal}>
        <View style={styles.addHeader}>
          <Text style={styles.addTitle}>Deck stats</Text>
          <Pressable onPress={onClose} style={{ padding: 6 }}>
            <Ionicons name="close" size={26} color={colors.textPrimary} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
          {!cards.length ? (
            <Text style={styles.priceEmpty}>No cards in the deck yet.</Text>
          ) : (
            <>
              <Text style={styles.statHint}>
                {stats.total} card{stats.total === 1 ? '' : 's'} in the deck
                {stats.total !== 50 ? ' (not 50 yet)' : ''}.
              </Text>

              {/* Counters */}
              <Text style={styles.statH4}>Counters</Text>
              <View style={styles.counterBar}>
                {stats.c2000 > 0 ? <View style={{ flex: stats.c2000, backgroundColor: '#7ec96a' }} /> : null}
                {stats.c1000 > 0 ? <View style={{ flex: stats.c1000, backgroundColor: '#e8b757' }} /> : null}
                {stats.cNone > 0 ? <View style={{ flex: stats.cNone, backgroundColor: '#b0506a' }} /> : null}
              </View>
              <View style={styles.legend}>
                <View style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: '#7ec96a' }]} />
                  <Text style={styles.legendText}>+2000 × {stats.c2000}</Text>
                </View>
                <View style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: '#e8b757' }]} />
                  <Text style={styles.legendText}>+1000 × {stats.c1000}</Text>
                </View>
                <View style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: '#b0506a' }]} />
                  <Text style={styles.legendText}>No counter (bricks) × {stats.cNone}</Text>
                </View>
              </View>

              {/* Play-cost curve */}
              <Text style={styles.statH4}>Play-cost curve</Text>
              {stats.curve.length ? (
                stats.curve.map((b) => (
                  <View key={b.cost} style={styles.curveRow}>
                    <Text style={styles.curveLabel}>{b.cost}</Text>
                    <View style={styles.curveTrack}>
                      <View style={[styles.curveBar, { width: `${b.pct}%` }]} />
                    </View>
                    <Text style={styles.curveN}>{b.n}</Text>
                  </View>
                ))
              ) : (
                <Text style={styles.priceEmpty}>No costed cards.</Text>
              )}

              {/* Searchers */}
              <Text style={styles.statH4}>Searchers</Text>
              {!stats.searchers.length ? (
                <Text style={styles.textMutedLine}>No searchers detected.</Text>
              ) : (
                <>
                  <Text style={styles.textMutedLine}>
                    {stats.searchers.length} searcher{stats.searchers.length === 1 ? '' : 's'} · {stats.searcherCopies}{' '}
                    cop{stats.searcherCopies === 1 ? 'y' : 'ies'} · ~{Math.round(stats.openAccess * 100)}% to open one in
                    your first 5 (with mulligan). Tap a row for targets.
                  </Text>
                  {stats.searchers.map((s) => {
                    const dead = s.gate.status === 'dead';
                    const situ = s.gate.status === 'situational';
                    const pct = Math.round(s.live * 100);
                    const flag = gateFlag(s.gate.status);
                    const isExp = expanded === s.r.card_code;
                    const label = searcherTargetLabel(s.meta.filters);
                    return (
                      <View key={s.r.card_code}>
                        <Pressable
                          style={styles.srow}
                          onPress={() => setExpanded(isExp ? null : s.r.card_code)}>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.srowName}>
                              {isExp ? '▾' : '▸'} {s.c.name || s.r.card_code} ×{s.r.quantity}
                              {flag ? <Text style={{ color: flag.color }}> {flag.text}</Text> : null}
                            </Text>
                            <Text style={styles.srowSub}>
                              top {s.meta.look}
                              {s.meta.take > 1 ? ` +up to ${s.meta.take}` : ''} · {s.T} {label}
                            </Text>
                          </View>
                          <Text style={[styles.srowPct, { color: dead ? '#7a7280' : hitColor(pct) }]}>
                            {dead ? '—' : `${pct}%${situ ? '*' : ''}`}
                          </Text>
                        </Pressable>
                        {isExp ? (
                          <Text style={styles.srowDetail}>
                            Can hit:{' '}
                            {s.hits.length
                              ? s.hits.map((h) => `${h.name} ×${h.qty}`).join(' · ')
                              : 'No matching cards in this deck.'}
                          </Text>
                        ) : null}
                      </View>
                    );
                  })}
                </>
              )}
            </>
          )}
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
  leaderWrap: { width: 110, height: 154 },
  leaderImg: { width: 110, height: 154, borderRadius: 8 },
  artSwap: {
    position: 'absolute',
    right: 4,
    bottom: 4,
    backgroundColor: 'rgba(12,10,18,0.8)',
    borderRadius: 999,
    padding: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  // Fill the leader's height: name on top, format pills mid, actions at bottom.
  headRight: { flex: 1, justifyContent: 'space-between' },
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
  missingLink: { color: colors.accent, textDecorationLine: 'underline' },
  missingLinkActive: { color: '#d98a8a', fontFamily: fonts.serifBold },
  barTrack: { height: 10, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.08)', overflow: 'hidden', marginTop: 8 },
  barFill: { height: '100%' },
  problems: { marginTop: 8 },
  problem: { color: '#d98a8a', fontFamily: fonts.body, fontSize: 12, lineHeight: 18 },

  actionRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' },
  eyeBtn: {
    width: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingVertical: 8,
  },
  eyeBtnPublic: { borderColor: '#7ec96a' },
  trashBtn: {
    width: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingVertical: 8,
  },
  statsBtn: {
    width: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingVertical: 8,
  },

  // Cost to Finish / Cost of Deck modal
  priceModal: { flex: 1, backgroundColor: colors.bgPrimary, padding: 16 },
  priceToggle: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  priceTotal: { color: colors.textPrimary, fontFamily: fonts.serifBold, fontSize: 18, marginBottom: 10 },
  priceTotalSub: { color: colors.textMuted, fontFamily: fonts.body, fontSize: 12 },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  priceImg: { width: 30, height: 42, borderRadius: 4, backgroundColor: colors.bgCard },
  priceName: { color: colors.textPrimary, fontFamily: fonts.body, fontSize: 13 },
  priceCode: { color: colors.textMuted, fontFamily: fonts.body, fontSize: 11 },
  priceNeed: { color: colors.textSecondary, fontFamily: fonts.body, fontSize: 12, width: 34, textAlign: 'right' },
  priceEach: { color: colors.textSecondary, fontFamily: fonts.body, fontSize: 12, width: 56, textAlign: 'right' },
  priceLine: { color: colors.textPrimary, fontFamily: fonts.bodyBold, fontSize: 13, width: 64, textAlign: 'right' },
  priceFoot: { color: colors.textMuted, fontFamily: fonts.body, fontSize: 11, marginTop: 14, lineHeight: 16 },
  priceErr: { color: colors.danger, fontFamily: fonts.body, fontSize: 13, marginTop: 20 },
  priceEmpty: { color: colors.textSecondary, fontFamily: fonts.body, fontSize: 14, marginTop: 24, textAlign: 'center' },

  err: { color: colors.danger, fontFamily: fonts.body, fontSize: 13, marginTop: 8 },

  // Share-with-partner (shared decks)
  partnerSection: { marginTop: 18 },
  partnerLabel: {
    color: colors.textSecondary,
    fontFamily: fonts.serifBold,
    fontSize: 11,
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  partnerChip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 14,
    marginTop: 4,
  },
  partnerChipName: { color: colors.textPrimary, fontFamily: fonts.body, fontSize: 14 },
  partnerPendingRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  partnerPending: {
    color: colors.textMuted,
    fontFamily: fonts.body,
    fontSize: 11,
    fontStyle: 'italic',
  },
  partnerRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  partnerInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.textPrimary,
    fontFamily: fonts.body,
    fontSize: 14,
    backgroundColor: colors.bgSecondary,
  },
  partnerBtn: {
    backgroundColor: colors.accent,
    borderRadius: radius.lg,
    paddingHorizontal: 16,
    paddingVertical: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  partnerBtnText: { color: colors.bgPrimary, fontFamily: fonts.bodyBold, fontSize: 13 },
  partnerMsg: { color: colors.textSecondary, fontFamily: fonts.body, fontSize: 12, marginTop: 6 },

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
  editorImgWrap: { width: 46, height: 64 },
  editorImg: { width: 46, height: 64, borderRadius: 4 },
  cardArtSwap: {
    position: 'absolute',
    right: -6,
    bottom: -6,
    backgroundColor: 'rgba(12,10,18,0.85)',
    borderRadius: 999,
    padding: 4,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
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

  cardGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: GRID_GAP, marginTop: 12 },
  cardTile: { position: 'relative' },
  tileDim: { opacity: 0.3 },
  cardImg: { width: '100%', aspectRatio: 0.72, borderRadius: 6 },
  cardImgSel: { borderWidth: 2, borderColor: colors.accent },
  cardImgMissing: { borderWidth: 2, borderColor: '#d98a8a' },
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
  qtyBadgeMissing: { backgroundColor: '#d98a8a', borderColor: '#d98a8a' },
  qtyText: { color: colors.textPrimary, fontFamily: fonts.body, fontSize: 11 },
  oeBadge: {
    position: 'absolute',
    bottom: 3,
    left: 3,
    backgroundColor: 'rgba(126,201,106,0.92)',
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  oeText: { color: '#0c0a12', fontFamily: fonts.bodyBold, fontSize: 10 },

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

  // Deck stats modal
  statHint: { color: colors.textMuted, fontFamily: fonts.body, fontSize: 13, marginBottom: 8 },
  statH4: {
    color: colors.textSecondary,
    fontFamily: fonts.serifBold,
    fontSize: 12,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginTop: 22,
    marginBottom: 10,
  },
  counterBar: { flexDirection: 'row', height: 14, borderRadius: 999, overflow: 'hidden', backgroundColor: colors.bgCard },
  legend: { marginTop: 10, gap: 4 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  legendDot: { width: 10, height: 10, borderRadius: 3 },
  legendText: { color: colors.textSecondary, fontFamily: fonts.body, fontSize: 12 },
  curveRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 5 },
  curveLabel: { color: colors.textMuted, fontFamily: fonts.body, fontSize: 12, width: 18, textAlign: 'center' },
  curveTrack: { flex: 1, height: 12, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.06)', overflow: 'hidden' },
  curveBar: { height: '100%', backgroundColor: colors.accent, borderRadius: 999 },
  curveN: { color: colors.textSecondary, fontFamily: fonts.body, fontSize: 12, width: 24, textAlign: 'right' },
  textMutedLine: { color: colors.textMuted, fontFamily: fonts.body, fontSize: 12, lineHeight: 18, marginBottom: 6 },
  srow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  srowName: { color: colors.textPrimary, fontFamily: fonts.body, fontSize: 13 },
  srowSub: { color: colors.textMuted, fontFamily: fonts.body, fontSize: 11, marginTop: 2 },
  srowPct: { fontFamily: fonts.bodyBold, fontSize: 14, minWidth: 44, textAlign: 'right' },
  srowDetail: {
    color: colors.textMuted,
    fontFamily: fonts.body,
    fontSize: 12,
    lineHeight: 17,
    paddingLeft: 16,
    paddingBottom: 8,
  },

  importHint: { color: colors.textSecondary, fontFamily: fonts.body, fontSize: 13, lineHeight: 19, marginBottom: 12 },
  importInput: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgCard,
    borderRadius: radius.sm,
    padding: 12,
    minHeight: 160,
    textAlignVertical: 'top',
    fontSize: 14,
    color: colors.textPrimary,
    fontFamily: fonts.body,
  },

  addModal: { flex: 1, backgroundColor: colors.bgPrimary, paddingTop: 56, paddingHorizontal: 16 },
  addHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  addTitle: { color: colors.textPrimary, fontFamily: fonts.serifBold, fontSize: 18 },
  addGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingVertical: 14 },
  addCardTile: { width: '30%' },
  cbLocked: { opacity: 0.4 }, // leader-locked — greyed but still addable
  addCardImg: { width: '100%', aspectRatio: 0.72, borderRadius: 6 },
  addCardName: { color: colors.textSecondary, fontFamily: fonts.body, fontSize: 11, marginTop: 4 },

  traitWrap: { position: 'relative', zIndex: 10 },
  traitList: {
    backgroundColor: colors.bgCard,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    marginTop: 4,
    overflow: 'hidden',
  },
  traitItem: { paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)' },
  traitItemText: { color: colors.textPrimary, fontFamily: fonts.body, fontSize: 13 },

  filterRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 12 },
  filterLabel: { color: colors.textMuted, fontFamily: fonts.body, fontSize: 11, width: 56, paddingTop: 7 },
  filterPills: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  fpill: {
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgCard,
  },
  fpillActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  fpillText: { color: colors.textSecondary, fontFamily: fonts.body, fontSize: 12 },
  fpillTextActive: { color: colors.bgPrimary, fontFamily: fonts.bodyBold },

  cbCount: { color: colors.textMuted, fontFamily: fonts.body, fontSize: 12, marginTop: 14 },
  cbMore: {
    alignSelf: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingHorizontal: 24,
    paddingVertical: 11,
    marginTop: 8,
  },
  cbMoreText: { color: colors.textPrimary, fontFamily: fonts.serifBold, fontSize: 13, letterSpacing: 1 },
});
