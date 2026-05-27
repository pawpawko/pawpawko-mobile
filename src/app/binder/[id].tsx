import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
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
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import QRCode from 'react-native-qrcode-svg';

import { FlairPill } from '@/components/flair-pill';
import { useAuth } from '@/lib/auth';
import {
  COLOR_ORDER,
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
  SORT_MODES_OPTCG,
  SORT_MODES_POKEMON,
  type Layout,
  type ListingType,
  type SortMode,
} from '@/lib/binder-constants';
import { binderShareUrl } from '@/lib/slug';
import { supabase } from '@/lib/supabase';
import { colors, fonts, radius } from '@/lib/theme';

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
  release_order?: number | null;
};

export default function BinderDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const router = useRouter();

  const [header, setHeader] = useState<BinderHeader | null>(null);
  const [listings, setListings] = useState<Listing[]>([]);
  const [cards, setCards] = useState<Record<string, CardInfo>>({});
  const [loading, setLoading] = useState(true);

  const [isOwner, setIsOwner] = useState(false);
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

  // Existing
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [shareOpen, setShareOpen] = useState(false);

  const shareUrl = id && header ? binderShareUrl(header.display_name, header.binder_name, id) : '';
  const pageSize = PAGE_SIZE[layout];

  // ---- Ownership check ----
  useEffect(() => {
    if (!id || !session?.user.id) {
      setIsOwner(false);
      return;
    }
    supabase
      .from('binders')
      .select('user_id,layout')
      .eq('id', id)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.user_id === session.user.id) {
          setIsOwner(true);
          if (data.layout === '3x3' || data.layout === '4x3') {
            setLayout(data.layout);
            setSortMode(data.layout === '3x3' ? 'custom-3x3' : 'custom-4x3');
          }
        }
      });
  }, [id, session?.user.id]);

  // ---- Initial load ----
  const loadAll = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const [hRes, lRes] = await Promise.all([
      supabase.rpc('get_binder_public', { p_binder_id: id }),
      isOwner
        ? supabase
            .from('listings')
            .select('id, quantity, listing_type, card_code, sort_order')
            .eq('binder_id', id)
            .order('sort_order', { ascending: true, nullsFirst: false })
            .order('created_at', { ascending: false })
        : supabase.rpc('get_binder_listings_public', { p_binder_id: id }),
    ]);
    if (hRes.error) console.warn('header', hRes.error.message);
    if (lRes.error) console.warn('listings', lRes.error.message);

    const head: BinderHeader | null = Array.isArray(hRes.data) ? hRes.data[0] : hRes.data;
    const lst: Listing[] = (lRes.data ?? []) as Listing[];
    setHeader(head);
    setListings(lst);

    if (head && lst.length > 0) {
      const codes = Array.from(new Set(lst.map((l) => l.card_code)));
      const { data: cardRows, error: cErr } = await supabase
        .from('cards')
        .select('card_code,name,image_url,image_url_lg,color,cost,types,supertype,hp,release_order')
        .eq('game', head.category)
        .in('card_code', codes);
      if (cErr) console.warn('cards', cErr.message);
      const map: Record<string, CardInfo> = {};
      (cardRows ?? []).forEach((c: CardInfo) => {
        map[c.card_code] = c;
      });
      setCards(map);
    }
    setLoading(false);
  }, [id, isOwner]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // ---- Sort listings according to active sortMode ----
  const sortedListings = applySortMode(listings, cards, sortMode);

  // Reset page if it overflows the new total
  useEffect(() => {
    const totalPages = Math.max(1, Math.ceil(sortedListings.length / pageSize));
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [sortedListings.length, pageSize, currentPage]);

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
    if (!id) return;
    const { error } = await supabase.from('binders').update({ layout: next }).eq('id', id);
    if (error) console.warn('layout save failed:', error.message);
  }

  async function addListing(card: CardInfo, qty: number, ltype: ListingType) {
    if (!id) return false;
    const { data, error } = await supabase
      .from('listings')
      .insert({ binder_id: id, card_code: card.card_code, quantity: qty, listing_type: ltype })
      .select('id, quantity, listing_type, card_code, sort_order')
      .single();
    if (error) {
      Alert.alert('Could not add listing', error.message);
      return false;
    }
    setListings((ls) => [...ls, data as Listing]);
    // Ensure card metadata is in the lookup
    setCards((map) => (map[card.card_code] ? map : { ...map, [card.card_code]: card }));
    return true;
  }

  async function updateListing(listingId: string, qty: number, ltype: ListingType) {
    const { error } = await supabase
      .from('listings')
      .update({ quantity: qty, listing_type: ltype })
      .eq('id', listingId);
    if (error) {
      Alert.alert('Could not update listing', error.message);
      return false;
    }
    setListings((ls) =>
      ls.map((l) => (l.id === listingId ? { ...l, quantity: qty, listing_type: ltype } : l)),
    );
    return true;
  }

  async function removeListing(listingId: string) {
    const { error } = await supabase.from('listings').delete().eq('id', listingId);
    if (error) {
      Alert.alert('Could not remove listing', error.message);
      return false;
    }
    setListings((ls) => ls.filter((l) => l.id !== listingId));
    return true;
  }

  async function removeAllForCard(cardCode: string) {
    if (!id) return false;
    const { error } = await supabase
      .from('listings')
      .delete()
      .eq('binder_id', id)
      .eq('card_code', cardCode);
    if (error) {
      Alert.alert('Could not remove listings', error.message);
      return false;
    }
    setListings((ls) => ls.filter((l) => l.card_code !== cardCode));
    return true;
  }

  // Persist a freshly-ordered listings array by writing sort_order = index for each row.
  async function persistPositions(reordered: Listing[]) {
    setListings(reordered.map((l, i) => ({ ...l, sort_order: i })));
    const payload = reordered.map((l, i) => ({
      id: l.id,
      sort_order: i,
      binder_id: id!,
      card_code: l.card_code,
      quantity: l.quantity,
      listing_type: l.listing_type,
    }));
    const { error } = await supabase.from('listings').upsert(payload, { onConflict: 'id' });
    if (error) console.warn('reorder save failed:', error.message);
  }

  if (loading) {
    return (
      <View style={styles.loadingWrap}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }
  if (!header) return <Text style={styles.empty}>Binder not found.</Text>;

  const sortOptions = header.category === 'pokemon' ? SORT_MODES_POKEMON : SORT_MODES_OPTCG;
  const numColumns = layout === '3x3' ? 3 : 4;
  const total = sortedListings.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const pageStart = (currentPage - 1) * pageSize;
  const pageItems = sortedListings.slice(pageStart, pageStart + pageSize);

  const showDraggable = editMode && aestheticsMode && (sortMode === 'custom-3x3' || sortMode === 'custom-4x3');

  return (
    <>
      <Stack.Screen
        options={{
          title: editMode ? 'EDIT BINDER' : 'Binder',
          headerRight: () => (
            <View style={{ flexDirection: 'row' }}>
              {isOwner && !editMode ? (
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
            onOpenSettings={() => setEditOpen(true)}
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

        {total === 0 ? (
          <Text style={styles.empty}>
            {editMode ? 'No cards yet. Tap "Add cards".' : 'No cards in this binder yet.'}
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
              <DraggableTile {...p} cards={cards} numColumns={numColumns} />
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
                <Text style={styles.cardMeta}>×{item.quantity} · {item.listing_type}</Text>
              </Pressable>
            )}
          />
        ) : (
          <BinderPager
            listings={sortedListings}
            cards={cards}
            numColumns={numColumns}
            pageSize={pageSize}
            currentPage={currentPage}
            onPageChange={setCurrentPage}
            onCardPress={(absoluteIdx) => setExpandedIdx(absoluteIdx)}
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
        onClose={() => setAddCards(null)}
        onSave={async (card, qty, type) => {
          // Don't close on save — keep the pager open so the user can
          // continue swiping through the same filter run and add more
          // cards without re-opening the browser.
          await addListing(card, qty, type);
        }}
        onRemoveAll={async (cardCode) => {
          await removeAllForCard(cardCode);
        }}
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
        listings={sortedListings}
        cards={cards}
        initialIndex={expandedIdx ?? 0}
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
    // web app's `order(sort_order, nullsFirst: false)`.
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
  onOpenSettings: () => void;
}) {
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
      <Pressable
        onPress={onOpenSettings}
        style={({ pressed }) => [styles.toolbarIconBtn, pressed && { opacity: 0.7 }]}
        accessibilityLabel="Binder settings">
        <Ionicons name="settings-outline" size={18} color={colors.accent} />
      </Pressable>
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
  numColumns,
  pageSize,
  currentPage,
  onPageChange,
  onCardPress,
}: {
  listings: Listing[];
  cards: Record<string, CardInfo>;
  numColumns: number;
  pageSize: number;
  currentPage: number;
  onPageChange: (p: number) => void;
  onCardPress: (absoluteIdx: number) => void;
}) {
  const [pageWidth, setPageWidth] = useState(Dimensions.get('window').width);
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

  return (
    <FlatList
      ref={listRef as React.RefObject<FlatList<(Listing | null)[]>> as unknown as React.RefObject<FlatList<Listing[]>>}
      data={pages as unknown as Listing[][]}
      keyExtractor={(_, i) => `page-${i}`}
      horizontal
      pagingEnabled
      showsHorizontalScrollIndicator={false}
      onLayout={(e) => setPageWidth(e.nativeEvent.layout.width)}
      getItemLayout={(_, i) => ({ length: pageWidth, offset: pageWidth * i, index: i })}
      onMomentumScrollEnd={(e) => {
        const idx = Math.round(e.nativeEvent.contentOffset.x / pageWidth);
        if (idx + 1 !== currentPage) onPageChange(idx + 1);
      }}
      renderItem={({ item: page, index: pageIndex }) => (
        <View style={[styles.binderPage, { width: pageWidth }]}>
          <View style={[styles.binderPageGrid, { gap: 4 }]}>
            {(page as unknown as (Listing | null)[]).map((l, i) => {
              const cellWidth = `${100 / numColumns}%` as const;
              if (!l) {
                return (
                  <View
                    key={`empty-${pageIndex}-${i}`}
                    style={[styles.binderPageCell, { width: cellWidth }]}>
                    <View style={[styles.cardImg, styles.placeholder, styles.emptySlot]} />
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
                      style={styles.cardImg}
                      contentFit="contain"
                    />
                  ) : (
                    <View style={[styles.cardImg, styles.placeholder]} />
                  )}
                  <Text style={styles.cardCode} numberOfLines={1}>{l.card_code}</Text>
                  <Text style={styles.cardMeta} numberOfLines={1}>
                    ×{l.quantity} · {l.listing_type}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      )}
    />
  );
}

function DraggableTile({
  item,
  drag,
  isActive,
  cards,
  numColumns,
}: RenderItemParams<Listing> & { cards: Record<string, CardInfo>; numColumns: number }) {
  const card = cards[item.card_code];
  return (
    <ScaleDecorator>
      <Pressable
        onLongPress={drag}
        disabled={isActive}
        style={[styles.dragCell, isActive && { opacity: 0.7 }]}>
        {card?.image_url ? (
          <Image source={{ uri: card.image_url }} style={styles.dragImg} contentFit="contain" />
        ) : (
          <View style={[styles.dragImg, styles.placeholder]} />
        )}
        <View style={styles.dragInfo}>
          <Text style={styles.cardCode}>{item.card_code}</Text>
          <Text style={styles.cardMeta}>×{item.quantity} · {item.listing_type}</Text>
        </View>
        <Ionicons name="reorder-three" size={22} color={colors.textMuted} />
      </Pressable>
    </ScaleDecorator>
  );
}

// ---------------- Modals & sheets ----------------

function EditBinderModal({
  visible,
  onClose,
  currentName,
  currentFlair,
  onSaveName,
  onSaveFlair,
  onDelete,
}: {
  visible: boolean;
  onClose: () => void;
  currentName: string;
  currentFlair: Flair;
  onSaveName: (next: string) => Promise<boolean>;
  onSaveFlair: (next: Flair) => Promise<void>;
  onDelete: () => void;
}) {
  const [name, setName] = useState(currentName);
  const [savingName, setSavingName] = useState(false);

  useEffect(() => {
    if (visible) setName(currentName);
  }, [visible, currentName]);

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
      setResults((data ?? []) as CardInfo[]);
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
      : [
          { key: 'series', label: 'Set', options: seriesOptions },
          { key: 'color', label: 'Color', options: OPTCG_COLORS },
          { key: 'type', label: 'Type', options: OPTCG_TYPES },
          { key: 'cost', label: 'Cost', options: OPTCG_COSTS.map(String) },
          { key: 'attribute', label: 'Attribute', options: OPTCG_ATTRIBUTES },
          { key: 'rarity', label: 'Rarity', options: OPTCG_RARITIES },
        ];


  const activeFilterCount = Object.values(filters).filter((v) => v !== '').length;

  // Display helper: collapse separator " - " inside series names (e.g. "OP-01 -
  // Romance Dawn" → "OP-01 Romance Dawn"). Stand-alone hyphens between words
  // also drop. Hyphens embedded in a code (letter-digit or digit-letter) stay.
  function prettyOption(filterKey: keyof BrowserFilters, raw: string): string {
    if (raw === '' || filterKey !== 'series') return raw;
    return raw
      .replace(/\s+-\s+/g, ' ')
      .replace(/([A-Za-z])-([A-Za-z])/g, '$1 $2');
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
          <ActivityIndicator style={{ marginTop: 12 }} color={colors.accent} />
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
  onClose: () => void;
  onSave: (qty: number, type: ListingType) => Promise<void>;
  onDestroy?: () => Promise<void>;
  destroyLabel?: string;
}) {
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
}: {
  cards: CardInfo[] | null;
  index: number;
  onIndexChange: (i: number) => void;
  binderId: string | null;
  onClose: () => void;
  onSave: (card: CardInfo, qty: number, ltype: ListingType) => Promise<void>;
  onRemoveAll: (cardCode: string) => Promise<void>;
}) {
  const [pageWidth, setPageWidth] = useState(Dimensions.get('window').width);
  const [qty, setQty] = useState('1');
  const [ltype, setLtype] = useState<ListingType>('trade');
  const [busy, setBusy] = useState(false);
  const [existingCount, setExistingCount] = useState<number | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const listRef = useRef<FlatList<CardInfo>>(null);
  const visible = cards !== null && cards.length > 0;
  const currentCard = visible ? cards[index] : null;

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

  async function commit() {
    if (!currentCard) return;
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
    if (binderId) {
      const { count } = await supabase
        .from('listings')
        .select('id', { count: 'exact', head: true })
        .eq('binder_id', binderId)
        .eq('card_code', currentCard.card_code);
      setExistingCount(count ?? 0);
    }
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
      <View
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
              <FlatList
                ref={listRef}
                data={cards}
                horizontal
                pagingEnabled
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
                  <View style={[styles.pagerCardPage, { width: pageWidth }]}>
                    {item.image_url ? (
                      <Image
                        source={{ uri: item.image_url_lg ?? item.image_url }}
                        style={styles.pagerCardImg}
                        contentFit="contain"
                      />
                    ) : (
                      <View style={[styles.pagerCardImg, styles.placeholder]} />
                    )}
                    <Text style={styles.sheetCardName} numberOfLines={1}>{item.name ?? item.card_code}</Text>
                    <Text style={styles.sheetCode}>{item.card_code}</Text>
                  </View>
                )}
              />
              <Text style={styles.pagerCountInline}>
                {index + 1} / {cards.length}
              </Text>
            </View>

            <View style={styles.pagerForm}>
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
                {busy ? (
                  <ActivityIndicator color={colors.bgPrimary} />
                ) : (
                  <Text style={styles.shareBtnText}>SAVE</Text>
                )}
              </Pressable>

              {savedFlash ? (
                <View style={styles.savedFlash}>
                  <Ionicons name="checkmark-circle" size={16} color={colors.accent} />
                  <Text style={styles.savedFlashText}>Saved — swipe for more</Text>
                </View>
              ) : null}

              {existingCount && existingCount > 0 ? (
                <Pressable
                  style={({ pressed }) => [styles.deleteBtn, pressed && { opacity: 0.7 }]}
                  onPress={confirmRemoveAll}>
                  <Ionicons name="trash-outline" size={16} color={colors.danger} />
                  <Text style={styles.deleteBtnText}>
                    REMOVE ALL ({existingCount})
                  </Text>
                </Pressable>
              ) : null}
            </View>
          </>
        ) : null}
      </View>
    </Modal>
  );
}

function EditListingSheet({
  listing,
  card,
  onClose,
  onSave,
  onRemove,
}: {
  listing: Listing | null;
  card: CardInfo | undefined;
  onClose: () => void;
  onSave: (l: Listing, qty: number, ltype: ListingType) => Promise<void>;
  onRemove: (l: Listing) => Promise<void>;
}) {
  if (!listing) return null;
  return (
    <ListingFormSheet
      visible={!!listing}
      title="EDIT LISTING"
      card={card}
      initialQty={listing.quantity}
      initialType={listing.listing_type as ListingType}
      onClose={onClose}
      onSave={async (qty, ltype) => {
        await onSave(listing, qty, ltype);
      }}
      onDestroy={async () => {
        Alert.alert('Remove this listing?', '', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Remove', style: 'destructive', onPress: () => onRemove(listing) },
        ]);
      }}
      destroyLabel="REMOVE LISTING"
    />
  );
}

function CardPagerModal({
  visible,
  onClose,
  listings,
  cards,
  initialIndex,
}: {
  visible: boolean;
  onClose: () => void;
  listings: Listing[];
  cards: Record<string, CardInfo>;
  initialIndex: number;
}) {
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
                <View style={styles.modalRow}>
                  <Text style={styles.modalLabel}>QUANTITY</Text>
                  <Text style={styles.modalValue}>×{item.quantity}</Text>
                </View>
                <View style={styles.modalRow}>
                  <Text style={styles.modalLabel}>LISTING</Text>
                  <Text style={styles.modalValue}>{item.listing_type}</Text>
                </View>
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

const styles = StyleSheet.create({
  loadingWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bgPrimary },
  grid: { padding: 8 },
  header: { padding: 12 },
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
  enterEditBtnText: { color: colors.bgPrimary, fontFamily: fonts.serifBold, fontSize: 12, letterSpacing: 2 },
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
  sortChipTextActive: { color: colors.bgPrimary, fontFamily: fonts.serifBold },

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

  binderPage: { paddingHorizontal: 8, paddingTop: 8 },
  binderPageGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  binderPageCell: { padding: 4, alignItems: 'center' },
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
  pagerPage: { padding: 24, paddingTop: 80, alignItems: 'center', gap: 8 },
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
  shareBtnText: { color: colors.bgPrimary, fontFamily: fonts.serifBold, letterSpacing: 2, fontSize: 13 },

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
  editPillTextActive: { color: colors.bgPrimary, fontFamily: fonts.serifBold },
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
  pagerImageRow: { paddingTop: 12 },
  pagerCardPage: { alignItems: 'center', gap: 6, paddingHorizontal: 16 },
  pagerCardImg: {
    width: '85%',
    aspectRatio: 0.72,
    borderRadius: radius.sm,
    backgroundColor: colors.bgCard,
  },
  pagerForm: { paddingHorizontal: 16, paddingTop: 12, gap: 8 },
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
    color: colors.bgPrimary,
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
});
