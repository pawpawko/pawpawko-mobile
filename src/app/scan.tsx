import { Ionicons } from '@expo/vector-icons';
import TextRecognition from '@react-native-ml-kit/text-recognition';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/lib/auth';
import {
  addCardsToBinder,
  addCardToBinder,
  createTradeBinder,
  listTradeBinders,
  type TradeBinder,
} from '@/lib/binders';
import { lookupCards, normalizeCode, scanForCard, scanForCards, type ScannedCard } from '@/lib/cardScan';
import { suffixFromSlug } from '@/lib/slug';
import { supabase } from '@/lib/supabase';
import { colors, fonts, radius } from '@/lib/theme';
import { addCardToWishlist } from '@/lib/wishlist';

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const SLUG_RE = /\/binders\/([a-z0-9-]+)/i;
const TRADE_TAP_RE = /pawpawko:\/\/trade-tap\?u=([0-9a-f-]{36})/i;

type Mode = 'qr' | 'card' | 'page';

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

  // Entry scope limits the modes: trades opens a QR-only camera, the binder tab
  // opens a card-only (CARD + PAGE) camera; default shows all three.
  const { scope } = useLocalSearchParams<{ scope?: string }>();
  const availableModes: Mode[] =
    scope === 'qr' ? ['qr'] : scope === 'card' ? ['card', 'page'] : ['qr', 'card', 'page'];
  const [mode, setMode] = useState<Mode>(availableModes[0]);
  const [error, setError] = useState<string | null>(null);

  // Card-scan (OCR) state.
  const [busy, setBusy] = useState(false);
  const [scanned, setScanned] = useState<ScannedCard | null>(null);
  const [noMatch, setNoMatch] = useState<string | null>(null);
  const [addMsg, setAddMsg] = useState<string | null>(null);
  // Trade-binder picker state.
  const [pickerOpen, setPickerOpen] = useState(false);
  const [tradeBinders, setTradeBinders] = useState<TradeBinder[] | null>(null);
  const [bindersBusy, setBindersBusy] = useState(false);
  const [qty, setQty] = useState(1);
  const [pickerMode, setPickerMode] = useState<'single' | 'tray'>('single');
  // Multi-scan tray (page mode): a running list of detected cards to commit
  // together. Merged by card_code; quantity bumps on repeat detections.
  const [tray, setTray] = useState<{ card: ScannedCard; quantity: number }[]>([]);
  const [trayOpen, setTrayOpen] = useState(false);
  const [manualCode, setManualCode] = useState('');

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
    setAddMsg(null);
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

  // ---- Page mode (capture a whole page → OCR → drop every match into the tray) ----
  async function capturePage() {
    if (busy || !cameraRef.current) return;
    setBusy(true);
    setNoMatch(null);
    setAddMsg(null);
    try {
      // Full resolution: a page's card numbers are tiny, so don't downsample.
      const photo = await cameraRef.current.takePictureAsync({ quality: 1 });
      if (!photo?.uri) {
        setNoMatch('Could not capture — try again');
        return;
      }
      const ocr = await TextRecognition.recognize(photo.uri);
      const { cards, unmatched } = await scanForCards(ocr.text);
      if (cards.length === 0) {
        setNoMatch(
          unmatched.length
            ? `Read ${unmatched.length} number${unmatched.length === 1 ? '' : 's'} but matched none`
            : 'No card numbers found — fill the frame, good light',
        );
        return;
      }
      mergeIntoTray(cards);
      setNoMatch(
        `Added ${cards.length} card${cards.length === 1 ? '' : 's'} to tray` +
          (unmatched.length ? ` · ${unmatched.length} unreadable` : ''),
      );
    } catch {
      setNoMatch('Scan failed — try again');
    } finally {
      setBusy(false);
    }
  }

  // Merge detected cards into the tray, de-duping by code and bumping quantity
  // on repeats (so the same card across pages counts as multiple copies).
  function mergeIntoTray(cards: ScannedCard[]) {
    setTray((prev) => {
      const map = new Map(prev.map((t) => [t.card.card_code, t]));
      for (const c of cards) {
        const ex = map.get(c.card_code);
        if (ex) map.set(c.card_code, { ...ex, quantity: ex.quantity + 1 });
        else map.set(c.card_code, { card: c, quantity: 1 });
      }
      return Array.from(map.values());
    });
  }

  function setTrayQty(cardCode: string, next: number) {
    setTray((prev) =>
      prev.flatMap((t) =>
        t.card.card_code === cardCode ? (next > 0 ? [{ ...t, quantity: next }] : []) : [t],
      ),
    );
  }

  // Manual fallback for a card the camera couldn't read.
  async function addManualCode() {
    const code = normalizeCode(manualCode);
    if (!code) {
      setNoMatch('Not a One Piece card number (e.g. OP10-019)');
      return;
    }
    const [card] = await lookupCards([code]);
    if (!card) {
      setNoMatch(`No match for ${code}`);
      return;
    }
    mergeIntoTray([card]);
    setManualCode('');
  }

  async function addScannedToWishlist() {
    if (!scanned || !userId) return;
    const res = await addCardToWishlist(scanned.card_code, 'optcg', userId);
    setAddMsg(
      res === 'duplicate'
        ? 'Already in your wishlist'
        : res === 'error'
          ? 'Could not add — try again'
          : 'Added to your wishlist',
    );
  }

  // Load the user's One Piece trade binders once (cached for the session).
  async function ensureBindersLoaded() {
    if (!userId || tradeBinders !== null) return;
    setBindersBusy(true);
    const list = await listTradeBinders(userId, 'optcg');
    setTradeBinders(list);
    setBindersBusy(false);
  }

  // Open the picker for the single scanned card.
  function openTradePicker() {
    if (!userId) return;
    setPickerMode('single');
    setAddMsg(null);
    setPickerOpen(true);
    void ensureBindersLoaded();
  }

  // Open the picker to commit the whole multi-scan tray at once.
  function openTrayPicker() {
    if (!userId || tray.length === 0) return;
    setPickerMode('tray');
    setTrayOpen(false);
    setPickerOpen(true);
    void ensureBindersLoaded();
  }

  async function addToBinder(target: TradeBinder) {
    const name = target.name || 'trade binder';
    if (pickerMode === 'tray') {
      const items = tray.map((t) => ({ cardCode: t.card.card_code, quantity: t.quantity }));
      const sum = await addCardsToBinder(target.id, items);
      setPickerOpen(false);
      if (sum.error) {
        setAddMsg('Could not add — try again');
        return;
      }
      setTray([]);
      setAddMsg(
        `Added ${sum.added} to ${name}` +
          (sum.duplicates ? ` · ${sum.duplicates} already there` : ''),
      );
      return;
    }
    if (!scanned) return;
    const res = await addCardToBinder(target.id, scanned.card_code, qty);
    setPickerOpen(false);
    setAddMsg(
      res === 'duplicate'
        ? `Already in ${name}`
        : res === 'error'
          ? 'Could not add — try again'
          : `Added ${qty > 1 ? `${qty}× ` : ''}to ${name}`,
    );
  }

  async function createAndAddToBinder() {
    if (!userId) return;
    if (pickerMode === 'single' && !scanned) return;
    setBindersBusy(true);
    const nb = await createTradeBinder(userId, 'optcg');
    setBindersBusy(false);
    if (!nb) {
      setAddMsg('Could not create binder — try again');
      return;
    }
    setTradeBinders((prev) => [...(prev ?? []), nb]);
    await addToBinder(nb);
  }

  function scanAgain() {
    setScanned(null);
    setNoMatch(null);
    setAddMsg(null);
    setPickerOpen(false);
    setQty(1);
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

          {availableModes.length > 1 ? (
            <View style={styles.modeRow}>
              {availableModes.map((m) => (
                <Pressable
                  key={m}
                  onPress={() => switchMode(m)}
                  style={[styles.modePill, mode === m && styles.modePillActive]}>
                  <Text style={[styles.modePillText, mode === m && styles.modePillTextActive]}>
                    {m === 'qr' ? 'QR' : m === 'card' ? 'CARD' : 'PAGE'}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>

        {/* Aim guide */}
        <View style={styles.aimWrap} pointerEvents="none">
          <View style={mode === 'qr' ? styles.aimBox : mode === 'card' ? styles.cardBox : styles.pageBox}>
            <View style={[styles.corner, styles.cornerTL]} />
            <View style={[styles.corner, styles.cornerTR]} />
            <View style={[styles.corner, styles.cornerBL]} />
            <View style={[styles.corner, styles.cornerBR]} />
          </View>
          <Text style={styles.hint}>
            {mode === 'qr'
              ? 'Point at a Pawpaw Ko binder QR or Trade Tap code'
              : mode === 'card'
                ? 'Fill the frame with a One Piece card, then tap to scan'
                : 'Fit a binder page in the frame, then tap — cards drop into the tray'}
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
            <View style={styles.shutterRow}>
              {mode === 'page' && tray.length > 0 ? (
                <Pressable style={styles.trayBtn} onPress={() => setTrayOpen(true)}>
                  <Ionicons name="albums" size={18} color={colors.bgPrimary} />
                  <Text style={styles.trayBtnText}>{tray.length}</Text>
                </Pressable>
              ) : (
                <View style={styles.trayBtnSpacer} />
              )}
              <Pressable
                style={[styles.shutter, busy && styles.shutterBusy]}
                onPress={mode === 'card' ? captureCard : capturePage}
                disabled={busy}>
                {busy ? <ActivityIndicator color={colors.bgPrimary} /> : <View style={styles.shutterInner} />}
              </Pressable>
              <View style={styles.trayBtnSpacer} />
            </View>
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
            {addMsg ? <Text style={styles.wishMsg}>{addMsg}</Text> : null}
            <Pressable
              style={({ pressed }) => [styles.primaryBtn, pressed && styles.btnPressed]}
              onPress={openTradePicker}
              disabled={!userId}>
              <Text style={styles.primaryBtnText}>ADD TO TRADE BINDER</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.secondaryBtn, pressed && styles.btnPressed]}
              onPress={addScannedToWishlist}
              disabled={!userId}>
              <Text style={styles.secondaryBtnText}>ADD TO WISHLIST</Text>
            </Pressable>
            <Pressable style={styles.ghostBtn} onPress={scanAgain}>
              <Text style={styles.ghostBtnText}>Scan another</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {/* Trade-binder picker (renders above the result sheet) */}
      {pickerOpen ? (
        <View style={styles.resultWrap}>
          <View style={styles.resultCard}>
            <Text style={styles.pickerTitle}>
              {pickerMode === 'tray' ? `ADD ${tray.length} CARDS TO…` : 'ADD TO TRADE BINDER'}
            </Text>

            {pickerMode === 'single' ? (
              <View style={styles.qtyBlock}>
                <Text style={styles.qtyLabel}>Quantity · {qty}</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.qtyScroll}>
                  {Array.from({ length: 30 }, (_, i) => i + 1).map((n) => (
                    <Pressable
                      key={n}
                      onPress={() => setQty(n)}
                      style={[styles.qtyNum, qty === n && styles.qtyNumActive]}>
                      <Text style={[styles.qtyNumText, qty === n && styles.qtyNumTextActive]}>{n}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
            ) : null}

            {bindersBusy ? (
              <ActivityIndicator color={colors.accent} style={{ marginVertical: 14 }} />
            ) : (
              <>
                {(tradeBinders ?? []).map((b) => (
                  <Pressable
                    key={b.id}
                    style={({ pressed }) => [styles.binderRow, pressed && styles.btnPressed]}
                    onPress={() => addToBinder(b)}>
                    <Ionicons name="albums-outline" size={18} color={colors.accent} />
                    <Text style={styles.binderRowText} numberOfLines={1}>
                      {b.name || 'Trade binder'}
                    </Text>
                  </Pressable>
                ))}
                <Pressable
                  style={({ pressed }) => [styles.binderRow, pressed && styles.btnPressed]}
                  onPress={createAndAddToBinder}>
                  <Ionicons name="add-circle-outline" size={18} color={colors.accent} />
                  <Text style={styles.binderRowText}>New trade binder</Text>
                </Pressable>
                {tradeBinders && tradeBinders.length === 0 ? (
                  <Text style={styles.pickerHint}>
                    No One Piece trade binder yet — create one above.
                  </Text>
                ) : null}
              </>
            )}

            <Pressable style={styles.ghostBtn} onPress={() => setPickerOpen(false)}>
              <Text style={styles.ghostBtnText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {/* Multi-scan review tray */}
      <Modal visible={trayOpen} transparent animationType="slide" onRequestClose={() => setTrayOpen(false)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.trayBackdrop}>
          <View style={styles.traySheet}>
            <View style={styles.trayHeader}>
              <Text style={styles.trayTitle}>SCAN TRAY · {tray.length}</Text>
              <Pressable onPress={() => setTrayOpen(false)} hitSlop={8}>
                <Ionicons name="close" size={24} color={colors.textPrimary} />
              </Pressable>
            </View>

            {tray.length === 0 ? (
              <Text style={styles.trayEmpty}>No cards yet — scan a page or add a code below.</Text>
            ) : (
              <ScrollView style={styles.trayList} keyboardShouldPersistTaps="handled">
                {tray.map((t) => (
                  <View key={t.card.card_code} style={styles.trayItem}>
                    {t.card.image_url ? (
                      <Image source={{ uri: t.card.image_url }} style={styles.trayThumb} resizeMode="contain" />
                    ) : (
                      <View style={styles.trayThumb} />
                    )}
                    <View style={styles.trayItemInfo}>
                      <Text style={styles.trayItemName} numberOfLines={1}>
                        {t.card.name}
                      </Text>
                      <Text style={styles.trayItemCode}>{t.card.card_code}</Text>
                    </View>
                    <View style={styles.qtyControls}>
                      <Pressable
                        style={styles.qtyBtn}
                        onPress={() => setTrayQty(t.card.card_code, t.quantity - 1)}>
                        <Ionicons name="remove" size={16} color={colors.accent} />
                      </Pressable>
                      <Text style={styles.qtyValue}>{t.quantity}</Text>
                      <Pressable
                        style={styles.qtyBtn}
                        onPress={() => setTrayQty(t.card.card_code, t.quantity + 1)}>
                        <Ionicons name="add" size={16} color={colors.accent} />
                      </Pressable>
                    </View>
                  </View>
                ))}
              </ScrollView>
            )}

            <View style={styles.manualRow}>
              <TextInput
                value={manualCode}
                onChangeText={setManualCode}
                placeholder="Add a code the camera missed (OP10-019)"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="characters"
                autoCorrect={false}
                style={styles.manualInput}
                onSubmitEditing={addManualCode}
                returnKeyType="done"
              />
              <Pressable style={styles.manualBtn} onPress={addManualCode}>
                <Ionicons name="add" size={20} color={colors.bgPrimary} />
              </Pressable>
            </View>

            <Pressable
              style={({ pressed }) => [
                styles.primaryBtn,
                tray.length === 0 && styles.disabledBtn,
                pressed && styles.btnPressed,
              ]}
              onPress={openTrayPicker}
              disabled={tray.length === 0}>
              <Text style={styles.primaryBtnText}>ADD {tray.length} TO TRADE BINDER</Text>
            </Pressable>
            {tray.length > 0 ? (
              <Pressable style={styles.ghostBtn} onPress={() => setTray([])}>
                <Text style={styles.ghostBtnText}>Clear tray</Text>
              </Pressable>
            ) : null}
          </View>
        </KeyboardAvoidingView>
      </Modal>
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
  secondaryBtn: { marginTop: 8, padding: 14, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.borderAccent, alignItems: 'center', alignSelf: 'stretch' },
  secondaryBtnText: { color: colors.accent, fontFamily: fonts.serifBold, letterSpacing: 2, fontSize: 14 },

  pickerTitle: { color: colors.accent, fontFamily: fonts.serifBold, letterSpacing: 2, fontSize: 15, marginBottom: 4 },
  qtyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', alignSelf: 'stretch', marginBottom: 4 },
  qtyLabel: { color: colors.textSecondary, fontFamily: fonts.body, fontSize: 14 },
  qtyControls: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  qtyBtn: { width: 36, height: 36, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.borderAccent, alignItems: 'center', justifyContent: 'center' },
  qtyValue: { color: colors.textPrimary, fontFamily: fonts.serifBold, fontSize: 16, minWidth: 24, textAlign: 'center' },
  qtyBlock: { alignSelf: 'stretch', marginBottom: 4 },
  qtyScroll: { gap: 8, paddingVertical: 8, paddingRight: 8 },
  qtyNum: { minWidth: 40, height: 40, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  qtyNumActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  qtyNumText: { color: colors.textPrimary, fontFamily: fonts.serifBold, fontSize: 16 },
  qtyNumTextActive: { color: colors.bgPrimary },
  binderRow: { flexDirection: 'row', alignItems: 'center', gap: 10, alignSelf: 'stretch', paddingVertical: 12, paddingHorizontal: 12, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border },
  binderRowText: { color: colors.textPrimary, fontFamily: fonts.body, fontSize: 15, flex: 1 },
  pickerHint: { color: colors.textMuted, fontFamily: fonts.body, fontSize: 13, textAlign: 'center', marginTop: 4 },

  pageBox: { width: 300, height: 380, position: 'relative' },
  shutterRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 24 },
  trayBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.accent, paddingHorizontal: 14, paddingVertical: 10, borderRadius: radius.lg },
  trayBtnText: { color: colors.bgPrimary, fontFamily: fonts.serifBold, fontSize: 15 },
  trayBtnSpacer: { width: 58 },

  trayBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  traySheet: { backgroundColor: colors.bgPrimary, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: 16, paddingBottom: 28, maxHeight: '85%' },
  trayHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  trayTitle: { color: colors.accent, fontFamily: fonts.serifBold, letterSpacing: 2, fontSize: 15 },
  trayEmpty: { color: colors.textMuted, fontFamily: fonts.body, fontSize: 14, textAlign: 'center', paddingVertical: 24 },
  trayList: { maxHeight: 360 },
  trayItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderColor: colors.border },
  trayThumb: { width: 38, height: 53, borderRadius: 4, backgroundColor: colors.bgCard },
  trayItemInfo: { flex: 1 },
  trayItemName: { color: colors.textPrimary, fontFamily: fonts.body, fontSize: 14 },
  trayItemCode: { color: colors.textMuted, fontFamily: fonts.body, fontSize: 12, letterSpacing: 0.5 },
  manualRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  manualInput: { flex: 1, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 10, color: colors.textPrimary, fontFamily: fonts.body, fontSize: 14 },
  manualBtn: { width: 44, height: 44, borderRadius: radius.sm, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  disabledBtn: { opacity: 0.5 },
  ghostBtn: { marginTop: 4, padding: 10 },
  ghostBtnText: { color: colors.textMuted, fontFamily: fonts.body, fontSize: 14 },
});
