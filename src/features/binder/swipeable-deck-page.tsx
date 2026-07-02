import { Image } from 'expo-image';
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  interpolate,
  interpolateColor,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { fonts, radius, type Palette } from '@/lib/theme';
import { useTheme } from '@/lib/theme-context';
import { makeSharedStyles } from './styles';
import { type CardInfo } from './types';

export type SwipeableDeckPageProps = {
  card: CardInfo;
  pageWidth: number;
  onAddToWishlist: (() => void) | null;
  listGesture: ReturnType<typeof Gesture.Native>;
};

export function SwipeableDeckPage({
  card,
  pageWidth,
  onAddToWishlist,
  listGesture,
}: SwipeableDeckPageProps) {
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

const makeStyles = (colors: Palette) => ({
  ...makeSharedStyles(colors),
  ...StyleSheet.create({
    pagerCardPage: { alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 16 },
    pagerCardImg: {
      width: '85%',
      aspectRatio: 0.72,
      borderRadius: radius.sm,
      backgroundColor: colors.bgCard,
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
  }),
});
