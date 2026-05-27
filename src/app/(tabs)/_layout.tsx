import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Tabs, useRouter } from 'expo-router';
import { Pressable, View } from 'react-native';

import { colors, fonts } from '@/lib/theme';

const HeaderLogo = () => (
  <View style={{ paddingLeft: 12 }}>
    <View
      style={{
        width: 44,
        height: 44,
        borderRadius: 22,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: colors.accentLight,
      }}>
      <Image
        source={require('../../../assets/images/jolly.png')}
        style={{ width: 36, height: 36 }}
        contentFit="contain"
      />
    </View>
  </View>
);

export default function TabsLayout() {
  const router = useRouter();
  return (
    <Tabs
      screenOptions={{
        headerShown: true,
        headerStyle: { backgroundColor: colors.bgSecondary },
        headerTintColor: colors.textPrimary,
        headerTitleStyle: { fontFamily: fonts.serif, letterSpacing: 2 },
        headerLeft: () => <HeaderLogo />,
        tabBarStyle: { backgroundColor: colors.bgSecondary, borderTopColor: colors.border },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarLabelStyle: { fontFamily: fonts.body, fontSize: 11, letterSpacing: 1 },
        sceneStyle: { backgroundColor: colors.bgPrimary },
      }}>
      <Tabs.Screen
        name="trades"
        options={{
          title: 'TRADES',
          tabBarIcon: ({ color, size }) => <Ionicons name="search" size={size} color={color} />,
          headerRight: () => (
            <Pressable
              onPress={() => router.push('/scan')}
              style={({ pressed }) => ({ padding: 10, opacity: pressed ? 0.6 : 1 })}
              accessibilityLabel="Open camera scanner">
              <Ionicons name="camera-outline" size={24} color={colors.accent} />
            </Pressable>
          ),
        }}
      />
      <Tabs.Screen
        name="my-binders"
        options={{
          title: 'MY BINDERS',
          tabBarIcon: ({ color, size }) => <Ionicons name="albums-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'PROFILE',
          tabBarIcon: ({ color, size }) => <Ionicons name="person-circle-outline" size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
