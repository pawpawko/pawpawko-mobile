import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import DraggableFlatList, { ScaleDecorator, type RenderItemParams } from 'react-native-draggable-flatlist';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  interpolate,
  interpolateColor,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import QRCode from 'react-native-qrcode-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DiceLoader } from '@/components/dice-loader';
import { FlairPill } from '@/components/flair-pill';
import { SyncStatusBar } from '@/components/sync-status';
import { useAuth } from '@/lib/auth';
import { addCardToWishlist, type WishlistResult } from '@/lib/wishlist';
import {
  COLOR_ORDER,
  CYBERPUNK_COLORS,
  CYBERPUNK_COSTS,
  CYBERPUNK_RAM,
  CYBERPUNK_RARITIES,
  CYBERPUNK_TAGS,
  CYBERPUNK_TYPES,
  LISTING_TYPES,
  OPTCG_ATTRIBUTES,
  OPTCG_COLORS,
  OPTCG_COSTS,
  OPTCG_RARITIES,
  OPTCG_TYPES,
  PAGE_SIZE,
  POKEMON_HP_BUCKETS,
  POKEMON_RARITIES,
  POKEMON_SUBTYPES,
  POKEMON_SUPERTYPES,
  POKEMON_TYPES,
  SORT_MODES_CYBERPUNK,
  SORT_MODES_OPTCG,
  SORT_MODES_POKEMON,
  type Layout,
  type ListingType,
  type SortMode,
} from '@/lib/binder-constants';
import { cacheKeys, readCache, writeCache } from '@/lib/offline-cache';
import { binderShareUrl } from '@/lib/slug';
import { supabase } from '@/lib/supabase';
import { enqueue, newId, pendingForBinder } from '@/lib/sync-queue';
import { fonts, radius, type Palette } from '@/lib/theme';
import { useTheme } from '@/lib/theme-context';

type Flair = 'trade' | 'wishlist';
const FLAIR_OPTIONS: { value: Flair; label: string }[] = [
  { value: 'trade', label: 'Trade' },
  { value: 'wishlist', label: 'Wishlist' },
];

type BinderHeader = {
  id: string;
  binder_name: string | null;
  binder_description: string | null;
  display_name: string | null;
  category: string;
  flair: string;
  layout?: Layout | null;
};

type Listing = {
  id: string;
  card_code: string;
  quantity: number;
  listing_type: string;
  sort_order: number | null;
  deck_id?: string | null; // set on deck-synced wishlist rows (owner read only)
};

type CardInfo = {
  card_code: string;
  name: string | null;
  image_url: string | null;
  image_url_lg: string | null;
  // Sort-mode columns (optional — only fetched when present).
  color?: string | null;
  cost?: number | null;
  types?: string[] | null;
  supertype?: string | null;
  hp?: number | null;
  ram?: number | null; // Cyberpunk deck-building stat
  type?: string | null; // Cyberpunk Legend/Unit/Gear/Program
  rarity?: string | null;
  release_order?: number | null;
};

// Snapshot persisted to the offline cache for own binders.
type BinderSnapshot = {
  header: BinderHeader;
  listings: Listing[];
  cardsById: Record<string, CardInfo>;
};

