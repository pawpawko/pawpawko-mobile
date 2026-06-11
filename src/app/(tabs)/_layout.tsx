import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Tabs, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AutoSearchSheet } from '@/components/auto-search-sheet';
import { useAutoSearch } from '@/lib/auto-search-context';
import { colors, fonts } from '@/lib/theme';

// Visible header chrome (below the status bar) is HEADER_CONTENT_H tall.
// HEADER_TITLE_PAD_BOTTOM is the breathing space between the Jolly and the
// header's bottom edge.
const HEADER_CONTENT_H = 96;
const HEADER_TITLE_PAD_BOTTOM = 4;

function HeaderJollyButton({ onPress }: { onPress: () => void }) {
  const { active } = useAutoSearch();
  const pulse = useSharedValue(0);

  useEffect(() => {
    if (active) {
      pulse.value = 0;
      pulse.value = withRepeat(
        withTiming(1, { duration: 1600, easing: Easing.out(Easing.quad) }),
        -1,
        false,
      );
    } else {
      cancelAnimation(pulse);
      pulse.value = withTiming(0, { duration: 150 });
    }
  }, [active, pulse]);

  const ringStyle = useAnimatedStyle(() => ({
    opacity: 0.55 * (1 - pulse.value),
    transform: [{ scale: 1 + pulse.value * 0.6 }],
  }));

  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={active ? 'Auto-Search active — open sheet' : 'Open Auto-Search'}
      style={({ pressed }) => ({
        width: 72,
        height: 72,
        justifyContent: 'center',
        alignItems: 'center',
        opacity: pressed ? 0.7 : 1,
      })}>
      {active ? (
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: 'absolute',
              width: 56,
              height: 56,
              borderRadius: 28,
              borderWidth: 2,
              borderColor: colors.accent,
            },
            ringStyle,
          ]}
        />
      ) : null}
      <View
        style={{
          width: 56,
          height: 56,
          borderRadius: 28,
          justifyContent: 'center',
          alignItems: 'center',
          backgroundColor: colors.accentLight,
        }}>
        <Image
          source={require('../../../assets/images/jolly.png')}
          style={{ width: 48, height: 48 }}
          contentFit="contain"
        />
      </View>
    </Pressable>
  );
}

export default function TabsLayout() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [sheetOpen, setSheetOpen] = useState(false);
  return (
    <>
      <Tabs
        screenOptions={{
          headerShown: true,
          // Total = status-bar inset + visible chrome. headerStatusBarHeight
          // tells RN to reserve the inset so the title sits below it cleanly.
          headerStyle: {
            backgroundColor: colors.bgSecondary,
            height: HEADER_CONTENT_H + insets.top,
          },
          headerStatusBarHeight: insets.top,
          headerTintColor: colors.textPrimary,
          headerTitle: () => <HeaderJollyButton onPress={() => setSheetOpen(true)} />,
          headerTitleAlign: 'center',
          headerTitleContainerStyle: { paddingBottom: HEADER_TITLE_PAD_BOTTOM },
          headerRightContainerStyle: { paddingRight: 0 },
          tabBarStyle: { backgroundColor: colors.bgSecondary, borderTopColor: colors.border },
          tabBarActiveTintColor: colors.accent,
          tabBarInactiveTintColor: colors.textMuted,
          tabBarLabelStyle: { fontFamily: fonts.body, fontSize: 11, letterSpacing: 1 },
          sceneStyle: { backgroundColor: colors.bgPrimary },
        }}>
        <Tabs.Screen
          name="trades"
          options={{
            title: '',
            tabBarIcon: ({ color, size }) => <Ionicons name="search" size={size} color={color} />,
            headerRight: () => (
              <Pressable
                onPress={() => router.push('/scan')}
                style={({ pressed }) => ({
                  paddingLeft: 16,
                  paddingRight: 14,
                  paddingVertical: 10,
                  opacity: pressed ? 0.6 : 1,
                })}
                accessibilityLabel="Open camera scanner">
                <Ionicons name="camera-outline" size={24} color={colors.accent} />
              </Pressable>
            ),
          }}
        />
        <Tabs.Screen
          name="my-binders"
          options={{
            title: '',
            tabBarIcon: ({ color, size }) => <Ionicons name="albums-outline" size={size} color={color} />,
          }}
        />
        <Tabs.Screen
          name="profile"
          options={{
            title: '',
            tabBarIcon: ({ color, size }) => <Ionicons name="person-circle-outline" size={size} color={color} />,
          }}
        />
      </Tabs>
      <AutoSearchSheet visible={sheetOpen} onClose={() => setSheetOpen(false)} />
    </>
  );
}
