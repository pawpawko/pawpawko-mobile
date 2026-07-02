import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import DraggableFlatList from 'react-native-draggable-flatlist';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import QRCode from 'react-native-qrcode-svg';

import { DiceLoader } from '@/components/dice-loader';
import { FlairPill } from '@/components/flair-pill';
import { SyncStatusBar } from '@/components/sync-status';
import { AddListingPager } from '@/features/binder/add-listing-pager';
import { BinderPager } from '@/features/binder/binder-pager';
import { CardBrowserModal } from '@/features/binder/card-browser-modal';
import { CardPagerModal } from '@/features/binder/card-pager-modal';
import { DraggableTile } from '@/features/binder/draggable-tile';
import { EditBinderModal } from '@/features/binder/edit-binder-modal';
import { EditListingSheet } from '@/features/binder/edit-listing-sheet';
import { EditToolbar } from '@/features/binder/edit-toolbar';
import { Pagination } from '@/features/binder/pagination';
import { applySortMode } from '@/features/binder/sort';
import { SortPicker } from '@/features/binder/sort-picker';
import { makeSharedStyles } from '@/features/binder/styles';
import { type CardInfo, type Flair, type Listing } from '@/features/binder/types';
import { useAuth } from '@/lib/auth';
import { addCardToWishlist } from '@/lib/wishlist';
import {
  PAGE_SIZE,
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

type BinderHeader = {
  id: string;
  binder_name: string | null;
  binder_description: string | null;
  display_name: string | null;
  category: string;
  flair: string;
  layout?: Layout | null;
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
    // Layout is an owner-only binder setting — RLS blocks the write for
    // collaborators, so bail before touching local view state or the DB.
    if (!isOwner) return;
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

const makeStyles = (colors: Palette) => ({
  ...makeSharedStyles(colors),
  ...StyleSheet.create({
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
    header: { paddingHorizontal: 12, paddingTop: 12, paddingBottom: 6 },
    title: { fontSize: 22, fontFamily: fonts.serifBold, color: colors.textPrimary, letterSpacing: 1 },
    titleOwner: { fontSize: 18, color: colors.textSecondary, fontFamily: fonts.body },
    headerPills: { flexDirection: 'row', gap: 6, marginTop: 8 },

    doneBtnText: { color: colors.accent, fontFamily: fonts.serifBold, fontSize: 13, letterSpacing: 2 },
    shareCard: {
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.borderAccent,
      padding: 24,
      alignItems: 'center',
      gap: 14,
    },
    qrWrap: { padding: 16, backgroundColor: colors.textPrimary, borderRadius: radius.sm },
    shareUrl: { color: colors.textMuted, fontFamily: fonts.body, fontSize: 12, textAlign: 'center' },
  }),
});