export default function BinderDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [header, setHeader] = useState<BinderHeader | null>(null);
  const [listings, setListings] = useState<Listing[]>([]);
  const [cards, setCards] = useState<Record<string, CardInfo>>({});
  const [loading, setLoading] = useState(true);

  const [isOwner, setIsOwner] = useState(false);
  const [isCollab, setIsCollab] = useState(false); // shared-binder co-editor
  const canEdit = isOwner || isCollab;
  const [editOpen, setEditOpen] = useState(false);

  // Full edit-mode state
  const [editMode, setEditMode] = useState(false);
  const [layout, setLayout] = useState<Layout>('4x3');
  const [sortMode, setSortMode] = useState<SortMode>('custom-4x3');
  const [aestheticsMode, setAestheticsMode] = useState(false);
  const [browserOpen, setBrowserOpen] = useState(false);
  const [addCards, setAddCards] = useState<CardInfo[] | null>(null);
  const [addIndex, setAddIndex] = useState(0);
  const [editListing, setEditListing] = useState<Listing | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  // Tracks whether the Add-Cards pager session actually added anything, so we
  // can jump the binder to the page the new (end-sorted) cards land on.
  const addedDuringSessionRef = useRef(false);
  // Bumped after an add session closes; a dedicated effect then jumps to the
  // last page using the freshly-settled listings (so it can't undershoot).
  const [jumpToEndNonce, setJumpToEndNonce] = useState(0);

  // Existing
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  // Deck-origin enrichment for owner wishlist binders: deck_id → deck name.
  const [decksById, setDecksById] = useState<Record<string, { id: string; name: string | null }>>({});
  const [deckFilter, setDeckFilter] = useState(''); // '' | '__deck__' | '__manual__' | <deckId>

  const [shareOpen, setShareOpen] = useState(false);

  const shareUrl = id && header ? binderShareUrl(header.display_name, header.binder_name, id) : '';
  const pageSize = PAGE_SIZE[layout];

  // ---- Ownership / collaborator check ----
  // Owner OR a shared-binder collaborator may co-edit (RLS allows both); only
  // the owner gets settings/rename/flair/delete + partner management.
  useEffect(() => {
    const uid = session?.user.id;
    if (!id || !uid) {
      setIsOwner(false);
      setIsCollab(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data: b } = await supabase
        .from('binders')
        .select('user_id,layout')
        .eq('id', id)
        .maybeSingle();
      if (cancelled) return;
      const owner = b?.user_id === uid;
      setIsOwner(owner);
      if (b && (b.layout === '3x3' || b.layout === '4x3')) {
        setLayout(b.layout);
        setSortMode(b.layout === '3x3' ? 'custom-3x3' : 'custom-4x3');
      }
      if (owner) {
        setIsCollab(false);
        return;
      }
      const { data: c } = await supabase
        .from('binder_collaborators')
        .select('user_id')
        .eq('binder_id', id)
        .eq('user_id', uid)
        .maybeSingle();
      if (!cancelled) setIsCollab(!!c);
    })();
    return () => {
      cancelled = true;
    };
  }, [id, session?.user.id]);

  // ---- Initial load ----
  const loadAll = useCallback(async (opts?: { silent?: boolean }) => {
    if (!id) return;
    if (!opts?.silent) {
      setLoading(true);
      // Instant paint from cache (also the offline path). The network refresh
      // below overrides it; un-synced edits are kept by the merge guard.
      const cached = await readCache<BinderSnapshot>(cacheKeys.binder(id));
      if (cached) {
        setHeader(cached.header);
        if (pendingForBinder(id) === 0) setListings(cached.listings);
        setCards(cached.cardsById);
        setLoading(false);
      }
    }
    const res = await Promise.all([
      supabase.rpc('get_binder_public', { p_binder_id: id }),
      canEdit
        ? supabase
            .from('listings')
            .select('id, quantity, listing_type, card_code, sort_order, deck_id')
            .eq('binder_id', id)
            .order('sort_order', { ascending: true, nullsFirst: false })
            // Oldest-first among unplaced (null sort_order) cards so freshly
            // added cards land at the END of the binder — keeping them on the
            // last page, which is where the add flow navigates to.
            .order('created_at', { ascending: true })
        : supabase.rpc('get_binder_listings_public', { p_binder_id: id }),
    ]).catch(() => null);
    if (!res) {
      // Offline / transport error — keep whatever we hydrated from cache.
      if (!opts?.silent) setLoading(false);
      return;
    }
    const [hRes, lRes] = res;
    if (hRes.error) console.warn('header', hRes.error.message);
    if (lRes.error) console.warn('listings', lRes.error.message);

    const head: BinderHeader | null = Array.isArray(hRes.data) ? hRes.data[0] : hRes.data;
    const lst: Listing[] = (lRes.data ?? []) as Listing[];
    setHeader(head);
    // Merge-on-refresh guard: a server snapshot must not clobber un-synced
    // optimistic edits (last-write-wins keeps them until the queue flushes).
    if (pendingForBinder(id) === 0) setListings(lst);

    if (head && lst.length > 0) {
      const codes = Array.from(new Set(lst.map((l) => l.card_code)));
      const { data: cardRows, error: cErr } = await supabase
        .from('cards')
        .select('card_code,name,image_url,image_url_lg,color,cost,type,types,supertype,hp,ram,rarity,release_order')
        .eq('game', head.category)
        .in('card_code', codes);
      if (cErr) console.warn('cards', cErr.message);
      const map: Record<string, CardInfo> = {};
      (cardRows ?? []).forEach((c: CardInfo) => {
        map[c.card_code] = c;
      });
      setCards(map);
    }
    if (!opts?.silent) setLoading(false);
    return lst;
  }, [id, canEdit]);

  // Keep drag(aesthetics) mode readable inside the Realtime callback closure.
  const aestheticsModeRef = useRef(aestheticsMode);
  aestheticsModeRef.current = aestheticsMode;
  const rtTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // Persist this binder for offline viewing whenever its displayed data
  // changes (owner only — scope is "my binders"). Captures optimistic edits
  // too, so reopening offline shows un-synced changes.
  useEffect(() => {
    if (!id || !isOwner || !header) return;
    void writeCache(cacheKeys.binder(id), { header, listings, cardsById: cards });
  }, [id, isOwner, header, listings, cards]);

  // Deck-origin lookup (owner + wishlist only): the auto wishlist-sync stamps
  // deck-sourced rows with listings.deck_id; map those ids → deck names so the
  // tile/detail can show a 🃏 pill and the "For deck" filter can list them.
  // Owner-only — anon viewers never receive deck_id (the public RPC omits it).
  useEffect(() => {
    if (!isOwner || header?.flair !== 'wishlist') {
      setDecksById({});
      return;
    }
    const deckIds = [...new Set(listings.map((l) => l.deck_id).filter(Boolean))] as string[];
    if (!deckIds.length) {
      setDecksById({});
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from('decks').select('id, name').in('id', deckIds);
      if (cancelled) return;
      const m: Record<string, { id: string; name: string | null }> = {};
      (data ?? []).forEach((d: any) => {
        m[d.id] = d;
      });
      setDecksById(m);
    })();
    return () => {
      cancelled = true;
    };
  }, [listings, isOwner, header?.flair]);

  // ---- Realtime: a co-editor's card change refreshes this binder live ----
  // (public.listings is in the Realtime publication.) Skipped during a drag so
  // it never yanks an in-progress reorder; a silent reload otherwise.
  useEffect(() => {
    if (!id) return;
    const channel = supabase
      .channel('binder-' + id)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'listings', filter: 'binder_id=eq.' + id },
        () => {
          if (aestheticsModeRef.current) return;
          if (rtTimer.current) clearTimeout(rtTimer.current);
          rtTimer.current = setTimeout(() => loadAll({ silent: true }), 350);
        },
      )
      .subscribe();
    return () => {
      if (rtTimer.current) clearTimeout(rtTimer.current);
      supabase.removeChannel(channel);
    };
  }, [id, loadAll]);

  // ---- Sort listings according to active sortMode ----
  const sortedListings = applySortMode(listings, cards, sortMode);

  // "For deck" filter (owner wishlist): the decks present among deck-synced rows.
  const deckPillOptions = useMemo(
    () =>
      ([...new Set(listings.map((l) => l.deck_id).filter(Boolean))] as string[])
        .filter((did) => decksById[did])
        .map((did) => ({ id: did, name: decksById[did].name || 'Deck' }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [listings, decksById],
  );
  // Drop a stale per-deck selection if that deck is no longer present.
  const effDeckFilter =
    deckFilter && deckFilter !== '__deck__' && deckFilter !== '__manual__' && !decksById[deckFilter]
      ? ''
      : deckFilter;
  // Edit/reorder always sees the full set; browse honors the deck filter.
  const displayListings =
    editMode || !effDeckFilter
      ? sortedListings
      : sortedListings.filter((l) => {
          if (effDeckFilter === '__deck__') return !!l.deck_id;
          if (effDeckFilter === '__manual__') return !l.deck_id;
          return l.deck_id === effDeckFilter;
        });

  // Reset page if it overflows the new total
  useEffect(() => {
    const totalPages = Math.max(1, Math.ceil(sortedListings.length / pageSize));
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [sortedListings.length, pageSize, currentPage]);

  // After an add session, jump to the last page — where new (end-sorted) cards
  // land — computed from the live, settled sortedListings so it always hits the
  // true last page instead of undershooting on a stale count.
  useEffect(() => {
    if (jumpToEndNonce === 0) return;
    setCurrentPage(Math.max(1, Math.ceil(sortedListings.length / pageSize)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpToEndNonce]);

  // ---- Header refresh (used after rename) ----
  async function refreshHeader() {
    if (!id) return;
    const { data } = await supabase.rpc('get_binder_public', { p_binder_id: id });
    const head: BinderHeader | null = Array.isArray(data) ? data[0] : data;
    if (head) setHeader(head);
  }

  // ---- Owner mutations ----
  async function saveName(next: string) {
    if (!id) return false;
    const trimmed = next.trim();
    if (!trimmed) return false;
    const { error } = await supabase.from('binders').update({ name: trimmed }).eq('id', id);
    if (error) {
      Alert.alert('Could not rename binder', error.message);
      return false;
    }
    await refreshHeader();
    return true;
  }

  async function saveFlair(next: Flair) {
    if (!id) return;
    const { error } = await supabase.from('binders').update({ flair: next }).eq('id', id);
    if (error) {
      Alert.alert('Could not update flair', error.message);
      return;
    }
    setHeader((h) => (h ? { ...h, flair: next } : h));
  }

  function confirmDelete() {
    Alert.alert(
      'Delete binder?',
      `"${header?.binder_name ?? 'This binder'}" and all its listings will be permanently removed.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            if (!id) return;
            const { error } = await supabase.from('binders').delete().eq('id', id);
            if (error) {
              Alert.alert('Could not delete binder', error.message);
              return;
            }
            setEditOpen(false);
            router.back();
          },
        },
      ],
    );
  }

  async function saveLayout(next: Layout) {
    setLayout(next);
    // Keep sort mode in sync if currently on a custom layout
    if (sortMode === 'custom-3x3' || sortMode === 'custom-4x3') {
      setSortMode(next === '3x3' ? 'custom-3x3' : 'custom-4x3');
    }
    setCurrentPage(1);
    // binders-row writes are owner-only (binders_update RLS). Collaborators keep an
    // ephemeral local layout but must not attempt the persist (it would RLS-reject).
    if (!id || !isOwner) return;
    const { error } = await supabase.from('binders').update({ layout: next }).eq('id', id);
    if (error) console.warn('layout save failed:', error.message);
  }

  async function addListing(card: CardInfo, qty: number, ltype: ListingType) {
    if (!id) return false;
    // Optimistic insert with a client-generated id (also the op's idempotency
    // key). New rows have no sort_order yet → they sort to the end, matching
    // the server default.
    const listingId = newId();
    const row: Listing = {
      id: listingId,
      card_code: card.card_code,
      quantity: qty,
      listing_type: ltype,
      sort_order: null,
    };
    setListings((ls) => [...ls, row]);
    // Ensure card metadata is in the lookup
    setCards((map) => (map[card.card_code] ? map : { ...map, [card.card_code]: card }));
    void enqueue({
      kind: 'add',
      binderId: id,
      listingId,
      cardCode: card.card_code,
      quantity: qty,
      listingType: ltype,
    });
    return true;
  }

  async function updateListing(listingId: string, qty: number, ltype: ListingType) {
    setListings((ls) =>
      ls.map((l) => (l.id === listingId ? { ...l, quantity: qty, listing_type: ltype } : l)),
    );
    if (id) {
      void enqueue({ kind: 'update', binderId: id, listingId, quantity: qty, listingType: ltype });
    }
    return true;
  }

  async function removeListing(listingId: string) {
    setListings((ls) => ls.filter((l) => l.id !== listingId));
    if (id) void enqueue({ kind: 'remove', binderId: id, listingId });
    return true;
  }

  // "Got it" on a wishlist card (owner). Deck-synced rows (deck_id set) add a
  // copy to the deck as owned — the deck_cards_sync_wishlist trigger then shrinks
  // this wishlist row. Manual rows just decrement (and delete at zero). Mirrors
  // the web markReceived/persistReceive flow.
  async function markReceived(l: Listing) {
    // Optimistic: a received copy shrinks the wishlist row by one (the server
    // does the same — manual rows decrement; deck-synced rows shrink via the
    // sync trigger after the deck's owned count goes up). The op replays the
    // exact server logic, re-reading the current quantity at flush time.
    setListings((ls) =>
      ls.flatMap((x) => {
        if (x.id !== l.id) return [x];
        const q = (x.quantity ?? 1) - 1;
        return q > 0 ? [{ ...x, quantity: q }] : [];
      }),
    );
    if (id) {
      void enqueue({
        kind: 'markReceived',
        binderId: id,
        listingId: l.id,
        cardCode: l.card_code,
        deckId: l.deck_id ?? null,
      });
    }
  }

  async function removeAllForCard(cardCode: string) {
    if (!id) return false;
    setListings((ls) => ls.filter((l) => l.card_code !== cardCode));
    void enqueue({ kind: 'removeAllForCard', binderId: id, cardCode });
    return true;
  }

  // Persist a freshly-ordered listings array by writing sort_order = index for each row.
  async function persistPositions(reordered: Listing[]) {
    const next = reordered.map((l, i) => ({ ...l, sort_order: i }));
    setListings(next);
    if (!id) return;
    void enqueue({
      kind: 'reorder',
      binderId: id,
      order: next.map((l, i) => ({
        id: l.id,
        sort_order: i,
        card_code: l.card_code,
        quantity: l.quantity,
        listing_type: l.listing_type,
      })),
    });
  }

  if (loading) {
    return (
      <View style={styles.loadingWrap}>
        <DiceLoader />
      </View>
    );
  }
  if (!header) return <Text style={styles.empty}>Binder not found.</Text>;

  const sortOptions =
    header.category === 'pokemon'
      ? SORT_MODES_POKEMON
      : header.category === 'cyberpunk'
        ? SORT_MODES_CYBERPUNK
        : SORT_MODES_OPTCG;
  const numColumns = layout === '3x3' ? 3 : 4;
  const isWishlist = header.flair === 'wishlist';
  const total = displayListings.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const pageStart = (currentPage - 1) * pageSize;
  const pageItems = displayListings.slice(pageStart, pageStart + pageSize);

  const showDraggable = editMode && aestheticsMode && (sortMode === 'custom-3x3' || sortMode === 'custom-4x3');

  return (
    <>
      <Stack.Screen
        options={{
          title: editMode ? 'EDIT BINDER' : 'Binder',
          headerRight: () => (
            <View style={{ flexDirection: 'row' }}>
              {canEdit && !editMode ? (
                <Pressable
                  onPress={() => setEditMode(true)}
                  style={({ pressed }) => ({ paddingHorizontal: 8, opacity: pressed ? 0.6 : 1 })}
                  accessibilityLabel="Edit cards">
                  <Ionicons name="create-outline" size={22} color={colors.accent} />
                </Pressable>
              ) : null}
              {editMode ? (
                <Pressable
                  onPress={() => {
                    setEditMode(false);
                    setAestheticsMode(false);
                  }}
                  style={({ pressed }) => ({ paddingHorizontal: 12, opacity: pressed ? 0.6 : 1 })}
                  accessibilityLabel="Done editing">
                  <Text style={styles.doneBtnText}>DONE</Text>
                </Pressable>
              ) : (
                <Pressable
                  onPress={() => setShareOpen(true)}
                  style={({ pressed }) => ({ paddingHorizontal: 12, opacity: pressed ? 0.6 : 1 })}
                  accessibilityLabel="Share binder">
                  <Ionicons name="share-social-outline" size={22} color={colors.accent} />
                </Pressable>
              )}
            </View>
          ),
        }}
      />

      <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bgPrimary }}>
        <View style={styles.header}>
          <Text style={styles.title}>
            <Text style={styles.titleOwner}>{header.display_name ?? 'someone'}'s </Text>
            {header.binder_name ?? 'binder'}
          </Text>
          <View style={styles.headerPills}>
            <FlairPill value={header.category} kind="category" />
            <FlairPill value={header.flair} kind="flair" />
          </View>
        </View>

        <SyncStatusBar binderId={id} />

        {editMode ? (
          <EditToolbar
            aestheticsMode={aestheticsMode}
            onToggleAesthetics={() => {
              const next = !aestheticsMode;
              setAestheticsMode(next);
              // Default the active chip to the user's saved layout's custom
              // variant whether entering or exiting sort mode.
              setSortMode(layout === '3x3' ? 'custom-3x3' : 'custom-4x3');
            }}
            onAddCards={() => setBrowserOpen(true)}
            onOpenSettings={isOwner ? () => setEditOpen(true) : undefined}
          />
        ) : null}

        {editMode && aestheticsMode ? (
          <SortPicker
            value={sortMode}
            options={sortOptions}
            onChange={(m) => {
              setSortMode(m);
              if (m === 'custom-3x3' && layout !== '3x3') saveLayout('3x3');
              if (m === 'custom-4x3' && layout !== '4x3') saveLayout('4x3');
            }}
          />
        ) : null}

        {!editMode && isOwner && isWishlist && deckPillOptions.length > 0 ? (
          <View style={styles.deckFilterBar}>
            <Text style={styles.deckFilterLabel}>For deck</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.deckFilterPills}>
              {[
                { id: '', label: 'All' },
                { id: '__deck__', label: 'Deck cards' },
                { id: '__manual__', label: 'Manual' },
                ...deckPillOptions.map((d) => ({ id: d.id, label: `🃏 ${d.name}` })),
              ].map((opt) => (
                <Pressable
                  key={opt.id || 'all'}
                  onPress={() => {
                    setDeckFilter(opt.id);
                    setCurrentPage(1);
                  }}
                  style={[styles.dfPill, effDeckFilter === opt.id && styles.dfPillActive]}>
                  <Text style={[styles.dfPillText, effDeckFilter === opt.id && styles.dfPillTextActive]}>
                    {opt.label}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        ) : null}

        {total === 0 ? (
          <Text style={styles.empty}>
            {editMode
              ? 'No cards yet. Tap "Add cards".'
              : effDeckFilter
                ? 'No cards match this deck filter.'
                : 'No cards in this binder yet.'}
          </Text>
        ) : showDraggable ? (
          <DraggableFlatList
            data={sortedListings}
            keyExtractor={(l) => l.id}
            numColumns={1}
            onDragEnd={({ data }) => {
              setSortMode(layout === '3x3' ? 'custom-3x3' : 'custom-4x3');
              persistPositions(data);
            }}
            renderItem={(p) => (
              <DraggableTile
                {...p}
                cards={cards}
                numColumns={numColumns}
                isWishlist={isWishlist}
              />
            )}
            contentContainerStyle={styles.grid}
          />
        ) : editMode ? (
          <FlatList
            key={`grid-${numColumns}`}
            data={pageItems}
            keyExtractor={(l) => l.id}
            numColumns={numColumns}
            contentContainerStyle={styles.grid}
            renderItem={({ item, index }) => (
              <Pressable
                onPress={() => setEditListing(item)}
                style={({ pressed }) => [styles.cell, { flex: 1 / numColumns }, pressed && styles.cellPressed]}>
                {cards[item.card_code]?.image_url ? (
                  <Image
                    source={{ uri: cards[item.card_code].image_url! }}
                    style={styles.cardImg}
                    contentFit="contain"
                  />
                ) : (
                  <View style={[styles.cardImg, styles.placeholder]} />
                )}
                <Text style={styles.cardCode}>{item.card_code}</Text>
                {!isWishlist ? (
                  <Text style={styles.cardMeta}>×{item.quantity} · {item.listing_type}</Text>
                ) : null}
              </Pressable>
            )}
          />
        ) : (
          <BinderPager
            listings={displayListings}
            cards={cards}
            decksById={decksById}
            numColumns={numColumns}
            pageSize={pageSize}
            currentPage={currentPage}
            onPageChange={setCurrentPage}
            onCardPress={(absoluteIdx) => setExpandedIdx(absoluteIdx)}
            isWishlist={isWishlist}
          />
        )}

        {totalPages > 1 && !showDraggable ? (
          <Pagination
            page={currentPage}
            totalPages={totalPages}
            onChange={setCurrentPage}
          />
        ) : null}
      </GestureHandlerRootView>

      <EditBinderModal
        visible={editOpen}
        onClose={() => setEditOpen(false)}
        binderId={id ?? ''}
        currentName={header.binder_name ?? ''}
        currentFlair={(header.flair as Flair) ?? 'trade'}
        onSaveName={saveName}
        onSaveFlair={saveFlair}
        onDelete={confirmDelete}
      />

      <CardBrowserModal
        visible={browserOpen}
        onClose={() => setBrowserOpen(false)}
        game={header.category}
        onPickCard={(allResults, index) => {
          setBrowserOpen(false);
          setAddCards(allResults);
          setAddIndex(index);
        }}
      />

      <AddListingPager
        cards={addCards}
        index={addIndex}
        onIndexChange={setAddIndex}
        binderId={id ?? null}
        onClose={async () => {
          setAddCards(null);
          const added = addedDuringSessionRef.current;
          addedDuringSessionRef.current = false;
          // Re-sync from the DB so the grid reflects everything added/removed
          // during this pager session (silent = no full-screen loader flash).
          await loadAll({ silent: true });
          // New cards sort to the end (no saved position) → the last page. If
          // this session added any, bump the nonce so the jump effect lands on
          // the last page once the reloaded listings have settled.
          if (added) setJumpToEndNonce((n) => n + 1);
        }}
        onSave={async (card, qty, type) => {
          // Don't close on save — keep the pager open so the user can
          // continue swiping through the same filter run and add more
          // cards without re-opening the browser.
          const ok = await addListing(card, qty, type);
          if (ok) addedDuringSessionRef.current = true;
        }}
        onRemoveAll={async (cardCode) => {
          await removeAllForCard(cardCode);
        }}
        onAddToWishlist={
          session?.user.id
            ? (card) => addCardToWishlist(card.card_code, header.category, session.user.id)
            : null
        }
        isWishlist={isWishlist}
      />

      <EditListingSheet
        listing={editListing}
        card={editListing ? cards[editListing.card_code] : undefined}
        onClose={() => setEditListing(null)}
        onSave={async (l, qty, type) => {
          const ok = await updateListing(l.id, qty, type);
          if (ok) setEditListing(null);
        }}
        onRemove={async (l) => {
          const ok = await removeListing(l.id);
          if (ok) setEditListing(null);
        }}
        isWishlist={isWishlist}
      />

      <Modal visible={shareOpen} transparent animationType="fade" onRequestClose={() => setShareOpen(false)}>
        <Pressable style={styles.shareBackdrop} onPress={() => setShareOpen(false)}>
          <Pressable style={styles.shareCard} onPress={(e) => e.stopPropagation()}>
            <Pressable style={styles.shareCloseBtn} onPress={() => setShareOpen(false)}>
              <Ionicons name="close" size={24} color={colors.textPrimary} />
            </Pressable>
            <Text style={styles.shareTitle}>SHARE BINDER</Text>
            <View style={styles.qrWrap}>
              {shareUrl ? (
                <QRCode value={shareUrl} size={220} backgroundColor={colors.textPrimary} color={colors.bgPrimary} />
              ) : null}
            </View>
            <Text style={styles.shareUrl} numberOfLines={2}>{shareUrl}</Text>
            <Pressable
              style={({ pressed }) => [styles.shareBtn, pressed && styles.shareBtnPressed]}
              onPress={async () => {
                try { await Share.share({ message: shareUrl, url: shareUrl }); } catch {}
              }}>
              <Ionicons name="share-outline" size={18} color={colors.bgPrimary} />
              <Text style={styles.shareBtnText}>SHARE LINK</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <CardPagerModal
        visible={expandedIdx !== null}
        onClose={() => setExpandedIdx(null)}
        listings={displayListings}
        cards={cards}
        decksById={decksById}
        initialIndex={expandedIdx ?? 0}
        isWishlist={isWishlist}
        onReceive={
          isOwner && isWishlist
            ? (l) => {
                setExpandedIdx(null);
                markReceived(l);
              }
            : undefined
        }
      />
    </>
  );
}

// ---------------- sort + helpers ----------------

function applySortMode(
  listings: Listing[],
  cards: Record<string, CardInfo>,
  mode: SortMode,
): Listing[] {
  const cardOf = (l: Listing) => cards[l.card_code] || ({} as CardInfo);
  const out = listings.slice();
  if (mode === 'custom-3x3' || mode === 'custom-4x3') {
    // Nulls (new listings without a position) sort to the end, matching the
    // web app's `order(sort_order, nullsFirst: false)`. Among nulls the input
    // order is preserved (stable sort) so freshly-added cards stay together at
    // the end in insertion order — NOT regrouped by card_code, which for One
    // Piece's color-grouped numbering would look like an unwanted color sort.
    return out.sort((a, b) => (a.sort_order ?? Infinity) - (b.sort_order ?? Infinity));
  }
  if (mode === 'release') {
    return out.sort(
      (a, b) =>
        (cardOf(b).release_order ?? 0) - (cardOf(a).release_order ?? 0) ||
        String(a.card_code).localeCompare(b.card_code),
    );
  }
  if (mode === 'color') {
    const rank = (l: Listing) => {
      const i = COLOR_ORDER.indexOf(cardOf(l).color ?? '');
      return i < 0 ? 99 : i;
    };
    return out.sort(
      (a, b) =>
        rank(a) - rank(b) ||
        (cardOf(a).cost ?? 0) - (cardOf(b).cost ?? 0) ||
        String(a.card_code).localeCompare(b.card_code),
    );
  }
  if (mode === 'cost') {
    return out.sort(
      (a, b) =>
        (cardOf(a).cost ?? 99) - (cardOf(b).cost ?? 99) ||
        String(a.card_code).localeCompare(b.card_code),
    );
  }
  if (mode === 'ram') {
    return out.sort(
      (a, b) =>
        (cardOf(a).ram ?? 99) - (cardOf(b).ram ?? 99) ||
        String(a.card_code).localeCompare(b.card_code),
    );
  }
  if (mode === 'ptype') {
    const rank = (l: Listing) => {
      const t = (cardOf(l).types || [])[0];
      const i = POKEMON_TYPES.indexOf(t ?? '');
      return i < 0 ? 99 : i;
    };
    return out.sort(
      (a, b) =>
        rank(a) - rank(b) ||
        (cardOf(b).hp ?? 0) - (cardOf(a).hp ?? 0) ||
        String(a.card_code).localeCompare(b.card_code),
    );
  }
  if (mode === 'hp') {
    return out.sort(
      (a, b) =>
        (cardOf(b).hp ?? -1) - (cardOf(a).hp ?? -1) ||
        String(a.card_code).localeCompare(b.card_code),
    );
  }
  if (mode === 'supertype') {
    const rank = (l: Listing) => {
      const i = POKEMON_SUPERTYPES.indexOf(cardOf(l).supertype ?? '');
      return i < 0 ? 99 : i;
    };
    return out.sort(
      (a, b) => rank(a) - rank(b) || String(a.card_code).localeCompare(b.card_code),
    );
  }
  return out;
}

// ---------------- subcomponents ----------------

function EditToolbar({
  aestheticsMode,
  onToggleAesthetics,
  onAddCards,
  onOpenSettings,
}: {
  aestheticsMode: boolean;
  onToggleAesthetics: () => void;
  onAddCards: () => void;
  onOpenSettings?: () => void; // owner-only; hidden for collaborators
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.toolbar}>
      <Pressable
        style={({ pressed }) => [
          styles.toolbarIconBtn,
          aestheticsMode && styles.toolbarBtnActive,
          pressed && { opacity: 0.7 },
        ]}
        onPress={onToggleAesthetics}
        accessibilityLabel={aestheticsMode ? 'Exit sort mode' : 'Sort mode'}>
        <Ionicons
          name="color-palette-outline"
          size={18}
          color={aestheticsMode ? colors.bgPrimary : colors.accent}
        />
      </Pressable>
      {onOpenSettings ? (
        <Pressable
          onPress={onOpenSettings}
          style={({ pressed }) => [styles.toolbarIconBtn, pressed && { opacity: 0.7 }]}
          accessibilityLabel="Binder settings">
          <Ionicons name="settings-outline" size={18} color={colors.accent} />
        </Pressable>
      ) : null}
      <Pressable
        style={({ pressed }) => [styles.toolbarBtnPrimary, pressed && { opacity: 0.7 }]}
        onPress={onAddCards}
        accessibilityLabel="Add cards">
        <Ionicons name="add" size={22} color={colors.bgPrimary} />
      </Pressable>
    </View>
  );
}

function SortPicker({
  value,
  options,
  onChange,
}: {
  value: SortMode;
  options: { value: SortMode; label: string }[];
  onChange: (m: SortMode) => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.sortPicker}>
      <FlatList
        horizontal
        keyExtractor={(o) => o.value}
        data={options}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 8, paddingHorizontal: 12 }}
        renderItem={({ item }) => {
          const active = item.value === value;
          return (
            <Pressable
              onPress={() => onChange(item.value)}
              style={[styles.sortChip, active && styles.sortChipActive]}>
              <Text style={[styles.sortChipText, active && styles.sortChipTextActive]}>
                {item.label}
              </Text>
            </Pressable>
          );
        }}
      />
    </View>
  );
}

function Pagination({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (p: number) => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.pagination}>
      <Pressable
        disabled={page <= 1}
        onPress={() => onChange(page - 1)}
        style={[styles.pageBtn, page <= 1 && styles.pageBtnDisabled]}>
        <Ionicons name="chevron-back" size={16} color={colors.textPrimary} />
      </Pressable>
      <Text style={styles.pageLabel}>
        Page {page} / {totalPages}
      </Text>
      <Pressable
        disabled={page >= totalPages}
        onPress={() => onChange(page + 1)}
        style={[styles.pageBtn, page >= totalPages && styles.pageBtnDisabled]}>
        <Ionicons name="chevron-forward" size={16} color={colors.textPrimary} />
      </Pressable>
    </View>
  );
}

function BinderPager({
  listings,
  cards,
  decksById,
  numColumns,
  pageSize,
  currentPage,
  onPageChange,
  onCardPress,
  isWishlist,
}: {
  listings: Listing[];
  cards: Record<string, CardInfo>;
  decksById: Record<string, { id: string; name: string | null }>;
  numColumns: number;
  pageSize: number;
  currentPage: number;
  onPageChange: (p: number) => void;
  onCardPress: (absoluteIdx: number) => void;
  isWishlist: boolean;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [pageWidth, setPageWidth] = useState(Dimensions.get('window').width);
  const [pageHeight, setPageHeight] = useState(0);
  const listRef = useRef<FlatList<Listing[]>>(null);

  // Build pages: chunk listings into pageSize-sized arrays, pad the last
  // page with nulls so every page renders a full pageSize grid.
  const pages: (Listing | null)[][] = [];
  for (let i = 0; i < listings.length; i += pageSize) {
    const chunk: (Listing | null)[] = listings.slice(i, i + pageSize);
    while (chunk.length < pageSize) chunk.push(null);
    pages.push(chunk);
  }
  if (pages.length === 0) pages.push(new Array(pageSize).fill(null));

  // Sync scroll position when currentPage is bumped externally (chevrons).
  useEffect(() => {
    if (listRef.current && pages.length > 0) {
      listRef.current.scrollToIndex({ index: currentPage - 1, animated: true });
    }
  }, [currentPage, pages.length]);

  // Both supported layouts are 3 rows; only the column count varies.
  const numRows = 3;
  const CARD_ASPECT = 0.72;
  const PAGE_PAD = 6;
  const CELL_PAD = 3;
  const LABEL_H = 26; // code + meta text under each card

  // Pick the card size that fills whichever dimension is tighter — width
  // (cells side-by-side) or height (rows stacked). Fall back to a sane
  // estimate before onLayout fires. Floor the result so every cell width
  // is an integer; otherwise sub-pixel rounding can push the Nth cell
  // onto the next row (showing 4-4-3-1 instead of 4-4-4).
  const availW = pageWidth - PAGE_PAD * 2;
  const availH = (pageHeight || 0) - PAGE_PAD * 2;
  const cellMaxW = availW / numColumns - CELL_PAD * 2;
  const cellMaxH = availH > 0 ? availH / numRows - CELL_PAD * 2 - LABEL_H : Infinity;
  const cardW = Math.floor(Math.max(40, Math.min(cellMaxW, cellMaxH * CARD_ASPECT)));
  const cardH = Math.floor(cardW / CARD_ASPECT);
  const gridWidth = numColumns * (cardW + CELL_PAD * 2);

  return (
    <FlatList
      ref={listRef as React.RefObject<FlatList<(Listing | null)[]>> as unknown as React.RefObject<FlatList<Listing[]>>}
      data={pages as unknown as Listing[][]}
      keyExtractor={(_, i) => `page-${i}`}
      horizontal
      pagingEnabled
      showsHorizontalScrollIndicator={false}
      onLayout={(e) => {
        setPageWidth(e.nativeEvent.layout.width);
        setPageHeight(e.nativeEvent.layout.height);
      }}
      getItemLayout={(_, i) => ({ length: pageWidth, offset: pageWidth * i, index: i })}
      onMomentumScrollEnd={(e) => {
        const idx = Math.round(e.nativeEvent.contentOffset.x / pageWidth);
        if (idx + 1 !== currentPage) onPageChange(idx + 1);
      }}
      renderItem={({ item: page, index: pageIndex }) => {
        const cellWidth = cardW + CELL_PAD * 2;
        return (
          <View style={[styles.binderPage, { width: pageWidth }]}>
            <View style={[styles.binderPageGrid, { width: gridWidth }]}>
              {(page as unknown as (Listing | null)[]).map((l, i) => {
                if (!l) {
                  return (
                    <View
                      key={`empty-${pageIndex}-${i}`}
                      style={[styles.binderPageCell, { width: cellWidth }]}>
                      <View
                        style={[
                          styles.placeholder,
                          styles.emptySlot,
                          { width: cardW, height: cardH, borderRadius: radius.sm },
                        ]}
                      />
                      <View style={{ height: LABEL_H }} />
                    </View>
                  );
                }
                const card = cards[l.card_code];
                return (
                  <Pressable
                    key={l.id}
                    onPress={() => onCardPress(pageIndex * pageSize + i)}
                    style={({ pressed }) => [
                      styles.binderPageCell,
                      { width: cellWidth },
                      pressed && styles.cellPressed,
                    ]}>
                    {card?.image_url ? (
                      <Image
                        source={{ uri: card.image_url }}
                        style={{
                          width: cardW,
                          height: cardH,
                          borderRadius: radius.sm,
                          backgroundColor: colors.bgCard,
                        }}
                        contentFit="contain"
                      />
                    ) : (
                      <View
                        style={[
                          styles.placeholder,
                          { width: cardW, height: cardH, borderRadius: radius.sm },
                        ]}
                      />
                    )}
                    {isWishlist && l.deck_id && decksById[l.deck_id] ? (
                      <View style={styles.deckTileBadge}>
                        <Text style={styles.deckTileBadgeText}>🃏</Text>
                      </View>
                    ) : null}
                    <Text style={[styles.cardCode, { width: cardW }]} numberOfLines={1}>
                      {l.card_code}
                    </Text>
                    {!isWishlist ? (
                      <Text style={[styles.cardMeta, { width: cardW }]} numberOfLines={1}>
                        ×{l.quantity} · {l.listing_type}
                      </Text>
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          </View>
        );
      }}
    />
  );
}

function DraggableTile({
  item,
  drag,
  isActive,
  cards,
  numColumns,
  isWishlist,
}: RenderItemParams<Listing> & {
  cards: Record<string, CardInfo>;
  numColumns: number;
  isWishlist: boolean;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const card = cards[item.card_code];
  return (
    <ScaleDecorator>
      <View style={[styles.dragCell, isActive && { opacity: 0.7 }]}>
        {card?.image_url ? (
          <Image source={{ uri: card.image_url }} style={styles.dragImg} contentFit="contain" />
        ) : (
          <View style={[styles.dragImg, styles.placeholder]} />
        )}
        <View style={styles.dragInfo}>
          <Text style={styles.cardCode}>{item.card_code}</Text>
          {!isWishlist ? (
            <Text style={styles.cardMeta}>×{item.quantity} · {item.listing_type}</Text>
          ) : null}
        </View>
        <Pressable
          onPressIn={drag}
          disabled={isActive}
          hitSlop={12}
          accessibilityLabel="Drag to reorder">
          <Ionicons name="reorder-three" size={26} color={colors.accent} />
        </Pressable>
      </View>
    </ScaleDecorator>
  );
}

// ---------------- Modals & sheets ----------------

function EditBinderModal({
  visible,
  onClose,
  binderId,
  currentName,
  currentFlair,
  onSaveName,
  onSaveFlair,
  onDelete,
}: {
  visible: boolean;
  onClose: () => void;
  binderId: string;
  currentName: string;
  currentFlair: Flair;
  onSaveName: (next: string) => Promise<boolean>;
  onSaveFlair: (next: Flair) => Promise<void>;
  onDelete: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [name, setName] = useState(currentName);
  const [savingName, setSavingName] = useState(false);

  // Partner management (trade binders only; mirrors the web collab section).
  const [partners, setPartners] = useState<{ user_id: string; display_name: string }[]>([]);
  const [partnerName, setPartnerName] = useState('');
  const [partnerBusy, setPartnerBusy] = useState(false);
  const [partnerMsg, setPartnerMsg] = useState<string | null>(null);

  const loadPartners = useCallback(async () => {
    if (!binderId) return;
    const { data } = await supabase.rpc('binder_collaborators_list', { p_binder_id: binderId });
    setPartners((data as { user_id: string; display_name: string }[]) ?? []);
  }, [binderId]);

  useEffect(() => {
    if (visible) {
      setName(currentName);
      setPartnerName('');
      setPartnerMsg(null);
      if (currentFlair === 'trade') loadPartners();
    }
  }, [visible, currentName, currentFlair, loadPartners]);

  async function invitePartner() {
    const nm = partnerName.trim();
    if (!nm) return;
    setPartnerBusy(true);
    setPartnerMsg(null);
    const { error } = await supabase.rpc('share_binder', { p_binder_id: binderId, p_display_name: nm });
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
    const { error } = await supabase.rpc('unshare_binder', { p_binder_id: binderId, p_user_id: uid });
    if (error) {
      setPartnerMsg(error.message);
      return;
    }
    loadPartners();
  }

  async function commitName() {
    if (name.trim() === currentName.trim() || !name.trim()) {
      onClose();
      return;
    }
    setSavingName(true);
    const ok = await onSaveName(name);
    setSavingName(false);
    if (ok) onClose();
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.shareBackdrop} onPress={onClose}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ width: '100%' }}>
          <Pressable style={styles.editCard} onPress={(e) => e.stopPropagation()}>
            <Pressable style={styles.shareCloseBtn} onPress={onClose}>
              <Ionicons name="close" size={24} color={colors.textPrimary} />
            </Pressable>
            <Text style={styles.shareTitle}>EDIT BINDER</Text>

            <Text style={styles.editLabel}>Name</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              autoCapitalize="sentences"
              style={styles.editInput}
              placeholderTextColor={colors.textMuted}
            />

            <Text style={styles.editLabel}>Flair</Text>
            <View style={styles.editPillRow}>
              {FLAIR_OPTIONS.map((opt) => {
                const active = opt.value === currentFlair;
                return (
                  <Pressable
                    key={opt.value}
                    onPress={() => onSaveFlair(opt.value)}
                    style={[styles.editPill, active && styles.editPillActive]}>
                    <Text style={[styles.editPillText, active && styles.editPillTextActive]}>
                      {opt.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Pressable
              style={({ pressed }) => [
                styles.shareBtn,
                pressed && styles.shareBtnPressed,
                (savingName || !name.trim()) && styles.editSaveDisabled,
              ]}
              disabled={savingName || !name.trim()}
              onPress={commitName}>
              {savingName ? (
                <ActivityIndicator color={colors.bgPrimary} />
              ) : (
                <Text style={styles.shareBtnText}>SAVE NAME</Text>
              )}
            </Pressable>

            {currentFlair === 'trade' ? (
              <View style={styles.partnerSection}>
                <Text style={styles.editLabel}>Share with partner</Text>
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
                ) : (
                  <View style={styles.partnerInviteRow}>
                    <TextInput
                      value={partnerName}
                      onChangeText={setPartnerName}
                      placeholder="Partner's display name"
                      placeholderTextColor={colors.textMuted}
                      autoCapitalize="none"
                      style={[styles.editInput, styles.partnerInput]}
                    />
                    <Pressable
                      style={({ pressed }) => [
                        styles.partnerInviteBtn,
                        (partnerBusy || !partnerName.trim()) && styles.editSaveDisabled,
                        pressed && { opacity: 0.7 },
                      ]}
                      disabled={partnerBusy || !partnerName.trim()}
                      onPress={invitePartner}>
                      {partnerBusy ? (
                        <ActivityIndicator color={colors.bgPrimary} />
                      ) : (
                        <Text style={styles.partnerInviteBtnText}>Invite</Text>
                      )}
                    </Pressable>
                  </View>
                )}
                {partnerMsg ? <Text style={styles.partnerMsg}>{partnerMsg}</Text> : null}
              </View>
            ) : null}

            <Pressable
              style={({ pressed }) => [styles.deleteBtn, pressed && { opacity: 0.7 }]}
              onPress={onDelete}>
              <Ionicons name="trash-outline" size={16} color={colors.danger} />
              <Text style={styles.deleteBtnText}>DELETE BINDER</Text>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}

type BrowserFilters = {
  series: string;
  color: string;
  type: string;
  cost: string;
  attribute: string;
  rarity: string;
  supertype: string;
  subtype: string;
  hp: string; // HP minimum
  tag: string; // Cyberpunk classification (types[])
  ram: string; // Cyberpunk RAM
};

const EMPTY_FILTERS: BrowserFilters = {
  series: '',
  color: '',
  type: '',
  cost: '',
  attribute: '',
  rarity: '',
  supertype: '',
  subtype: '',
  hp: '',
  tag: '',
  ram: '',
};

function CardBrowserModal({
  visible,
  onClose,
  game,
  onPickCard,
}: {
  visible: boolean;
  onClose: () => void;
  game: string;
  onPickCard: (allResults: CardInfo[], index: number) => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<BrowserFilters>(EMPTY_FILTERS);
  const [seriesOptions, setSeriesOptions] = useState<string[]>([]);
  const [results, setResults] = useState<CardInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [activeFilter, setActiveFilter] = useState<keyof BrowserFilters | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset when modal closes; load series list once per game when it opens.
  useEffect(() => {
    if (!visible) {
      setSearch('');
      setFilters(EMPTY_FILTERS);
      setResults([]);
      return;
    }
    loadSeries();
    runSearch('', EMPTY_FILTERS);
  }, [visible, game]);

  async function loadSeries() {
    // Track the newest release_order seen per series so we can sort sets
    // newest-first (matching the web app's release-order convention).
    const newestBySeries: Record<string, number> = {};
    let from = 0;
    const page = 1000;
    while (from < 20000) {
      const { data, error } = await supabase
        .from('cards')
        .select('series, release_order')
        .eq('game', game)
        .range(from, from + page - 1);
      if (error || !data || data.length === 0) break;
      data.forEach((r) => {
        if (!r.series) return;
        const ro = r.release_order ?? -Infinity;
        if (newestBySeries[r.series] === undefined || ro > newestBySeries[r.series]) {
          newestBySeries[r.series] = ro;
        }
      });
      if (data.length < page) break;
      from += page;
    }
    const sorted = Object.keys(newestBySeries).sort(
      (a, b) => newestBySeries[b] - newestBySeries[a],
    );
    setSeriesOptions(sorted);
  }

  function runSearch(q: string, f: BrowserFilters) {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      setBusy(true);
      const projection =
        game === 'pokemon'
          ? 'card_code, name, series, type, types, supertype, subtypes, hp, rarity, image_url, image_url_lg, release_order'
          : game === 'cyberpunk'
            ? 'card_code, name, series, color, type, cost, ram, types, rarity, image_url, image_url_lg, release_order'
            : 'card_code, name, series, color, type, cost, attribute, rarity, image_url, image_url_lg, release_order';
      let query = supabase
        .from('cards')
        .select(projection)
        .eq('game', game);

      if (q) {
        const safe = q.replace(/[%,]/g, '');
        query = query.or(`name.ilike.%${safe}%,card_code.ilike.%${safe}%`);
      }
      if (f.series) query = query.eq('series', f.series);
      if (f.rarity) query = query.eq('rarity', f.rarity);

      if (game === 'pokemon') {
        if (f.type) query = query.contains('types', [f.type]);
        if (f.supertype) query = query.eq('supertype', f.supertype);
        if (f.subtype) query = query.contains('subtypes', [f.subtype]);
        if (f.hp) query = query.gte('hp', parseInt(f.hp, 10));
      } else if (game === 'cyberpunk') {
        if (f.color) query = query.eq('color', f.color); // colors are single-valued
        if (f.type) query = query.eq('type', f.type); // Legend/Unit/Gear/Program
        if (f.cost !== '') query = query.eq('cost', parseInt(f.cost, 10));
        if (f.tag) query = query.contains('types', [f.tag]); // classifications text[]
        if (f.ram !== '') query = query.eq('ram', parseInt(f.ram, 10));
      } else {
        if (f.color) query = query.ilike('color', `%${f.color}%`);
        if (f.type) query = query.eq('type', f.type);
        if (f.cost !== '') query = query.eq('cost', parseInt(f.cost, 10));
        if (f.attribute) query = query.eq('attribute', f.attribute);
      }

      const { data, error } = await query
        .order('release_order', { ascending: false })
        .order('card_code', { ascending: false })
        .limit(120);
      setBusy(false);
      if (error) {
        console.warn('browser search', error.message);
        setResults([]);
        return;
      }
      setResults((data ?? []) as unknown as CardInfo[]);
    }, 250);
  }

  function updateFilter(k: keyof BrowserFilters, v: string) {
    const next = { ...filters, [k]: v };
    setFilters(next);
    runSearch(search, next);
  }

  function clearAll() {
    setFilters(EMPTY_FILTERS);
    setSearch('');
    runSearch('', EMPTY_FILTERS);
  }

  const filterDefs: { key: keyof BrowserFilters; label: string; options: string[] }[] =
    game === 'pokemon'
      ? [
          { key: 'series', label: 'Set', options: seriesOptions },
          { key: 'supertype', label: 'Supertype', options: POKEMON_SUPERTYPES },
          { key: 'subtype', label: 'Subtype', options: POKEMON_SUBTYPES },
          { key: 'type', label: 'Type', options: POKEMON_TYPES },
          { key: 'hp', label: 'HP ≥', options: POKEMON_HP_BUCKETS.map(String) },
          { key: 'rarity', label: 'Rarity', options: POKEMON_RARITIES },
        ]
      : game === 'cyberpunk'
        ? [
            { key: 'series', label: 'Set', options: seriesOptions },
            { key: 'color', label: 'Color', options: CYBERPUNK_COLORS },
            { key: 'type', label: 'Type', options: CYBERPUNK_TYPES },
            { key: 'cost', label: 'Cost', options: CYBERPUNK_COSTS.map(String) },
            { key: 'tag', label: 'Tag', options: CYBERPUNK_TAGS },
            { key: 'ram', label: 'RAM', options: CYBERPUNK_RAM.map(String) },
            { key: 'rarity', label: 'Rarity', options: CYBERPUNK_RARITIES },
          ]
        : [
            { key: 'series', label: 'Set', options: seriesOptions },
            { key: 'color', label: 'Color', options: OPTCG_COLORS },
            { key: 'type', label: 'Type', options: OPTCG_TYPES },
            { key: 'cost', label: 'Cost', options: OPTCG_COSTS.map(String) },
            { key: 'attribute', label: 'Attribute', options: OPTCG_ATTRIBUTES },
            { key: 'rarity', label: 'Rarity', options: OPTCG_RARITIES },
          ];


  const activeFilterCount = Object.values(filters).filter((v) => v !== '').length;

  // Display helper for series names. Rule: a hyphen survives ONLY when it's
  // part of a series code (e.g. "OP-01", "sv1-1" — a letter/digit on each
  // side). Every other hyphen is dropped: " - " separators ("OP-01 - Romance
  // Dawn" → "OP-01 Romance Dawn"), stand-alone hyphens between words, and any
  // leading/trailing dashes ("- Romance Dawn -" → "Romance Dawn"). Applies to
  // all sets, current and future.
  function prettyOption(filterKey: keyof BrowserFilters, raw: string): string {
    if (raw === '' || filterKey !== 'series') return raw;
    return raw
      .replace(/\s+-\s+/g, ' ') // collapse " - " separators between words
      .replace(/([A-Za-z])-([A-Za-z])/g, '$1 $2') // stand-alone word hyphen → space
      .replace(/^[\s-]+|[\s-]+$/g, '') // strip leading/trailing dashes + space
      .replace(/\s{2,}/g, ' '); // squeeze any doubled spaces
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.browserWrap}>
        <View style={styles.browserHeader}>
          <Text style={styles.browserTitle}>ADD CARDS</Text>
          <Pressable onPress={onClose}>
            <Ionicons name="close" size={26} color={colors.textPrimary} />
          </Pressable>
        </View>
        <TextInput
          value={search}
          onChangeText={(v) => {
            setSearch(v);
            runSearch(v, filters);
          }}
          placeholder={game === 'pokemon' ? 'Pikachu, sv1-1, …' : 'Luffy, OP01-001, …'}
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.browserInput}
        />

        <Pressable style={styles.browserFilterToggle} onPress={() => setFiltersOpen((o) => !o)}>
          <Ionicons name="options-outline" size={16} color={colors.accent} />
          <Text style={styles.browserFilterToggleText}>
            {filtersOpen ? 'Hide filters' : 'Filters'}
            {activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
          </Text>
          <Ionicons
            name={filtersOpen ? 'chevron-up' : 'chevron-down'}
            size={16}
            color={colors.accent}
          />
        </Pressable>

        {filtersOpen ? (
          <ScrollView
            style={styles.browserFiltersWrap}
            contentContainerStyle={styles.browserFilters}>
            {filterDefs.map((def) => {
              if (def.options.length === 0) return null;
              const value = filters[def.key];
              return (
                <Pressable
                  key={def.key}
                  onPress={() => setActiveFilter(def.key)}
                  style={({ pressed }) => [styles.filterDropdown, pressed && { opacity: 0.7 }]}>
                  <Text style={styles.filterDropdownLabel}>{def.label.toUpperCase()}</Text>
                  <View style={styles.filterDropdownValueRow}>
                    <Text
                      style={[
                        styles.filterDropdownValue,
                        value === '' && styles.filterDropdownValueEmpty,
                      ]}
                      numberOfLines={1}>
                      {value === '' ? 'Any' : prettyOption(def.key, value)}
                    </Text>
                    <Ionicons name="chevron-down" size={16} color={colors.textMuted} />
                  </View>
                </Pressable>
              );
            })}
            <View style={styles.browserFilterButtons}>
              <Pressable
                style={({ pressed }) => [styles.applyBtn, pressed && { opacity: 0.7 }]}
                onPress={() => setFiltersOpen(false)}>
                <Text style={styles.applyBtnText}>APPLY</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.clearBtn, pressed && { opacity: 0.7 }]}
                onPress={clearAll}>
                <Text style={styles.clearBtnText}>CLEAR</Text>
              </Pressable>
            </View>
          </ScrollView>
        ) : busy ? (
          <View style={{ alignItems: 'center', marginTop: 24 }}>
            <DiceLoader />
          </View>
        ) : (
          <FlatList
            data={results}
            keyExtractor={(c) => c.card_code}
            numColumns={3}
            contentContainerStyle={{ padding: 8 }}
            ListEmptyComponent={
              <Text style={styles.empty}>{search ? 'No matches.' : 'Loading…'}</Text>
            }
            renderItem={({ item, index }) => (
              <Pressable
                onPress={() => onPickCard(results, index)}
                style={({ pressed }) => [styles.cell, { flex: 1 / 3 }, pressed && styles.cellPressed]}>
                {item.image_url ? (
                  <Image source={{ uri: item.image_url }} style={styles.cardImg} contentFit="contain" />
                ) : (
                  <View style={[styles.cardImg, styles.placeholder]} />
                )}
                <Text style={styles.cardCode} numberOfLines={1}>{item.card_code}</Text>
                <Text style={styles.cardMeta} numberOfLines={1}>{item.name}</Text>
              </Pressable>
            )}
          />
        )}

        <FilterPickerSheet
          visible={activeFilter !== null}
          label={activeFilter ? filterDefs.find((f) => f.key === activeFilter)?.label ?? '' : ''}
          options={activeFilter ? filterDefs.find((f) => f.key === activeFilter)?.options ?? [] : []}
          current={activeFilter ? filters[activeFilter] : ''}
          formatLabel={(v) => (activeFilter ? prettyOption(activeFilter, v) : v)}
          onPick={(v) => {
            if (activeFilter) updateFilter(activeFilter, v);
            setActiveFilter(null);
          }}
          onClose={() => setActiveFilter(null)}
        />
      </View>
    </Modal>
  );
}

function FilterPickerSheet({
  visible,
  label,
  options,
  current,
  formatLabel,
  onPick,
  onClose,
}: {
  visible: boolean;
  label: string;
  options: string[];
  current: string;
  formatLabel?: (v: string) => string;
  onPick: (v: string) => void;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.shareBackdrop} onPress={onClose}>
        <Pressable style={styles.filterSheetCard} onPress={(e) => e.stopPropagation()}>
          <View style={styles.filterSheetHeader}>
            <Text style={styles.shareTitle}>{label.toUpperCase()}</Text>
            <Pressable onPress={onClose}>
              <Ionicons name="close" size={24} color={colors.textPrimary} />
            </Pressable>
          </View>
          <FlatList
            data={['', ...options]}
            keyExtractor={(v, i) => `${i}-${v}`}
            renderItem={({ item }) => {
              const active = item === current;
              return (
                <Pressable
                  onPress={() => onPick(item)}
                  style={({ pressed }) => [
                    styles.filterOption,
                    active && styles.filterOptionActive,
                    pressed && { opacity: 0.7 },
                  ]}>
                  <Text style={[styles.filterOptionText, active && styles.filterOptionTextActive]}>
                    {item === '' ? 'Any' : formatLabel ? formatLabel(item) : item}
                  </Text>
                  {active ? <Ionicons name="checkmark" size={18} color={colors.accent} /> : null}
                </Pressable>
              );
            }}
          />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function ListingFormSheet({
  visible,
  title,
  card,
  initialQty,
  initialType,
  hideForm,
  onClose,
  onSave,
  onDestroy,
  destroyLabel,
}: {
  visible: boolean;
  title: string;
  card: CardInfo | undefined;
  initialQty: number;
  initialType: ListingType;
  hideForm?: boolean;
  onClose: () => void;
  onSave: (qty: number, type: ListingType) => Promise<void>;
  onDestroy?: () => Promise<void>;
  destroyLabel?: string;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [qty, setQty] = useState(String(initialQty));
  const [ltype, setLtype] = useState<ListingType>(initialType);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (visible) {
      setQty(String(initialQty));
      setLtype(initialType);
    }
  }, [visible, initialQty, initialType]);

  async function commit() {
    const n = parseInt(qty, 10);
    if (!n || n < 1) {
      Alert.alert('Quantity must be at least 1');
      return;
    }
    setBusy(true);
    await onSave(n, ltype);
    setBusy(false);
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.shareBackdrop} onPress={onClose}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ width: '100%' }}>
          <Pressable style={styles.editCard} onPress={(e) => e.stopPropagation()}>
            <Pressable style={styles.shareCloseBtn} onPress={onClose}>
              <Ionicons name="close" size={24} color={colors.textPrimary} />
            </Pressable>
            <Text style={styles.shareTitle}>{title}</Text>

            {card?.image_url ? (
              <Image source={{ uri: card.image_url }} style={styles.sheetImg} contentFit="contain" />
            ) : null}
            <Text style={styles.sheetCardName}>{card?.name ?? card?.card_code}</Text>
            <Text style={styles.sheetCode}>{card?.card_code}</Text>

            {!hideForm ? (
              <>
                <Text style={styles.editLabel}>Quantity</Text>
                <TextInput
                  value={qty}
                  onChangeText={setQty}
                  keyboardType="number-pad"
                  style={styles.editInput}
                />

                <Text style={styles.editLabel}>Listing type</Text>
                <View style={styles.editPillRow}>
                  {LISTING_TYPES.map((opt) => {
                    const active = opt.value === ltype;
                    return (
                      <Pressable
                        key={opt.value}
                        onPress={() => setLtype(opt.value)}
                        style={[styles.editPill, active && styles.editPillActive]}>
                        <Text style={[styles.editPillText, active && styles.editPillTextActive]}>
                          {opt.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                <Pressable
                  style={({ pressed }) => [
                    styles.shareBtn,
                    pressed && styles.shareBtnPressed,
                    busy && styles.editSaveDisabled,
                  ]}
                  disabled={busy}
                  onPress={commit}>
                  {busy ? <ActivityIndicator color={colors.bgPrimary} /> : <Text style={styles.shareBtnText}>SAVE</Text>}
                </Pressable>
              </>
            ) : null}

            {onDestroy ? (
              <Pressable
                style={({ pressed }) => [styles.deleteBtn, pressed && { opacity: 0.7 }]}
                onPress={onDestroy}>
                <Ionicons name="trash-outline" size={16} color={colors.danger} />
                <Text style={styles.deleteBtnText}>{destroyLabel ?? 'REMOVE'}</Text>
              </Pressable>
            ) : null}
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}

function AddListingPager({
  cards,
  index,
  onIndexChange,
  binderId,
  onClose,
  onSave,
  onRemoveAll,
  onAddToWishlist,
  isWishlist,
}: {
  cards: CardInfo[] | null;
  index: number;
  onIndexChange: (i: number) => void;
  binderId: string | null;
  onClose: () => void;
  onSave: (card: CardInfo, qty: number, ltype: ListingType) => Promise<void>;
  onRemoveAll: (cardCode: string) => Promise<void>;
  onAddToWishlist: ((card: CardInfo) => Promise<WishlistResult>) | null;
  isWishlist: boolean;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const [pageWidth, setPageWidth] = useState(Dimensions.get('window').width);
  const [qty, setQty] = useState('1');
  const [ltype, setLtype] = useState<ListingType>('trade');
  const [busy, setBusy] = useState(false);
  const [existingCount, setExistingCount] = useState<number | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const [wishToast, setWishToast] = useState<string | null>(null);
  const wishToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const addingRef = useRef<Set<string>>(new Set());
  const listRef = useRef<FlatList<CardInfo>>(null);
  const visible = cards !== null && cards.length > 0;
  const currentCard = visible ? cards[index] : null;

  // Native gesture wrapper for the horizontal FlatList. The per-page vertical
  // swipe (swipe-up to wishlist) blocks this gesture while it's active, so a
  // vertical pull never doubles as a horizontal page flip; horizontal motion
  // bails the pan and lets this gesture page normally.
  const listGesture = useMemo(() => Gesture.Native(), []);

  function showWishToast(msg: string) {
    setWishToast(msg);
    if (wishToastTimer.current) clearTimeout(wishToastTimer.current);
    wishToastTimer.current = setTimeout(() => setWishToast(null), 1800);
  }

  async function handleWishlist(card: CardInfo) {
    if (!onAddToWishlist) return;
    // Guard against rapid repeat swipes on the same card racing each other:
    // addCardToWishlist re-checks the count, but concurrent calls all read 0
    // before the first insert commits → duplicate rows. The in-flight set (set
    // synchronously before the await) plus the known existing-count block both
    // the race and any re-add of a card that's already wishlisted.
    if (addingRef.current.has(card.card_code) || (existingCount ?? 0) > 0) {
      showWishToast('Already in wishlist');
      return;
    }
    addingRef.current.add(card.card_code);
    try {
      const result = await onAddToWishlist(card);
      showWishToast(
        result === 'added'
          ? 'Added to wishlist'
          : result === 'created-and-added'
            ? 'Wishlist binder created · added'
            : result === 'duplicate'
              ? 'Already in wishlist'
              : 'Could not add to wishlist',
      );
      await refreshExistingCount();
    } finally {
      addingRef.current.delete(card.card_code);
    }
  }

  // Reset qty/type and refresh existing-count whenever the visible card changes.
  useEffect(() => {
    if (!currentCard || !binderId) {
      setExistingCount(null);
      return;
    }
    setQty('1');
    setLtype('trade');
    setSavedFlash(false);
    supabase
      .from('listings')
      .select('id', { count: 'exact', head: true })
      .eq('binder_id', binderId)
      .eq('card_code', currentCard.card_code)
      .then((r) => setExistingCount(r.count ?? 0));
  }, [currentCard?.card_code, binderId]);

  // Keep the pager scrolled to the active page when index is set externally
  // (e.g. when tapping a card in the grid opens the modal at that position).
  useEffect(() => {
    if (visible && listRef.current) {
      listRef.current.scrollToIndex({ index, animated: false });
    }
  }, [visible, index]);

  async function refreshExistingCount() {
    if (!currentCard || !binderId) return 0;
    const { count } = await supabase
      .from('listings')
      .select('id', { count: 'exact', head: true })
      .eq('binder_id', binderId)
      .eq('card_code', currentCard.card_code);
    const c = count ?? 0;
    setExistingCount(c);
    return c;
  }

  async function commit() {
    if (!currentCard) return;

    // Wishlist binders hold exactly one entry per card — a plain insert on
    // every SAVE was stacking duplicates. Dedup before inserting and confirm
    // with the on-card wishlist overlay.
    if (isWishlist) {
      setBusy(true);
      const already =
        (existingCount ?? 0) > 0 ? true : (await refreshExistingCount()) > 0;
      if (already) {
        showWishToast('Already in wishlist');
        setBusy(false);
        return;
      }
      await onSave(currentCard, 1, 'trade');
      await refreshExistingCount();
      setBusy(false);
      showWishToast('Added to wishlist');
      return;
    }

    const n = parseInt(qty, 10);
    if (!n || n < 1) {
      Alert.alert('Quantity must be at least 1');
      return;
    }
    setBusy(true);
    await onSave(currentCard, n, ltype);
    setBusy(false);
    // Pager stays open so the user can keep adding from the same filter run.
    // Refresh the existing-count badge so it reflects the just-added listing,
    // reset the qty input, and briefly flash a "Saved" confirmation.
    await refreshExistingCount();
    setQty('1');
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1400);
  }

  function confirmRemoveAll() {
    if (!currentCard || !existingCount) return;
    Alert.alert(
      'Remove all listings?',
      `Remove all ${existingCount} listing${existingCount === 1 ? '' : 's'} of ${currentCard.name ?? currentCard.card_code} from this binder.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => onRemoveAll(currentCard.card_code),
        },
      ],
    );
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <GestureHandlerRootView
        style={styles.pagerWrap}
        onLayout={(e) => setPageWidth(e.nativeEvent.layout.width)}>
        <View style={styles.pagerHeader}>
          <Text style={styles.shareTitle}>ADD TO BINDER</Text>
          <Pressable onPress={onClose}>
            <Ionicons name="close" size={26} color={colors.textPrimary} />
          </Pressable>
        </View>

        {cards && cards.length > 0 ? (
          <>
            <View style={styles.pagerImageRow}>
              <GestureDetector gesture={listGesture}>
                <FlatList
                  ref={listRef}
                  data={cards}
                  horizontal
                  pagingEnabled
                  style={styles.pagerList}
                  showsHorizontalScrollIndicator={false}
                  keyExtractor={(c) => c.card_code}
                  initialScrollIndex={index}
                  getItemLayout={(_, i) => ({
                    length: pageWidth,
                    offset: pageWidth * i,
                    index: i,
                  })}
                  onMomentumScrollEnd={(e) => {
                    const i = Math.round(e.nativeEvent.contentOffset.x / pageWidth);
                    if (i !== index) onIndexChange(i);
                  }}
                  renderItem={({ item }) => (
                    <SwipeableDeckPage
                      card={item}
                      pageWidth={pageWidth}
                      onAddToWishlist={onAddToWishlist ? () => handleWishlist(item) : null}
                      listGesture={listGesture}
                    />
                  )}
                />
              </GestureDetector>
              <Text style={styles.pagerCountInline}>
                {index + 1} / {cards.length}
              </Text>
              {wishToast ? (
                <View style={styles.wishToastWrap} pointerEvents="none">
                  <View style={styles.wishToastPill}>
                    <Ionicons name="bookmark" size={16} color={colors.accent} />
                    <Text style={styles.wishToastText}>{wishToast}</Text>
                  </View>
                </View>
              ) : null}
            </View>

            <View style={[styles.pagerForm, { paddingBottom: insets.bottom + 16 }]}>
              {!isWishlist ? (
                <>
                  <Text style={styles.editLabel}>Quantity</Text>
                  <TextInput
                    value={qty}
                    onChangeText={setQty}
                    keyboardType="number-pad"
                    style={styles.editInput}
                  />

                  <Text style={styles.editLabel}>Listing type</Text>
                  <View style={styles.editPillRow}>
                    {LISTING_TYPES.map((opt) => {
                      const active = opt.value === ltype;
                      return (
                        <Pressable
                          key={opt.value}
                          onPress={() => setLtype(opt.value)}
                          style={[styles.editPill, active && styles.editPillActive]}>
                          <Text style={[styles.editPillText, active && styles.editPillTextActive]}>
                            {opt.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </>
              ) : null}

              <Pressable
                style={({ pressed }) => [
                  styles.shareBtn,
                  pressed && styles.shareBtnPressed,
                  busy && styles.editSaveDisabled,
                ]}
                disabled={busy}
                onPress={commit}>
                {busy ? (
                  <ActivityIndicator color={colors.bgPrimary} />
                ) : (
                  <Text style={styles.shareBtnText}>
                    {isWishlist ? 'ADD TO WISHLIST' : 'SAVE'}
                  </Text>
                )}
              </Pressable>

              {savedFlash ? (
                <View style={styles.savedFlash}>
                  <Ionicons name="checkmark-circle" size={16} color={colors.accent} />
                  <Text style={styles.savedFlashText}>Saved — swipe for more</Text>
                </View>
              ) : null}

              {/* Fixed-height slot so the REMOVE ALL button appears/disappears
                  in place as you swipe between cards instead of shifting the
                  whole pager layout. */}
              <View style={styles.removeAllSlot}>
                {existingCount && existingCount > 0 ? (
                  <Pressable
                    style={({ pressed }) => [styles.deleteBtn, { marginTop: 0 }, pressed && { opacity: 0.7 }]}
                    onPress={confirmRemoveAll}>
                    <Ionicons name="trash-outline" size={16} color={colors.danger} />
                    <Text style={styles.deleteBtnText}>
                      REMOVE ALL ({existingCount})
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          </>
        ) : null}

      </GestureHandlerRootView>
    </Modal>
  );
}

function SwipeableDeckPage({
  card,
  pageWidth,
  onAddToWishlist,
  listGesture,
}: {
  card: CardInfo;
  pageWidth: number;
  onAddToWishlist: (() => void) | null;
  listGesture: ReturnType<typeof Gesture.Native>;
}) {
  // `pull` is the upward distance (always positive) the user has dragged
  // from the resting position. We mirror it into translateY (negative) for
  // the card transform but drive the overlay interpolations off the
  // positive magnitude so all thresholds stay readable.
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const pull = useSharedValue(0);

  const pan = Gesture.Pan()
    .enabled(!!onAddToWishlist)
    // Activate only on a clear upward pull (20px) and bail fast on any
    // horizontal motion (failOffsetX ±8) so a sideways flick fails this gesture
    // immediately and the list pages with full native momentum (clean,
    // one-flick-per-card snapping with nothing interrupting the scroll).
    .activeOffsetY([-9999, -20])
    .failOffsetX([-8, 8])
    .simultaneousWithExternalGesture(listGesture)
    .onUpdate((e) => {
      pull.value = Math.max(0, -e.translationY);
    })
    .onEnd((e) => {
      const past = -e.translationY >= 180 || -e.velocityY >= 1400;
      if (past && onAddToWishlist) {
        pull.value = withTiming(320, { duration: 220 }, (finished) => {
          if (finished) runOnJS(onAddToWishlist)();
          pull.value = withSpring(0);
        });
      } else {
        pull.value = withSpring(0);
      }
    });

  const pageStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: -pull.value },
      { rotate: `${interpolate(pull.value, [0, 220], [0, -4], 'clamp')}deg` },
    ],
  }));

  // Thresholds kept low so the label is clearly visible even on a quick
  // flick (which can commit via velocity before a long drag accumulates).
  const overlayStyle = useAnimatedStyle(() => ({
    opacity: interpolate(pull.value, [20, 90], [0, 1], 'clamp'),
    transform: [{ scale: interpolate(pull.value, [20, 90], [0.7, 1], 'clamp') }],
    borderColor: interpolateColor(
      pull.value,
      [20, 110],
      [colors.textMuted, colors.accent],
    ),
  }));

  const overlayTextStyle = useAnimatedStyle(() => ({
    color: interpolateColor(
      pull.value,
      [20, 110],
      [colors.textMuted, colors.accent],
    ),
  }));

  const sparkleStyle = useAnimatedStyle(() => ({
    opacity: interpolate(pull.value, [90, 120], [0, 1], 'clamp'),
  }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[styles.pagerCardPage, { width: pageWidth }, pageStyle]}>
        {card.image_url ? (
          <Image
            source={{ uri: card.image_url_lg ?? card.image_url }}
            style={styles.pagerCardImg}
            contentFit="contain"
          />
        ) : (
          <View style={[styles.pagerCardImg, styles.placeholder]} />
        )}
        <Text style={styles.sheetCardName} numberOfLines={1}>{card.name ?? card.card_code}</Text>
        <Text style={styles.sheetCode}>{card.card_code}</Text>
        {onAddToWishlist ? (
          <View style={styles.deckWishOverlayWrap} pointerEvents="none">
            <Animated.View style={[styles.deckWishOverlay, overlayStyle]}>
              <Animated.Text style={[styles.deckWishOverlayText, overlayTextStyle, sparkleStyle]}>
                ✨
              </Animated.Text>
              <Animated.Text style={[styles.deckWishOverlayText, overlayTextStyle]}>
                wishlist
              </Animated.Text>
              <Animated.Text style={[styles.deckWishOverlayText, overlayTextStyle, sparkleStyle]}>
                ✨
              </Animated.Text>
            </Animated.View>
          </View>
        ) : null}
      </Animated.View>
    </GestureDetector>
  );
}

function EditListingSheet({
  listing,
  card,
  onClose,
  onSave,
  onRemove,
  isWishlist,
}: {
  listing: Listing | null;
  card: CardInfo | undefined;
  onClose: () => void;
  onSave: (l: Listing, qty: number, ltype: ListingType) => Promise<void>;
  onRemove: (l: Listing) => Promise<void>;
  isWishlist: boolean;
}) {
  if (!listing) return null;
  return (
    <ListingFormSheet
      visible={!!listing}
      title={isWishlist ? 'WISHLIST CARD' : 'EDIT LISTING'}
      card={card}
      initialQty={listing.quantity}
      initialType={listing.listing_type as ListingType}
      hideForm={isWishlist}
      onClose={onClose}
      onSave={async (qty, ltype) => {
        await onSave(listing, qty, ltype);
      }}
      onDestroy={async () => {
        Alert.alert(
          isWishlist ? 'Remove from wishlist?' : 'Remove this listing?',
          '',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Remove', style: 'destructive', onPress: () => onRemove(listing) },
          ],
        );
      }}
      destroyLabel={isWishlist ? 'REMOVE FROM WISHLIST' : 'REMOVE LISTING'}
    />
  );
}

function CardPagerModal({
  visible,
  onClose,
  listings,
  cards,
  decksById,
  initialIndex,
  isWishlist,
  onReceive,
}: {
  visible: boolean;
  onClose: () => void;
  listings: Listing[];
  cards: Record<string, CardInfo>;
  decksById: Record<string, { id: string; name: string | null }>;
  initialIndex: number;
  isWishlist: boolean;
  onReceive?: (l: Listing) => void; // owner "Got it" on a wishlist card
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [pageWidth, setPageWidth] = useState(Dimensions.get('window').width);
  const [currentIdx, setCurrentIdx] = useState(initialIndex);
  const listRef = useRef<FlatList<Listing>>(null);

  useEffect(() => {
    if (visible) setCurrentIdx(initialIndex);
  }, [visible, initialIndex]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View
        style={styles.modalBackdrop}
        onLayout={(e) => setPageWidth(e.nativeEvent.layout.width)}>
        <Pressable style={styles.closeBtn} onPress={onClose}>
          <Ionicons name="close" size={28} color={colors.textPrimary} />
        </Pressable>

        <FlatList
          ref={listRef}
          data={listings}
          horizontal
          pagingEnabled
          style={styles.modalPagerList}
          showsHorizontalScrollIndicator={false}
          keyExtractor={(l) => l.id}
          initialScrollIndex={initialIndex}
          getItemLayout={(_, index) => ({ length: pageWidth, offset: pageWidth * index, index })}
          onMomentumScrollEnd={(e) => {
            const idx = Math.round(e.nativeEvent.contentOffset.x / pageWidth);
            setCurrentIdx(idx);
          }}
          renderItem={({ item }) => {
            const card = cards[item.card_code];
            return (
              <View style={[styles.pagerPage, { width: pageWidth }]}>
                {card?.image_url_lg || card?.image_url ? (
                  <Image
                    source={{ uri: card.image_url_lg ?? card.image_url! }}
                    style={styles.modalImg}
                    contentFit="contain"
                  />
                ) : (
                  <View style={[styles.modalImg, styles.placeholder]} />
                )}
                <Text style={styles.modalCardName}>{card?.name ?? item.card_code}</Text>
                <Text style={styles.modalCode}>{item.card_code}</Text>
                {isWishlist && item.deck_id && decksById[item.deck_id] ? (
                  <View style={styles.deckOriginPill}>
                    <Text style={styles.deckOriginPillText}>🃏 {decksById[item.deck_id]!.name || 'deck'}</Text>
                  </View>
                ) : null}
                {!isWishlist ? (
                  <>
                    <View style={styles.modalRow}>
                      <Text style={styles.modalLabel}>QUANTITY</Text>
                      <Text style={styles.modalValue}>×{item.quantity}</Text>
                    </View>
                    <View style={styles.modalRow}>
                      <Text style={styles.modalLabel}>LISTING</Text>
                      <Text style={styles.modalValue}>{item.listing_type}</Text>
                    </View>
                  </>
                ) : null}
                {isWishlist && onReceive ? (
                  <Pressable
                    style={({ pressed }) => [styles.gotItBtn, pressed && { opacity: 0.85 }]}
                    onPress={() => onReceive(item)}
                    accessibilityLabel="Mark as collected">
                    <Ionicons name="sparkles" size={16} color={colors.bgPrimary} />
                    <Text style={styles.gotItText}>GOT IT!</Text>
                  </Pressable>
                ) : null}
              </View>
            );
          }}
        />

        <Text style={styles.pagerCount}>
          {currentIdx + 1} / {listings.length}
        </Text>
      </View>
    </Modal>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  loadingWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bgPrimary },
  grid: { padding: 8 },

  // "For deck" filter bar (owner wishlist) + deck-origin pills
  deckFilterBar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingVertical: 8 },
  deckFilterLabel: {
    color: colors.textMuted,
    fontFamily: fonts.body,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  deckFilterPills: { gap: 6, paddingRight: 12 },
  dfPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgCard,
  },
  dfPillActive: { backgroundColor: '#4d9de0', borderColor: '#4d9de0' },
  dfPillText: { color: colors.textSecondary, fontFamily: fonts.body, fontSize: 12 },
  dfPillTextActive: { color: '#0c0a12', fontFamily: fonts.bodyBold },
  deckTileBadge: {
    position: 'absolute',
    top: 2,
    right: 2,
    backgroundColor: 'rgba(77,157,224,0.92)',
    borderRadius: 999,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  deckTileBadgeText: { fontSize: 10 },
  deckOriginPill: {
    alignSelf: 'center',
    marginTop: 8,
    backgroundColor: 'rgba(77,157,224,0.18)',
    borderColor: '#4d9de0',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  deckOriginPillText: { color: '#9cc7ee', fontFamily: fonts.bodyBold, fontSize: 12 },
  header: { paddingHorizontal: 12, paddingTop: 12, paddingBottom: 6 },
  title: { fontSize: 22, fontFamily: fonts.serifBold, color: colors.textPrimary, letterSpacing: 1 },
  titleOwner: { fontSize: 18, color: colors.textSecondary, fontFamily: fonts.body },
  sub: { color: colors.textMuted, marginTop: 4, fontFamily: fonts.body, letterSpacing: 1 },
  headerPills: { flexDirection: 'row', gap: 6, marginTop: 8 },
  cell: { padding: 4, alignItems: 'center' },
  cellPressed: { opacity: 0.7 },
  cardImg: { width: '100%', aspectRatio: 0.72, borderRadius: radius.sm, backgroundColor: colors.bgCard },
  placeholder: { borderWidth: 1, borderColor: colors.border },
  cardCode: { fontSize: 11, marginTop: 4, fontFamily: fonts.serifBold, color: colors.textPrimary, letterSpacing: 1 },
  cardMeta: { fontSize: 10, color: colors.textMuted, fontFamily: fonts.body },
  empty: { textAlign: 'center', marginTop: 48, color: colors.textMuted, fontFamily: fonts.body },

  enterEditBtn: {
    alignSelf: 'flex-end',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginRight: 12,
    marginBottom: 4,
    borderRadius: radius.sm,
    backgroundColor: colors.accent,
  },
  enterEditBtnText: { color: colors.onAccent, fontFamily: fonts.serifBold, fontSize: 12, letterSpacing: 2 },
  doneBtnText: { color: colors.accent, fontFamily: fonts.serifBold, fontSize: 13, letterSpacing: 2 },

  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.bgSecondary,
  },
  toolbarIconBtn: {
    paddingHorizontal: 8,
    paddingVertical: 7,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgCard,
  },
  toolbarBtnActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  toolbarBtnPrimary: {
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: radius.sm,
    backgroundColor: colors.accent,
    marginLeft: 'auto',
    justifyContent: 'center',
    alignItems: 'center',
  },

  sortPicker: {
    paddingVertical: 8,
    backgroundColor: colors.bgSecondary,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  sortChip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgCard,
  },
  sortChipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  sortChipText: {
    color: colors.textSecondary,
    fontFamily: fonts.body,
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: 1,
    includeFontPadding: false,
  },
  sortChipTextActive: { color: colors.onAccent, fontFamily: fonts.serifBold },

  pagination: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.bgSecondary,
  },
  pageBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgCard,
  },
  pageBtnDisabled: { opacity: 0.4 },
  pageLabel: { color: colors.textPrimary, fontFamily: fonts.body, fontSize: 13 },

  binderPage: { flex: 1, padding: 6, justifyContent: 'flex-start', alignItems: 'center' },
  binderPageGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-start',
    alignItems: 'flex-start',
  },
  binderPageCell: { padding: 3, alignItems: 'center' },
  emptySlot: { opacity: 0.25 },

  dragCell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgPrimary,
  },
  dragImg: { width: 60, aspectRatio: 0.72, borderRadius: radius.sm, backgroundColor: colors.bgCard },
  dragInfo: { flex: 1 },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.95)' },
  closeBtn: { position: 'absolute', top: 40, right: 16, zIndex: 10, padding: 8 },
  modalPagerList: { flex: 1 },
  pagerPage: { flex: 1, padding: 24, justifyContent: 'center', alignItems: 'center', gap: 8 },
  modalImg: { width: '90%', aspectRatio: 0.72, borderRadius: radius.sm, backgroundColor: colors.bgCard },
  modalCardName: {
    fontSize: 18,
    fontFamily: fonts.serifBold,
    color: colors.textPrimary,
    letterSpacing: 1,
    textAlign: 'center',
    marginTop: 12,
  },
  modalCode: { fontSize: 13, color: colors.accent, fontFamily: fonts.body, letterSpacing: 2 },
  gotItBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#e0b24d',
    borderRadius: 999,
    paddingHorizontal: 22,
    paddingVertical: 10,
    marginTop: 18,
  },
  gotItText: { color: colors.onAccent, fontFamily: fonts.serifBold, fontSize: 13, letterSpacing: 2 },
  modalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignSelf: 'stretch',
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderTopWidth: 1,
    borderColor: colors.border,
    marginTop: 4,
  },
  modalLabel: { color: colors.textMuted, fontFamily: fonts.serif, letterSpacing: 2, fontSize: 11 },
  modalValue: { color: colors.textPrimary, fontFamily: fonts.body, fontSize: 14 },
  shareBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', padding: 24 },
  shareCard: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderAccent,
    padding: 24,
    alignItems: 'center',
    gap: 14,
  },
  shareCloseBtn: { position: 'absolute', top: 8, right: 8, padding: 8, zIndex: 1 },
  shareTitle: { color: colors.accent, fontFamily: fonts.serifBold, letterSpacing: 3, fontSize: 14 },
  qrWrap: { padding: 16, backgroundColor: colors.textPrimary, borderRadius: radius.sm },
  shareUrl: { color: colors.textMuted, fontFamily: fonts.body, fontSize: 12, textAlign: 'center' },
  shareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: radius.sm,
    backgroundColor: colors.accent,
    alignSelf: 'stretch',
    justifyContent: 'center',
    marginTop: 4,
  },
  shareBtnPressed: { backgroundColor: colors.accentLight },
  shareBtnText: { color: colors.onAccent, fontFamily: fonts.serifBold, letterSpacing: 2, fontSize: 13 },

  pagerCount: {
    position: 'absolute',
    bottom: 24,
    alignSelf: 'center',
    color: colors.textMuted,
    fontFamily: fonts.serif,
    letterSpacing: 3,
    fontSize: 13,
  },

  editCard: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderAccent,
    padding: 24,
    gap: 10,
  },
  editLabel: {
    color: colors.textMuted,
    fontFamily: fonts.serif,
    letterSpacing: 2,
    fontSize: 11,
    marginTop: 8,
  },
  editInput: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgCard,
    borderRadius: radius.sm,
    padding: 12,
    fontSize: 16,
    color: colors.textPrimary,
    fontFamily: fonts.body,
  },
  editPillRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  editPill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgCard,
  },
  editPillActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  editPillText: { color: colors.textSecondary, fontFamily: fonts.body, fontSize: 13, letterSpacing: 1 },
  editPillTextActive: { color: colors.onAccent, fontFamily: fonts.serifBold },
  editSaveDisabled: { opacity: 0.4 },
  manageBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    marginTop: 4,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.borderAccent,
  },
  manageBtnText: { color: colors.accent, fontFamily: fonts.serifBold, letterSpacing: 2, fontSize: 12 },
  deleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    marginTop: 4,
  },
  deleteBtnText: {
    color: colors.danger,
    fontFamily: fonts.serifBold,
    letterSpacing: 2,
    fontSize: 12,
  },

  // Partner management (shared binders)
  partnerSection: { marginTop: 8, marginBottom: 4 },
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
  partnerInviteRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  partnerInput: { flex: 1, marginBottom: 0 },
  partnerInviteBtn: {
    backgroundColor: colors.accent,
    borderRadius: radius.lg,
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  partnerInviteBtnText: { color: colors.onAccent, fontFamily: fonts.bodyBold, fontSize: 13 },
  partnerMsg: { color: colors.textSecondary, fontFamily: fonts.body, fontSize: 12, marginTop: 6 },

  sheetImg: { width: 140, aspectRatio: 0.72, alignSelf: 'center', borderRadius: radius.sm },

  pagerWrap: { flex: 1, backgroundColor: colors.bgPrimary, paddingTop: 48 },
  pagerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  pagerImageRow: { flex: 1, paddingTop: 12 },
  pagerList: { flex: 1 },
  pagerCardPage: { alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 16 },
  pagerCardImg: {
    width: '85%',
    aspectRatio: 0.72,
    borderRadius: radius.sm,
    backgroundColor: colors.bgCard,
  },
  pagerForm: { paddingHorizontal: 16, paddingTop: 12, gap: 8 },
  removeAllSlot: { height: 44, justifyContent: 'center' },
  pagerCountInline: {
    textAlign: 'center',
    color: colors.textMuted,
    fontFamily: fonts.serif,
    letterSpacing: 3,
    fontSize: 12,
    marginTop: 6,
  },
  savedFlash: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 6,
  },
  savedFlashText: {
    color: colors.accent,
    fontFamily: fonts.serifBold,
    letterSpacing: 2,
    fontSize: 11,
    includeFontPadding: false,
  },

  sheetCardName: {
    color: colors.textPrimary,
    fontFamily: fonts.serifBold,
    letterSpacing: 1,
    fontSize: 16,
    textAlign: 'center',
  },
  sheetCode: { color: colors.accent, fontFamily: fonts.body, letterSpacing: 2, fontSize: 12, textAlign: 'center' },

  browserWrap: { flex: 1, backgroundColor: colors.bgPrimary, paddingTop: 48 },
  browserHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  browserTitle: { color: colors.accent, fontFamily: fonts.serifBold, letterSpacing: 3, fontSize: 14 },
  browserInput: {
    marginHorizontal: 16,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgCard,
    borderRadius: radius.sm,
    padding: 12,
    fontSize: 15,
    color: colors.textPrimary,
    fontFamily: fonts.body,
  },

  browserFilterToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgSecondary,
  },
  browserFilterToggleText: {
    color: colors.accent,
    fontFamily: fonts.serif,
    letterSpacing: 2,
    fontSize: 12,
    includeFontPadding: false,
  },
  browserFiltersWrap: { flex: 1, backgroundColor: colors.bgSecondary },
  browserFilters: { padding: 16, gap: 8 },
  browserFilterLabel: {
    color: colors.textMuted,
    fontFamily: fonts.serif,
    letterSpacing: 2,
    fontSize: 11,
    marginTop: 8,
  },
  filterDropdown: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgCard,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 4,
    gap: 4,
  },
  filterDropdownLabel: {
    color: colors.textMuted,
    fontFamily: fonts.serif,
    letterSpacing: 2,
    fontSize: 10,
    includeFontPadding: false,
  },
  filterDropdownValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  filterDropdownValue: {
    flex: 1,
    color: colors.textPrimary,
    fontFamily: fonts.body,
    fontSize: 14,
    lineHeight: 20,
    includeFontPadding: false,
  },
  filterDropdownValueEmpty: { color: colors.textMuted },

  filterSheetCard: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderAccent,
    paddingVertical: 12,
    maxHeight: '70%',
  },
  filterSheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  filterOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  filterOptionActive: { backgroundColor: colors.bgCardHover },
  filterOptionText: { color: colors.textPrimary, fontFamily: fonts.body, fontSize: 15 },
  filterOptionTextActive: { color: colors.accent, fontFamily: fonts.serifBold },
  browserFilterButtons: { flexDirection: 'row', gap: 8, marginTop: 16 },
  applyBtn: {
    flex: 1,
    padding: 12,
    borderRadius: radius.sm,
    backgroundColor: colors.accent,
    alignItems: 'center',
  },
  applyBtnText: {
    color: colors.onAccent,
    fontFamily: fonts.serifBold,
    letterSpacing: 2,
    fontSize: 13,
  },
  clearBtn: {
    flex: 1,
    padding: 12,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.borderAccent,
    alignItems: 'center',
  },
  clearBtnText: {
    color: colors.accent,
    fontFamily: fonts.serifBold,
    letterSpacing: 2,
    fontSize: 13,
  },

  deckWishOverlayWrap: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deckWishOverlay: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: colors.accent,
    backgroundColor: 'rgba(0,0,0,0.78)',
  },
  deckWishOverlayText: {
    color: colors.accent,
    fontFamily: fonts.serifBold,
    fontSize: 14,
    letterSpacing: 3,
    includeFontPadding: false,
  },
  wishToastWrap: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 5,
  },
  wishToastPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: colors.accent,
    backgroundColor: 'rgba(0,0,0,0.78)',
  },
  wishToastText: {
    color: colors.accent,
    fontFamily: fonts.serifBold,
    fontSize: 13,
    letterSpacing: 2,
    includeFontPadding: false,
  },
});
