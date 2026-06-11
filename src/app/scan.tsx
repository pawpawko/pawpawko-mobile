import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { suffixFromSlug } from '@/lib/slug';
import { supabase } from '@/lib/supabase';
import { colors, fonts, radius } from '@/lib/theme';

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const SLUG_RE = /\/binders\/([a-z0-9-]+)/i;
const TRADE_TAP_RE = /pawpawko:\/\/trade-tap\?u=([0-9a-f-]{36})/i;

type ScanResult =
  | { kind: 'binder'; binderId: string }
  | { kind: 'trade-tap'; partnerUserId: string };

async function resolveScanned(raw: string): Promise<ScanResult | null> {
  // 1. Trade Tap URL — partner user_id payload. Matched first because the
  //    URL embeds a UUID and would otherwise be misread as a binder UUID.
  const ttMatch = raw.match(TRADE_TAP_RE);
  if (ttMatch) return { kind: 'trade-tap', partnerUserId: ttMatch[1].toLowerCase() };
  // 2. Full UUID embedded anywhere → treat as a binder id.
  const m = raw.match(UUID_RE);
  if (m) return { kind: 'binder', binderId: m[0] };
  // 3. Pretty share URL /binders/<slug-with-8-char-suffix> → resolve via RPC.
  const slugMatch = raw.match(SLUG_RE);
  if (slugMatch) {
    const slug = slugMatch[1].toLowerCase();
    if (suffixFromSlug(slug)) {
      const { data, error } = await supabase.rpc('resolve_binder_slug', { p_slug: slug });
      if (!error && typeof data === 'string') return { kind: 'binder', binderId: data };
    }
  }
  return null;
}

export default function ScanQRScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const router = useRouter();
  const lockedRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  if (!permission) {
    return (
      <View style={styles.centered}>
        <Text style={styles.statusText}>Loading camera…</Text>
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.centered}>
        <Ionicons name="camera-outline" size={56} color={colors.accent} />
        <Text style={styles.title}>CAMERA ACCESS</Text>
        <Text style={styles.body}>
          Pawpaw Ko needs your camera to scan QR codes that point to binders.
        </Text>
        <Pressable
          style={({ pressed }) => [styles.btn, pressed && styles.btnPressed]}
          onPress={requestPermission}>
          <Text style={styles.btnText}>GRANT ACCESS</Text>
        </Pressable>
        <Pressable style={styles.cancelBtn} onPress={() => router.back()}>
          <Text style={styles.cancelText}>Cancel</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  async function onScan(data: string) {
    if (lockedRef.current) return;
    lockedRef.current = true;
    const result = await resolveScanned(data);
    if (result?.kind === 'binder') {
      router.replace({ pathname: '/binder/[id]', params: { id: result.binderId } });
    } else if (result?.kind === 'trade-tap') {
      router.replace({
        pathname: '/trade-matches/[partnerId]',
        params: { partnerId: result.partnerUserId },
      });
    } else {
      setError(`Unsupported QR: ${data.slice(0, 80)}`);
      setTimeout(() => {
        lockedRef.current = false;
        setError(null);
      }, 2500);
    }
  }

  return (
    <View style={styles.flex}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={({ data }) => onScan(data)}
      />

      {/* Overlay */}
      <SafeAreaView style={styles.overlay} pointerEvents="box-none">
        <View style={styles.topBar}>
          <Pressable style={styles.closeBtn} onPress={() => router.back()}>
            <Ionicons name="close" size={28} color={colors.textPrimary} />
          </Pressable>
          <Text style={styles.headerTitle}>SCAN QR</Text>
          <View style={styles.closeBtn} />
        </View>

        <View style={styles.aimWrap} pointerEvents="none">
          <View style={styles.aimBox}>
            <View style={[styles.corner, styles.cornerTL]} />
            <View style={[styles.corner, styles.cornerTR]} />
            <View style={[styles.corner, styles.cornerBL]} />
            <View style={[styles.corner, styles.cornerBR]} />
          </View>
          <Text style={styles.hint}>Point at a Pawpaw Ko binder QR or Trade Tap code</Text>
        </View>

        {error ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : (
          <View style={{ height: 60 }} />
        )}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#000' },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    gap: 14,
    backgroundColor: colors.bgPrimary,
  },
  title: { color: colors.textPrimary, fontFamily: fonts.serifBold, letterSpacing: 3, fontSize: 16 },
  body: { color: colors.textSecondary, fontFamily: fonts.body, textAlign: 'center', fontSize: 14 },
  btn: { marginTop: 12, padding: 14, borderRadius: radius.sm, backgroundColor: colors.accent, alignItems: 'center', alignSelf: 'stretch' },
  btnPressed: { backgroundColor: colors.accentLight },
  btnText: { color: colors.bgPrimary, fontFamily: fonts.serifBold, letterSpacing: 2, fontSize: 14 },
  cancelBtn: { marginTop: 8, padding: 8 },
  cancelText: { color: colors.textMuted, fontFamily: fonts.body },

  overlay: { flex: 1, justifyContent: 'space-between' },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  closeBtn: { padding: 8, width: 44, alignItems: 'center' },
  headerTitle: { color: colors.textPrimary, fontFamily: fonts.serifBold, letterSpacing: 3, fontSize: 14 },

  aimWrap: { alignItems: 'center', gap: 16 },
  aimBox: { width: 260, height: 260, position: 'relative' },
  corner: { position: 'absolute', width: 32, height: 32, borderColor: colors.accent },
  cornerTL: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3 },
  cornerTR: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3 },
  cornerBL: { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3 },
  cornerBR: { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3 },
  hint: { color: colors.textPrimary, fontFamily: fonts.body, fontSize: 13, textShadowColor: 'rgba(0,0,0,0.8)', textShadowRadius: 4 },

  statusText: { color: colors.textMuted, fontFamily: fonts.body },

  errorBanner: { backgroundColor: 'rgba(211, 99, 99, 0.95)', padding: 12, margin: 16, borderRadius: radius.sm },
  errorText: { color: '#fff', fontFamily: fonts.body, fontSize: 13, textAlign: 'center' },
});
