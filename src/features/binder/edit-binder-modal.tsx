import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { supabase } from '@/lib/supabase';
import { fonts, radius, type Palette } from '@/lib/theme';
import { useTheme } from '@/lib/theme-context';
import { makeSharedStyles } from './styles';
import { type Flair } from './types';

const FLAIR_OPTIONS: { value: Flair; label: string }[] = [
  { value: 'trade', label: 'Trade' },
  { value: 'wishlist', label: 'Wishlist' },
];

export type EditBinderModalProps = {
  visible: boolean;
  onClose: () => void;
  binderId: string;
  currentName: string;
  currentFlair: Flair;
  onSaveName: (next: string) => Promise<boolean>;
  onSaveFlair: (next: Flair) => Promise<void>;
  onDelete: () => void;
};

export function EditBinderModal({
  visible,
  onClose,
  binderId,
  currentName,
  currentFlair,
  onSaveName,
  onSaveFlair,
  onDelete,
}: EditBinderModalProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [name, setName] = useState(currentName);
  const [savingName, setSavingName] = useState(false);

  // Partner management (trade binders only; mirrors the web collab section).
  const [partners, setPartners] = useState<{ user_id: string; display_name: string }[]>([]);
  const [partnerName, setPartnerName] = useState('');
  const [partnerBusy, setPartnerBusy] = useState(false);
  const [partnerMsg, setPartnerMsg] = useState<string | null>(null);

  const loadPartners = useCallback(async () => {
    if (!binderId) return;
    const { data } = await supabase.rpc('binder_collaborators_list', { p_binder_id: binderId });
    setPartners((data as { user_id: string; display_name: string }[]) ?? []);
  }, [binderId]);

  useEffect(() => {
    if (visible) {
      setName(currentName);
      setPartnerName('');
      setPartnerMsg(null);
      if (currentFlair === 'trade') loadPartners();
    }
  }, [visible, currentName, currentFlair, loadPartners]);

  async function invitePartner() {
    const nm = partnerName.trim();
    if (!nm) return;
    setPartnerBusy(true);
    setPartnerMsg(null);
    const { error } = await supabase.rpc('share_binder', { p_binder_id: binderId, p_display_name: nm });
    setPartnerBusy(false);
    if (error) {
      setPartnerMsg(error.message);
      return;
    }
    setPartnerName('');
    setPartnerMsg(`Invite sent to ${nm} — they'll get a notification to accept.`);
    loadPartners();
  }

  async function removePartner(uid: string) {
    const { error } = await supabase.rpc('unshare_binder', { p_binder_id: binderId, p_user_id: uid });
    if (error) {
      setPartnerMsg(error.message);
      return;
    }
    loadPartners();
  }

  async function commitName() {
    if (name.trim() === currentName.trim() || !name.trim()) {
      onClose();
      return;
    }
    setSavingName(true);
    const ok = await onSaveName(name);
    setSavingName(false);
    if (ok) onClose();
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.shareBackdrop} onPress={onClose}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ width: '100%' }}>
          <Pressable style={styles.editCard} onPress={(e) => e.stopPropagation()}>
            <Pressable style={styles.shareCloseBtn} onPress={onClose}>
              <Ionicons name="close" size={24} color={colors.textPrimary} />
            </Pressable>
            <Text style={styles.shareTitle}>EDIT BINDER</Text>

            <Text style={styles.editLabel}>Name</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              autoCapitalize="sentences"
              style={styles.editInput}
              placeholderTextColor={colors.textMuted}
            />

            <Text style={styles.editLabel}>Flair</Text>
            <View style={styles.editPillRow}>
              {FLAIR_OPTIONS.map((opt) => {
                const active = opt.value === currentFlair;
                return (
                  <Pressable
                    key={opt.value}
                    onPress={() => onSaveFlair(opt.value)}
                    style={[styles.editPill, active && styles.editPillActive]}>
                    <Text style={[styles.editPillText, active && styles.editPillTextActive]}>
                      {opt.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Pressable
              style={({ pressed }) => [
                styles.shareBtn,
                pressed && styles.shareBtnPressed,
                (savingName || !name.trim()) && styles.editSaveDisabled,
              ]}
              disabled={savingName || !name.trim()}
              onPress={commitName}>
              {savingName ? (
                <ActivityIndicator color={colors.bgPrimary} />
              ) : (
                <Text style={styles.shareBtnText}>SAVE NAME</Text>
              )}
            </Pressable>

            {currentFlair === 'trade' ? (
              <View style={styles.partnerSection}>
                <Text style={styles.editLabel}>Share with partner</Text>
                {partners.length > 0 ? (
                  partners.map((p) => (
                    <View key={p.user_id} style={styles.partnerChip}>
                      <Text style={styles.partnerChipName}>{p.display_name || 'partner'}</Text>
                      <Pressable
                        onPress={() => removePartner(p.user_id)}
                        hitSlop={8}
                        accessibilityLabel="Remove partner">
                        <Ionicons name="close" size={16} color={colors.textMuted} />
                      </Pressable>
                    </View>
                  ))
                ) : (
                  <View style={styles.partnerInviteRow}>
                    <TextInput
                      value={partnerName}
                      onChangeText={setPartnerName}
                      placeholder="Partner's display name"
                      placeholderTextColor={colors.textMuted}
                      autoCapitalize="none"
                      style={[styles.editInput, styles.partnerInput]}
                    />
                    <Pressable
                      style={({ pressed }) => [
                        styles.partnerInviteBtn,
                        (partnerBusy || !partnerName.trim()) && styles.editSaveDisabled,
                        pressed && { opacity: 0.7 },
                      ]}
                      disabled={partnerBusy || !partnerName.trim()}
                      onPress={invitePartner}>
                      {partnerBusy ? (
                        <ActivityIndicator color={colors.bgPrimary} />
                      ) : (
                        <Text style={styles.partnerInviteBtnText}>Invite</Text>
                      )}
                    </Pressable>
                  </View>
                )}
                {partnerMsg ? <Text style={styles.partnerMsg}>{partnerMsg}</Text> : null}
              </View>
            ) : null}

            <Pressable
              style={({ pressed }) => [styles.deleteBtn, pressed && { opacity: 0.7 }]}
              onPress={onDelete}>
              <Ionicons name="trash-outline" size={16} color={colors.danger} />
              <Text style={styles.deleteBtnText}>DELETE BINDER</Text>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}

const makeStyles = (colors: Palette) => ({
  ...makeSharedStyles(colors),
  ...StyleSheet.create({
    // Partner management (shared binders)
    partnerSection: { marginTop: 8, marginBottom: 4 },
    partnerChip: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 999,
      paddingVertical: 8,
      paddingHorizontal: 14,
      marginTop: 4,
    },
    partnerChipName: { color: colors.textPrimary, fontFamily: fonts.body, fontSize: 14 },
    partnerInviteRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
    partnerInput: { flex: 1, marginBottom: 0 },
    partnerInviteBtn: {
      backgroundColor: colors.accent,
      borderRadius: radius.lg,
      paddingHorizontal: 16,
      paddingVertical: 12,
      alignItems: 'center',
      justifyContent: 'center',
    },
    partnerInviteBtnText: { color: colors.onAccent, fontFamily: fonts.bodyBold, fontSize: 13 },
    partnerMsg: { color: colors.textSecondary, fontFamily: fonts.body, fontSize: 12, marginTop: 6 },
  }),
});
