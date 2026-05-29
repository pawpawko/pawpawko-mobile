import { Image } from 'expo-image';
import { useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { signInWithDiscord } from '@/lib/discord-auth';
import { signInWithGoogle } from '@/lib/google-auth';
import { supabase } from '@/lib/supabase';
import { colors, fonts, radius } from '@/lib/theme';

function GoogleIcon() {
  return (
    <Svg viewBox="0 0 24 24" width={26} height={26}>
      <Path
        fill="#EA4335"
        d="M12 10.2v3.92h5.45c-.24 1.42-1.7 4.16-5.45 4.16-3.28 0-5.96-2.72-5.96-6.08s2.68-6.08 5.96-6.08c1.87 0 3.12.8 3.84 1.48l2.62-2.52C16.78 3.6 14.6 2.6 12 2.6 6.92 2.6 2.8 6.72 2.8 11.8s4.12 9.2 9.2 9.2c5.32 0 8.84-3.74 8.84-9 0-.6-.06-1.06-.16-1.52H12z"
      />
    </Svg>
  );
}

function DiscordIcon() {
  return (
    <Svg viewBox="0 0 24 24" width={26} height={26}>
      <Path
        fill="#ffffff"
        d="M20.317 4.369A19.79 19.79 0 0 0 16.558 3.2a.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.249a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.249.077.077 0 0 0-.079-.037 19.736 19.736 0 0 0-3.76 1.17.07.07 0 0 0-.032.027C2.533 8.045 1.78 11.616 2.146 15.146a.082.082 0 0 0 .031.056 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.2 14.2 0 0 0 1.226-1.994.076.076 0 0 0-.041-.105 13.1 13.1 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .077-.01c3.927 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.009c.12.099.246.198.373.292a.077.077 0 0 1-.006.128 12.3 12.3 0 0 1-1.873.891.077.077 0 0 0-.041.106c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-4.083-.838-7.624-3.549-10.75a.06.06 0 0 0-.031-.028zM8.02 12.997c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.418 2.157-2.418 1.21 0 2.176 1.094 2.157 2.418 0 1.334-.956 2.419-2.157 2.419zm7.974 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.418 2.157-2.418 1.21 0 2.176 1.094 2.157 2.418 0 1.334-.946 2.419-2.157 2.419z"
      />
    </Svg>
  );
}

export default function SignInScreen() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [oauthBusy, setOauthBusy] = useState<'google' | 'discord' | null>(null);

  async function googleSubmit() {
    setOauthBusy('google');
    try {
      const result = await signInWithGoogle();
      if (result === 'play-services-unavailable') {
        Alert.alert('Google Play Services unavailable', 'Update Google Play Services and try again.');
      }
    } catch (e: any) {
      Alert.alert('Google sign-in failed', e?.message ?? String(e));
    } finally {
      setOauthBusy(null);
    }
  }

  async function discordSubmit() {
    setOauthBusy('discord');
    try {
      await signInWithDiscord();
    } catch (e: any) {
      Alert.alert('Discord sign-in failed', e?.message ?? String(e));
    } finally {
      setOauthBusy(null);
    }
  }

  async function submit() {
    setBusy(true);
    try {
      const creds = { email: email.trim(), password };
      const { error } =
        mode === 'signin'
          ? await supabase.auth.signInWithPassword(creds)
          : await supabase.auth.signUp(creds);
      if (error) {
        Alert.alert(mode === 'signin' ? 'Sign in failed' : 'Sign up failed', error.message);
        return;
      }
      if (mode === 'signup') {
        Alert.alert('Check your email', 'Confirm your email to finish sign-up.');
      }
    } catch (e: any) {
      Alert.alert('Unexpected error', e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.container}>
          <View style={styles.logoBadge}>
            <Image
              source={require('../../assets/images/jolly.png')}
              style={styles.logo}
              contentFit="contain"
            />
          </View>
          <Text style={styles.title}>PAWPAW KO</Text>
          <Text style={styles.subtitle}>{mode === 'signin' ? 'Sign in' : 'Create account'}</Text>

          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="email"
            placeholderTextColor={colors.textMuted}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
          />
          <TextInput
            value={password}
            onChangeText={setPassword}
            placeholder="password"
            placeholderTextColor={colors.textMuted}
            secureTextEntry
            style={styles.input}
          />

          <Pressable
            style={({ pressed }) => [styles.button, pressed && styles.buttonPressed, (!email || !password) && styles.buttonDisabled]}
            onPress={submit}
            disabled={busy || !email || !password}>
            {busy ? (
              <ActivityIndicator color={colors.bgPrimary} />
            ) : (
              <Text style={styles.buttonText}>{mode === 'signin' ? 'Sign in' : 'Sign up'}</Text>
            )}
          </Pressable>

          <Pressable onPress={() => setMode(mode === 'signin' ? 'signup' : 'signin')}>
            <Text style={styles.toggle}>
              {mode === 'signin' ? 'No account? Sign up' : 'Already have an account? Sign in'}
            </Text>
          </Pressable>

          <View style={styles.dividerRow}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>OR CONTINUE WITH</Text>
            <View style={styles.dividerLine} />
          </View>

          <View style={styles.oauthRow}>
            <Pressable
              accessibilityLabel="Continue with Google"
              style={({ pressed }) => [styles.oauthCircle, styles.oauthGoogle, pressed && styles.oauthPressed]}
              onPress={googleSubmit}
              disabled={busy || oauthBusy !== null}>
              {oauthBusy === 'google' ? <ActivityIndicator color={colors.bgPrimary} /> : <GoogleIcon />}
            </Pressable>
            <Pressable
              accessibilityLabel="Continue with Discord"
              style={({ pressed }) => [styles.oauthCircle, styles.oauthDiscord, pressed && styles.oauthPressed]}
              onPress={discordSubmit}
              disabled={busy || oauthBusy !== null}>
              {oauthBusy === 'discord' ? <ActivityIndicator color="#fff" /> : <DiscordIcon />}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bgPrimary },
  flex: { flex: 1 },
  container: { flex: 1, justifyContent: 'center', padding: 24, gap: 14 },
  logoBadge: {
    width: 160,
    height: 160,
    borderRadius: 80,
    alignSelf: 'center',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.accentLight,
    marginBottom: 8,
  },
  logo: { width: 120, height: 120 },
  title: {
    fontSize: 36,
    fontFamily: fonts.serifBold,
    textAlign: 'center',
    color: colors.accent,
    letterSpacing: 4,
  },
  subtitle: {
    fontSize: 16,
    fontFamily: fonts.body,
    textAlign: 'center',
    marginBottom: 16,
    color: colors.textSecondary,
    letterSpacing: 1,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgCard,
    borderRadius: radius.sm,
    padding: 14,
    fontSize: 16,
    color: colors.textPrimary,
    fontFamily: fonts.body,
  },
  button: {
    backgroundColor: colors.accent,
    padding: 14,
    borderRadius: radius.sm,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonPressed: { backgroundColor: colors.accentLight },
  buttonDisabled: { opacity: 0.4 },
  buttonText: {
    color: colors.bgPrimary,
    fontFamily: fonts.serifBold,
    fontSize: 14,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  toggle: {
    textAlign: 'center',
    color: colors.accent,
    marginTop: 16,
    fontFamily: fonts.body,
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    gap: 12,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border,
  },
  dividerText: {
    color: colors.textMuted,
    fontFamily: fonts.body,
    fontSize: 12,
    letterSpacing: 2,
  },
  oauthRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
    marginTop: 4,
  },
  oauthCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  oauthPressed: { opacity: 0.7 },
  oauthGoogle: { backgroundColor: colors.accentLight },
  oauthDiscord: { backgroundColor: '#5865F2', borderColor: '#5865F2' },
});
