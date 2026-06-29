import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  type TextStyle,
  View,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { useAuth } from '@/lib/auth';
import { colors, fonts, radius } from '@/lib/theme';

export default function TradeTapScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const [qrOpen, setQrOpen] = useState(false);

  const myUserId = session?.user.id ?? '';
  const tradeTapUrl = myUserId ? `pawpawko://trade-tap?u=${myUserId}` : '';

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          title: 'TRADE TAP',
          headerStyle: { backgroundColor: colors.bgSecondary },
          headerTintColor: colors.textPrimary,
          headerTitleStyle: { fontFamily: fonts.serifBold, letterSpacing: 3, fontSize: 14 } as TextStyle,
          headerLeft: () => (
            <Pressable
              onPress={() => router.back()}
              style={({ pressed }) => ({ padding: 10, opacity: pressed ? 0.6 : 1 })}
              accessibilityLabel="Close">
              <Ionicons name="close" size={24} color={colors.textPrimary} />
            </Pressable>
          ),
        }}
      />

      <View style={styles.body}>
        <View style={styles.hero}>
          <Ionicons name="link" size={56} color={colors.accent} />
          <Text style={styles.title}>TRADE TAP</Text>
          <Text style={styles.subtitle}>
            Compare wishlists and trade binders with someone next to you.
          </Text>
        </View>

        <View style={styles.actions}>
          <Pressable
            onPress={() => setQrOpen(true)}
            style={({ pressed }) => [
              styles.primaryBtn,
              pressed && styles.primaryBtnPressed,
            ]}>
            <Ionicons name="qr-code-outline" size={20} color={colors.bgPrimary} />
            <Text style={styles.primaryBtnText}>SHOW MY CODE</Text>
          </Pressable>

          <Pressable
            onPress={() => router.push('/scan')}
            style={({ pressed }) => [
              styles.secondaryBtn,
              pressed && styles.secondaryBtnPressed,
            ]}>
            <Ionicons name="scan-outline" size={20} color={colors.accent} />
            <Text style={styles.secondaryBtnText}>SCAN PARTNER CODE</Text>
          </Pressable>
        </View>

        <View style={styles.footnote}>
          <Ionicons name="information-circle-outline" size={14} color={colors.textMuted} />
          <Text style={styles.footnoteText}>
            One person taps SHOW MY CODE, the other taps SCAN. Tap-to-pair via Bluetooth is coming
            soon — for now QR keeps things simple and works on every device.
          </Text>
        </View>
      </View>

      <Modal visible={qrOpen} transparent animationType="fade" onRequestClose={() => setQrOpen(false)}>
        <Pressable style={styles.qrBackdrop} onPress={() => setQrOpen(false)}>
          <Pressable style={styles.qrCard} onPress={(e) => e.stopPropagation()}>
            <Pressable style={styles.qrClose} onPress={() => setQrOpen(false)}>
              <Ionicons name="close" size={24} color={colors.textPrimary} />
            </Pressable>
            <Text style={styles.qrTitle}>YOUR CODE</Text>
            <View style={styles.qrWrap}>
              {tradeTapUrl ? (
                <QRCode
                  value={tradeTapUrl}
                  size={240}
                  backgroundColor={colors.bgSecondary}
                  color={colors.textPrimary}
                />
              ) : null}
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgPrimary },
  body: { flex: 1, padding: 24, justifyContent: 'space-between' },

  hero: { alignItems: 'center', gap: 8, marginTop: 24 },
  title: {
    color: colors.accent,
    fontFamily: fonts.serifBold,
    letterSpacing: 6,
    fontSize: 22,
    marginTop: 8,
  },
  subtitle: {
    color: colors.textSecondary,
    fontFamily: fonts.body,
    fontSize: 14,
    textAlign: 'center',
    paddingHorizontal: 16,
    marginTop: 4,
  },

  actions: { gap: 12 },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 18,
    borderRadius: radius.sm,
    backgroundColor: colors.accent,
  },
  primaryBtnPressed: { backgroundColor: colors.accentLight },
  primaryBtnText: {
    color: colors.onAccent,
    fontFamily: fonts.serifBold,
    fontSize: 14,
    letterSpacing: 3,
  },
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 18,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.borderAccent,
    backgroundColor: colors.bgCard,
  },
  secondaryBtnPressed: { backgroundColor: colors.bgCardHover },
  secondaryBtnText: {
    color: colors.accent,
    fontFamily: fonts.serifBold,
    fontSize: 14,
    letterSpacing: 3,
  },

  footnote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingHorizontal: 8,
    marginBottom: 16,
  },
  footnoteText: {
    flex: 1,
    color: colors.textMuted,
    fontFamily: fonts.body,
    fontSize: 12,
    lineHeight: 16,
  },

  qrBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', justifyContent: 'center', padding: 24 },
  qrCard: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderAccent,
    padding: 24,
    alignItems: 'center',
    gap: 14,
  },
  qrClose: { position: 'absolute', top: 8, right: 8, padding: 8, zIndex: 1 },
  qrTitle: { color: colors.accent, fontFamily: fonts.serifBold, letterSpacing: 4, fontSize: 14 },
  qrWrap: { padding: 16, backgroundColor: colors.textPrimary, borderRadius: radius.sm },
  qrHint: {
    color: colors.textMuted,
    fontFamily: fonts.body,
    fontSize: 12,
    textAlign: 'center',
    paddingHorizontal: 8,
  },
});
