import { Ionicons } from '@expo/vector-icons';
import TextRecognition from '@react-native-ml-kit/text-recognition';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/lib/auth';
import { scanForCard, type ScannedCard } from '@/lib/cardScan';
import { suffixFromSlug } from '@/lib/slug';
import { supabase } from '@/lib/supabase';
import { colors, fonts, radius } from '@/lib/theme';
import { addCardToWishlist } from '@/lib/wishlist';

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const SLUG_RE = /\/binders\/([a-z0-9-]+)/i;
const TRADE_TAP_RE = /pawpawko:\/\/trade-tap\?u=([0-9a-f-]{36})/i;

type Mode = 'qr' | 'card';

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

export default function ScanScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const router = useRouter();
  const { session } = useAuth();
  const userId = session?.user.id;

  const cameraRef = useRef<CameraView>(null);
  const lockedRef = useRef(false);

  const [mode, setMode] = useState<Mode>('qr');
  const [error, setError] = useState<string | null>(null);

  // Card-scan (OCR) state.
  const [busy, setBusy] = useState(false);
  const [scanned, setScanned] = useState<ScannedCard | null>(null);
  const [noMatch, setNoMatch] = useState<string | null>(null);
  const [wishMsg, setWishMsg] = useState<string | null>(null);

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
          Pawpaw Ko needs your camera to scan binder QR codes and identify cards.
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

  // ---- QR mode ----
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

  // ---- Card mode (capture-still → on-device OCR) ----
  async function captureCard() {
    if (busy || !cameraRef.current) return;
    setBusy(true);
    setNoMatch(null);
    setWishMsg(null);
    try {
      // No skipProcessing: let the OS fix orientation so OCR reads upright text.
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.6 });
      if (!photo?.uri) {
        setNoMatch('Could not capture — try again');
        return;
      }
      const ocr = await TextRecognition.recognize(photo.uri);
      const { card, codes } = await scanForCard(ocr.text);
      if (card) {
        setScanned(card);
      } else if (codes.length) {
        setNoMatch(`Read "${codes[0]}" but found no match`);
      } else {
        setNoMatch('No card number found — fill the frame and hold steady');
      }
    } catch {
      setNoMatch('Scan failed — try again');
    } finally {
      setBusy(false);
    }
  }

  async function addScannedToWishlist() {
    if (!scanned || !userId) return;
    const res = await addCardToWishlist(scanned.card_code, 'optcg', userId);
    setWishMsg(
      res === 'duplicate'
        ? 'Already in your wishlist'
        : res === 'error'
          ? 'Could not add — try again'
          : 'Added to your wishlist',
    );
  }

  function scanAgain() {
    setScanned(null);
    setNoMatch(null);
    setWishMsg(null);
  }

  function switchMode(m: Mode) {
    setMode(m);
    setError(null);
    setNoMatch(null);
    lockedRef.current = false;
  }

  return (
    <View style={styles.flex}>
      <CameraView
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={mode === 'qr' ? ({ data }) => onScan(data) : undefined}
      />

      <SafeAreaView style={styles.overlay} pointerEvents="box-none">
        {/* Top group: close + title + mode toggle */}
        <View>
          <View style={styles.topBar}>
            <Pressable style={styles.closeBtn} onPress={() => router.back()}>
              <Ionicons name="close" size={28} color={colors.textPrimary} />
            </Pressable>
            <Text style={styles.headerTitle}>{mode === 'qr' ? 'SCAN QR' : 'SCAN CARD'}</Text>
            <View style={styles.closeBtn} />
          </View>

          <View style={styles.modeRow}>
            {(['qr', 'card'] as Mode[]).map((m) => (
              <Pressable
                key={m}
                onPress={() => switchMode(m)}
                style={[styles.modePill, mode === m && styles.modePillActive]}>
                <Text style={[styles.modePillText, mode === m && styles.modePillTextActive]}>
                  {m === 'qr' ? 'QR' : 'CARD'}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Aim guide */}
        <View style={styles.aimWrap} pointerEvents="none">
          <View style={mode === 'qr' ? styles.aimBox : styles.cardBox}>
            <View style={[styles.corner, styles.cornerTL]} />
            <View style={[styles.corner, styles.cornerTR]} />
            <View style={[styles.corner, styles.cornerBL]} />
            <View style={[styles.corner, styles.cornerBR]} />
          </View>
          <Text style={styles.hint}>
            {mode === 'qr'
              ? 'Point at a Pawpaw Ko binder QR or Trade Tap code'
              : 'Fill the frame with a One Piece card, then tap to scan'}
          </Text>
        </View>

        {/* Bottom group: QR error banner OR card shutter */}
        <View style={styles.bottom}>
          {mode === 'qr' ? (
            error ? (
              <View style={styles.errorBanner}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : (
              <View style={{ height: 60 }} />
            )
          ) : (
            <Pressable
              style={[styles.shutter, busy && styles.shutterBusy]}
              onPress={captureCard}
              disabled={busy}>
              {busy ? <ActivityIndicator color={colors.bgPrimary} /> : <View style={styles.shutterInner} />}
            </Pressable>
          )}
        </View>
      </SafeAreaView>

      {/* No-match toast (card mode) */}
      {noMatch && !scanned ? (
        <View style={styles.toast} pointerEvents="none">
          <Text style={styles.toastText}>{noMatch}</Text>
        </View>
      ) : null}

      {/* Matched-card result sheet */}
      {scanned ? (
        <View style={styles.resultWrap}>
          <View style={styles.resultCard}>
            {scanned.image_url ? (
              <Image source={{ uri: scanned.image_url }} style={styles.resultImg} resizeMode="contain" />
            ) : null}
            <Text style={styles.resultName} numberOfLines={2}>
              {scanned.name}
            </Text>
            <Text style={styles.resultCode}>{scanned.card_code}</Text>
            {wishMsg ? <Text style={styles.wishMsg}>{wishMsg}</Text> : null}
            <Pressable
              style={({ pressed }) => [styles.primaryBtn, pressed && styles.btnPressed]}
              onPress={addScannedToWishlist}
              disabled={!userId}>
              <Text style={styles.primaryBtnText}>ADD TO WISHLIST</Text>
            </Pressable>
            <Pressable style={styles.ghostBtn} onPress={scanAgain}>
              <Text style={styles.ghostBtnText}>Scan another</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
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

  modeRow: {
    flexDirection: 'row',
    alignSelf: 'center',
    marginTop: 12,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: radius.sm,
    padding: 4,
    gap: 4,
  },
  modePill: { paddingHorizontal: 22, paddingVertical: 8, borderRadius: radius.sm },
  modePillActive: { backgroundColor: colors.accent },
  modePillText: { color: colors.textSecondary, fontFamily: fonts.serifBold, letterSpacing: 2, fontSize: 13 },
  modePillTextActive: { color: colors.bgPrimary },

  aimWrap: { alignItems: 'center', gap: 16 },
  aimBox: { width: 260, height: 260, position: 'relative' },
  // Trading-card aspect ratio (~2.5 : 3.5).
  cardBox: { width: 250, height: 350, position: 'relative' },
  corner: { position: 'absolute', width: 32, height: 32, borderColor: colors.accent },
  cornerTL: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3 },
  cornerTR: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3 },
  cornerBL: { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3 },
  cornerBR: { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3 },
  hint: { color: colors.textPrimary, fontFamily: fonts.body, fontSize: 13, textShadowColor: 'rgba(0,0,0,0.8)', textShadowRadius: 4, textAlign: 'center', paddingHorizontal: 24 },

  statusText: { color: colors.textMuted, fontFamily: fonts.body },

  bottom: { minHeight: 96, justifyContent: 'center', alignItems: 'center', paddingBottom: 8 },
  shutter: {
    width: 74,
    height: 74,
    borderRadius: 37,
    backgroundColor: colors.accent,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 4,
    borderColor: 'rgba(255,255,255,0.85)',
  },
  shutterBusy: { opacity: 0.8 },
  shutterInner: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.accentLight },

  errorBanner: { backgroundColor: 'rgba(211, 99, 99, 0.95)', padding: 12, margin: 16, borderRadius: radius.sm },
  errorText: { color: '#fff', fontFamily: fonts.body, fontSize: 13, textAlign: 'center' },

  toast: {
    position: 'absolute',
    bottom: 140,
    alignSelf: 'center',
    maxWidth: '85%',
    backgroundColor: 'rgba(0,0,0,0.85)',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: radius.sm,
  },
  toastText: { color: colors.textPrimary, fontFamily: fonts.body, fontSize: 13, textAlign: 'center' },

  resultWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.78)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  resultCard: {
    backgroundColor: colors.bgPrimary,
    borderRadius: radius.sm,
    padding: 20,
    alignItems: 'center',
    alignSelf: 'stretch',
    gap: 8,
  },
  resultImg: { width: 200, height: 280, marginBottom: 4 },
  resultName: { color: colors.textPrimary, fontFamily: fonts.serifBold, fontSize: 18, textAlign: 'center' },
  resultCode: { color: colors.textMuted, fontFamily: fonts.body, fontSize: 13, letterSpacing: 1 },
  wishMsg: { color: colors.accent, fontFamily: fonts.body, fontSize: 13, marginTop: 2 },
  primaryBtn: { marginTop: 10, padding: 14, borderRadius: radius.sm, backgroundColor: colors.accent, alignItems: 'center', alignSelf: 'stretch' },
  primaryBtnText: { color: colors.bgPrimary, fontFamily: fonts.serifBold, letterSpacing: 2, fontSize: 14 },
  ghostBtn: { marginTop: 4, padding: 10 },
  ghostBtnText: { color: colors.textMuted, fontFamily: fonts.body, fontSize: 14 },
});
