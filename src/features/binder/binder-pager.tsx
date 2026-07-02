import { Image } from 'expo-image';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Dimensions, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { radius, type Palette } from '@/lib/theme';
import { useTheme } from '@/lib/theme-context';
import { makeSharedStyles } from './styles';
import { type CardInfo, type Listing } from './types';

export type BinderPagerProps = {
  listings: Listing[];
  cards: Record<string, CardInfo>;
  decksById: Record<string, { id: string; name: string | null }>;
  numColumns: number;
  pageSize: number;
  currentPage: number;
  onPageChange: (p: number) => void;
  onCardPress: (absoluteIdx: number) => void;
  isWishlist: boolean;
};

export function BinderPager({
  listings,
  cards,
  decksById,
  numColumns,
  pageSize,
  currentPage,
  onPageChange,
  onCardPress,
  isWishlist,
}: BinderPagerProps) {
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

const makeStyles = (colors: Palette) => ({
  ...makeSharedStyles(colors),
  ...StyleSheet.create({
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

    binderPage: { flex: 1, padding: 6, justifyContent: 'flex-start', alignItems: 'center' },
    binderPageGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'flex-start',
      alignItems: 'flex-start',
    },
    binderPageCell: { padding: 3, alignItems: 'center' },
    emptySlot: { opacity: 0.25 },
  }),
});
