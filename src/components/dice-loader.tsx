import { Ionicons } from '@expo/vector-icons';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { colors } from '@/lib/theme';

const FACES: React.ComponentProps<typeof Ionicons>['name'][] = [
  'dice-outline',
  'dice',
];

export function DiceLoader({ size = 56, color = colors.accent }: { size?: number; color?: string }) {
  const rotation = useSharedValue(0);
  const scale = useSharedValue(1);
  const face = useSharedValue(0);

  useEffect(() => {
    rotation.value = withRepeat(
      withTiming(360, { duration: 700, easing: Easing.bezier(0.4, 0, 0.2, 1) }),
      -1,
      false,
    );
    scale.value = withRepeat(
      withSequence(
        withTiming(1.15, { duration: 350, easing: Easing.out(Easing.quad) }),
        withTiming(1, { duration: 350, easing: Easing.in(Easing.quad) }),
      ),
      -1,
      false,
    );
    const interval = setInterval(() => {
      face.value = (face.value + 1) % FACES.length;
    }, 350);
    return () => clearInterval(interval);
  }, []);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }, { scale: scale.value }],
  }));

  return (
    <View style={[styles.wrap, { width: size + 16, height: size + 16 }]}>
      <Animated.View style={animStyle}>
        <Ionicons name={FACES[Math.floor(face.value) % FACES.length]} size={size} color={color} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { justifyContent: 'center', alignItems: 'center' },
});
