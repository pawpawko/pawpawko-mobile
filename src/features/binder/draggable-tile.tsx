import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ScaleDecorator, type RenderItemParams } from 'react-native-draggable-flatlist';

import { radius, type Palette } from '@/lib/theme';
import { useTheme } from '@/lib/theme-context';
import { makeSharedStyles } from './styles';
import { type CardInfo, type Listing } from './types';

export type DraggableTileProps = RenderItemParams<Listing> & {
  cards: Record<string, CardInfo>;
  numColumns: number;
  isWishlist: boolean;
};

export function DraggableTile({
  item,
  drag,
  isActive,
  cards,
  numColumns,
  isWishlist,
}: DraggableTileProps) {
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

const makeStyles = (colors: Palette) => ({
  ...makeSharedStyles(colors),
  ...StyleSheet.create({
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
  }),
});
