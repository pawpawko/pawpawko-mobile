import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useAutoSearch } from '@/lib/auto-search-context';
import { colors, fonts, radius } from '@/lib/theme';

export function AutoSearchSheet({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const { active, since, eventCode, nearbyCount, start, stop, extend } = useAutoSearch();
  const [codeInput, setCodeInput] = useState<string>(eventCode ?? '');
  const [busy, setBusy] = useState(false);
  // Tick once per minute to refresh the "active for Xh Ym" / countdown.
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!visible) return;
    setCodeInput(eventCode ?? '');
  }, [visible, eventCode]);

  useEffect(() => {
    if (!visible) return;
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, [visible]);

  const elapsedLabel = useMemo(() => formatElapsed(since), [since, tick]);

  async function handleToggle(next: boolean) {
    if (busy) return;
    setBusy(true);
    if (next) {
      const code = codeInput.trim() || null;
      const result = await start(code);
      if (!result.ok) {
        Alert.alert(
          'Couldn’t start Auto-Search',
          result.reason === 'permission-denied'
            ? 'Pawpaw Ko needs location permission to find users nearby. Turn it on in Settings.'
            : result.reason === 'location-unavailable'
              ? 'Couldn’t read your location. Try again outdoors or check that Location is enabled on your device.'
              : (result.message ?? 'Try again in a moment.'),
        );
      }
    } else {
      await stop();
    }
    setBusy(false);
  }

  async function handleExtend() {
    if (busy || !active) return;
    setBusy(true);
    const result = await extend();
    if (!result.ok) {
      Alert.alert('Couldn’t extend session', result.message ?? 'Try again in a moment.');
    }
    setBusy(false);
  }


  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.wrap}>
          <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
            <View style={styles.headerRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>AUTO-SEARCH</Text>
                <Text style={styles.statusLine}>
                  {active ? `Discoverable · ${elapsedLabel}` : 'Off'}
                </Text>
              </View>
              <Switch
                value={active}
                onValueChange={handleToggle}
                disabled={busy}
                trackColor={{ false: colors.bgCard, true: colors.accent }}
                thumbColor={colors.textPrimary}
              />
            </View>

            {!active ? (
              <>
                <Text style={styles.body}>
                  When on, other Pawpawko users within <Text style={styles.bodyAccent}>500m</Text>{' '}
                  see your trade binders. Add an event code to also see anyone with that code within
                  <Text style={styles.bodyAccent}> 2 miles</Text> — event sessions run for 4 hours
                  instead of 1.
                </Text>

                <View style={styles.divider} />
              </>
            ) : null}

            {!active ? (
              <>
                <Text style={styles.label}>EVENT CODE</Text>
                <TextInput
                  value={codeInput}
                  onChangeText={setCodeInput}
                  placeholder="optional · e.g. nycomicon"
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={styles.input}
                  returnKeyType="done"
                />
              </>
            ) : eventCode ? (
              <View style={styles.codeBadge}>
                <Text style={styles.label}>EVENT CODE</Text>
                <Text style={styles.codeValue}>{eventCode}</Text>
              </View>
            ) : null}

            {active ? (
              <>
                <Pressable
                  onPress={() => {
                    onClose();
                    router.push('/nearby');
                  }}
                  style={({ pressed }) => [
                    styles.viewBtn,
                    pressed && styles.viewBtnPressed,
                  ]}>
                  <Ionicons name="compass-outline" size={16} color={colors.bgPrimary} />
                  <Text style={styles.viewBtnText}>
                    {nearbyCount === null
                      ? 'VIEW NEARBY'
                      : `${nearbyCount} NEARBY`}
                  </Text>
                </Pressable>

                <Pressable
                  onPress={handleExtend}
                  disabled={busy}
                  style={({ pressed }) => [
                    styles.extendBtn,
                    pressed && { opacity: 0.7 },
                    busy && { opacity: 0.4 },
                  ]}>
                  {busy ? (
                    <ActivityIndicator color={colors.accent} />
                  ) : (
                    <>
                      <Ionicons name="refresh" size={14} color={colors.accent} />
                      <Text style={styles.extendBtnText}>EXTEND</Text>
                    </>
                  )}
                </Pressable>
              </>
            ) : null}

            <View style={styles.privacy}>
              <Ionicons name="shield-checkmark-outline" size={14} color={colors.textMuted} />
              <Text style={styles.privacyText}>
                Your exact location is never shared — only proximity. Auto-off after
                {active ? (eventCode ? ' 4 hours' : ' 1 hour') : ' 1 hour (4 with event code)'}.
              </Text>
            </View>

            <Pressable
              onPress={onClose}
              style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.6 }]}>
              <Text style={styles.closeBtnText}>CLOSE</Text>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}

function formatElapsed(since: number | null): string {
  if (!since) return '';
  const ms = Date.now() - since;
  if (ms < 60_000) return 'just now';
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  wrap: { width: '100%' },
  card: {
    backgroundColor: colors.bgSecondary,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderTopWidth: 1,
    borderColor: colors.borderAccent,
    padding: 24,
    paddingBottom: 32,
    gap: 14,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  title: { color: colors.accent, fontFamily: fonts.serifBold, letterSpacing: 3, fontSize: 16 },
  statusLine: {
    color: colors.textMuted,
    fontFamily: fonts.body,
    fontSize: 12,
    letterSpacing: 1,
    marginTop: 4,
  },
  body: { color: colors.textPrimary, fontFamily: fonts.body, fontSize: 13, lineHeight: 18 },
  bodyAccent: { color: colors.accent, fontFamily: fonts.serifBold, letterSpacing: 1 },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: 4 },
  label: {
    color: colors.textMuted,
    fontFamily: fonts.serif,
    letterSpacing: 2,
    fontSize: 11,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgCard,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.textPrimary,
    fontFamily: fonts.body,
    fontSize: 14,
  },
  codeBadge: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.borderAccent,
    backgroundColor: colors.bgCard,
  },
  codeValue: {
    color: colors.accent,
    fontFamily: fonts.serifBold,
    fontSize: 14,
    letterSpacing: 1,
  },
  viewBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: radius.sm,
    backgroundColor: colors.accent,
  },
  viewBtnPressed: { backgroundColor: colors.accentLight },
  viewBtnText: {
    color: colors.onAccent,
    fontFamily: fonts.serifBold,
    fontSize: 13,
    letterSpacing: 2,
  },
  extendBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.borderAccent,
    backgroundColor: colors.bgCard,
  },
  extendBtnText: {
    color: colors.accent,
    fontFamily: fonts.serifBold,
    fontSize: 11,
    letterSpacing: 2,
  },
  privacy: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  privacyText: {
    color: colors.textMuted,
    fontFamily: fonts.body,
    fontSize: 11,
    letterSpacing: 0.5,
    flex: 1,
  },
  closeBtn: {
    alignSelf: 'center',
    paddingVertical: 6,
    paddingHorizontal: 16,
    marginTop: 4,
  },
  closeBtnText: {
    color: colors.textMuted,
    fontFamily: fonts.serif,
    fontSize: 12,
    letterSpacing: 2,
  },
});
