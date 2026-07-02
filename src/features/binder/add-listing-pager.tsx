import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { type WishlistResult } from '@/lib/wishlist';
import { LISTING_TYPES, type ListingType } from '@/lib/binder-constants';
import { supabase } from '@/lib/supabase';
import { fonts, radius, type Palette } from '@/lib/theme';
import { useTheme } from '@/lib/theme-context';
import { makeSharedStyles } from './styles';
import { SwipeableDeckPage } from './swipeable-deck-page';
import { type CardInfo } from './types';

export type AddListingPagerProps = {
  cards: CardInfo[] | null;
  index: number;
  onIndexChange: (i: number) => void;
  binderId: string | null;
  onClose: () => void;
  onSave: (card: CardInfo, qty: number, ltype: ListingType) => Promise<void>;
  onRemoveAll: (cardCode: string) => Promise<void>;
  onAddToWishlist: ((card: CardInfo) => Promise<WishlistResult>) | null;
  isWishlist: boolean;
};

export function AddListingPager({
  cards,
  index,
  onIndexChange,
  binderId,
  onClose,
  onSave,
  onRemoveAll,
  onAddToWishlist,
  isWishlist,
}: AddListingPagerProps) {
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

const makeStyles = (colors: Palette) => ({
  ...makeSharedStyles(colors),
  ...StyleSheet.create({
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
  }),
});
