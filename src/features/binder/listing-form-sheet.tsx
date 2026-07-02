import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { LISTING_TYPES, type ListingType } from '@/lib/binder-constants';
import { radius, type Palette } from '@/lib/theme';
import { useTheme } from '@/lib/theme-context';
import { makeSharedStyles } from './styles';
import { type CardInfo } from './types';

export type ListingFormSheetProps = {
  visible: boolean;
  title: string;
  card: CardInfo | undefined;
  initialQty: number;
  initialType: ListingType;
  hideForm?: boolean;
  onClose: () => void;
  onSave: (qty: number, type: ListingType) => Promise<void>;
  onDestroy?: () => Promise<void>;
  destroyLabel?: string;
};

export function ListingFormSheet({
  visible,
  title,
  card,
  initialQty,
  initialType,
  hideForm,
  onClose,
  onSave,
  onDestroy,
  destroyLabel,
}: ListingFormSheetProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [qty, setQty] = useState(String(initialQty));
  const [ltype, setLtype] = useState<ListingType>(initialType);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (visible) {
      setQty(String(initialQty));
      setLtype(initialType);
    }
  }, [visible, initialQty, initialType]);

  async function commit() {
    const n = parseInt(qty, 10);
    if (!n || n < 1) {
      Alert.alert('Quantity must be at least 1');
      return;
    }
    setBusy(true);
    await onSave(n, ltype);
    setBusy(false);
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
            <Text style={styles.shareTitle}>{title}</Text>

            {card?.image_url ? (
              <Image source={{ uri: card.image_url }} style={styles.sheetImg} contentFit="contain" />
            ) : null}
            <Text style={styles.sheetCardName}>{card?.name ?? card?.card_code}</Text>
            <Text style={styles.sheetCode}>{card?.card_code}</Text>

            {!hideForm ? (
              <>
                <Text style={styles.editLabel}>Quantity</Text>
                <TextInput
                  value={qty}
                  onChangeText={setQty}
                  keyboardType="number-pad"
                  style={styles.editInput}
                />

                <Text style={styles.editLabel}>Listing type</Text>
                <View style={styles.editPillRow}>
                  {LISTING_TYPES.map((opt) => {
                    const active = opt.value === ltype;
                    return (
                      <Pressable
                        key={opt.value}
                        onPress={() => setLtype(opt.value)}
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
                    busy && styles.editSaveDisabled,
                  ]}
                  disabled={busy}
                  onPress={commit}>
                  {busy ? <ActivityIndicator color={colors.bgPrimary} /> : <Text style={styles.shareBtnText}>SAVE</Text>}
                </Pressable>
              </>
            ) : null}

            {onDestroy ? (
              <Pressable
                style={({ pressed }) => [styles.deleteBtn, pressed && { opacity: 0.7 }]}
                onPress={onDestroy}>
                <Ionicons name="trash-outline" size={16} color={colors.danger} />
                <Text style={styles.deleteBtnText}>{destroyLabel ?? 'REMOVE'}</Text>
              </Pressable>
            ) : null}
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}

const makeStyles = (colors: Palette) => ({
  ...makeSharedStyles(colors),
  ...StyleSheet.create({
    sheetImg: { width: 140, aspectRatio: 0.72, alignSelf: 'center', borderRadius: radius.sm },
  }),
});
