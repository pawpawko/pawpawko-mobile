import { Cinzel_500Medium, Cinzel_700Bold, useFonts as useCinzel } from '@expo-google-fonts/cinzel';
import { Lora_400Regular, Lora_400Regular_Italic, Lora_700Bold, useFonts as useLora } from '@expo-google-fonts/lora';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { View, type TextStyle } from 'react-native';

import { DiceLoader } from '@/components/dice-loader';
import { AuthProvider, useAuth } from '@/lib/auth';
import { AutoSearchProvider } from '@/lib/auto-search-context';
import { ConnectivityProvider } from '@/lib/connectivity';
import { NotificationsProvider } from '@/lib/notifications-context';
import { SyncProvider } from '@/lib/sync-queue';
import { colors } from '@/lib/theme';
import { ThemeProvider, useTheme } from '@/lib/theme-context';

function AuthGate() {
  const { session, loading, needsSetup } = useAuth();
  const { colors, theme } = useTheme();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    const inAuthGroup = segments[0] === 'sign-in';
    // segments is ['(tabs)', 'profile'] when the profile tab is focused.
    const onProfileTab = segments[0] === '(tabs)' && segments[1] === 'profile';

    if (!session && !inAuthGroup) {
      router.replace('/sign-in');
      return;
    }
    if (session && inAuthGroup) {
      router.replace('/trades');
      return;
    }
    // Profile setup gate: a signed-in user without display_name_set must
    // land on the profile tab (which already shows the setup banner) until
    // they save a real display name. Mirrors the web enforceProfileSetup.
    if (session && needsSetup === true && !onProfileTab) {
      router.replace('/profile');
    }
  }, [session, loading, needsSetup, segments]);

  // Hold on the loader until the profile-setup status has resolved too,
  // otherwise a signed-in user briefly lands on /trades before AuthGate
  // can bounce them to /profile when needsSetup turns true.
  if (loading || (session && needsSetup === null)) {
    return (
      <>
        <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bgPrimary }}>
          <DiceLoader />
        </View>
      </>
    );
  }

  return (
    <>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bgPrimary },
      }}>
      <Stack.Screen name="sign-in" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen
        name="binder/[id]"
        options={{
          headerShown: true,
          title: 'Binder',
          headerStyle: { backgroundColor: colors.bgSecondary },
          headerTintColor: colors.textPrimary,
          headerTitleStyle: { fontFamily: 'Cinzel_500Medium' },
        }}
      />
      <Stack.Screen
        name="deck/[id]"
        options={{
          headerShown: true,
          title: 'Deck',
          headerStyle: { backgroundColor: colors.bgSecondary },
          headerTintColor: colors.textPrimary,
          headerTitleStyle: { fontFamily: 'Cinzel_500Medium' },
        }}
      />
      <Stack.Screen name="scan" options={{ presentation: 'modal', animation: 'fade' }} />
      <Stack.Screen
        name="notifications"
        options={{
          presentation: 'modal',
          headerShown: true,
          title: 'NOTIFICATIONS',
          headerStyle: { backgroundColor: colors.bgSecondary },
          headerTintColor: colors.textPrimary,
          headerTitleStyle: { fontFamily: 'Cinzel_700Bold', letterSpacing: 3, fontSize: 14 } as TextStyle,
        }}
      />
      <Stack.Screen
        name="nearby"
        options={{
          presentation: 'modal',
          headerShown: true,
          title: 'NEARBY',
          headerStyle: { backgroundColor: colors.bgSecondary },
          headerTintColor: colors.textPrimary,
          headerTitleStyle: { fontFamily: 'Cinzel_700Bold', letterSpacing: 3, fontSize: 14 } as TextStyle,
        }}
      />
      <Stack.Screen
        name="trade-matches/[partnerId]"
        options={{
          presentation: 'modal',
          headerShown: true,
          title: 'TRADE MATCHES',
          headerStyle: { backgroundColor: colors.bgSecondary },
          headerTintColor: colors.textPrimary,
          headerTitleStyle: { fontFamily: 'Cinzel_700Bold', letterSpacing: 3, fontSize: 14 } as TextStyle,
        }}
      />
      <Stack.Screen
        name="trade-tap"
        options={{
          presentation: 'modal',
          headerShown: true,
          title: 'TRADE TAP',
          headerStyle: { backgroundColor: colors.bgSecondary },
          headerTintColor: colors.textPrimary,
          headerTitleStyle: { fontFamily: 'Cinzel_700Bold', letterSpacing: 3, fontSize: 14 } as TextStyle,
        }}
      />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  const [cinzelLoaded] = useCinzel({ Cinzel_500Medium, Cinzel_700Bold });
  const [loraLoaded] = useLora({ Lora_400Regular, Lora_400Regular_Italic, Lora_700Bold });

  if (!cinzelLoaded || !loraLoaded) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bgPrimary }}>
        <DiceLoader />
      </View>
    );
  }

  return (
    <ThemeProvider>
      <ConnectivityProvider>
        <AuthProvider>
          <SyncProvider>
            <AutoSearchProvider>
              <NotificationsProvider>
                <AuthGate />
              </NotificationsProvider>
            </AutoSearchProvider>
          </SyncProvider>
        </AuthProvider>
      </ConnectivityProvider>
    </ThemeProvider>
  );
}
