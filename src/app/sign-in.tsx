import { Image } from 'expo-image';
import { useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { supabase } from '@/lib/supabase';
import { colors, fonts, radius } from '@/lib/theme';

export default function SignInScreen() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

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
          <Image
            source={require('../../assets/images/jolly.png')}
            style={styles.logo}
            contentFit="contain"
          />
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
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bgPrimary },
  flex: { flex: 1 },
  container: { flex: 1, justifyContent: 'center', padding: 24, gap: 14 },
  logo: { width: 120, height: 120, alignSelf: 'center', marginBottom: 8 },
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
});
