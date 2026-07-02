import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Dimensions, FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { fonts, radius, type Palette } from '@/lib/theme';
import { useTheme } from '@/lib/theme-context';
import { makeSharedStyles } from './styles';
import { type CardInfo, type Listing } from './types';

export type CardPagerModalProps = {
  visible: boolean;
  onClose: () => void;
  listings: Listing[];
  cards: Record<string, CardInfo>;
  decksById: Record<string, { id: string; name: string | null }>;
  initialIndex: number;
  isWishlist: boolean;
  onReceive?: (l: Listing) => void; // owner "Got it" on a wishlist card
};

export function CardPagerModal({
  visible,
  onClose,
  listings,
  cards,
  decksById,
  initialIndex,
  isWishlist,
  onReceive,
}: CardPagerModalProps) {
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

const makeStyles = (colors: Palette) => ({
  ...makeSharedStyles(colors),
  ...StyleSheet.create({
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

    pagerCount: {
      position: 'absolute',
      bottom: 24,
      alignSelf: 'center',
      color: colors.textMuted,
      fontFamily: fonts.serif,
      letterSpacing: 3,
      fontSize: 13,
    },
  }),
});
