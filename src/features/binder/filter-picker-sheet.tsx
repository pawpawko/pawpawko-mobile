import { Ionicons } from '@expo/vector-icons';
import { useMemo } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { fonts, radius, type Palette } from '@/lib/theme';
import { useTheme } from '@/lib/theme-context';
import { makeSharedStyles } from './styles';

export type FilterPickerSheetProps = {
  visible: boolean;
  label: string;
  options: string[];
  current: string;
  formatLabel?: (v: string) => string;
  onPick: (v: string) => void;
  onClose: () => void;
};

export function FilterPickerSheet({
  visible,
  label,
  options,
  current,
  formatLabel,
  onPick,
  onClose,
}: FilterPickerSheetProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.shareBackdrop} onPress={onClose}>
        <Pressable style={styles.filterSheetCard} onPress={(e) => e.stopPropagation()}>
          <View style={styles.filterSheetHeader}>
            <Text style={styles.shareTitle}>{label.toUpperCase()}</Text>
            <Pressable onPress={onClose}>
              <Ionicons name="close" size={24} color={colors.textPrimary} />
            </Pressable>
          </View>
          <FlatList
            data={['', ...options]}
            keyExtractor={(v, i) => `${i}-${v}`}
            renderItem={({ item }) => {
              const active = item === current;
              return (
                <Pressable
                  onPress={() => onPick(item)}
                  style={({ pressed }) => [
                    styles.filterOption,
                    active && styles.filterOptionActive,
                    pressed && { opacity: 0.7 },
                  ]}>
                  <Text style={[styles.filterOptionText, active && styles.filterOptionTextActive]}>
                    {item === '' ? 'Any' : formatLabel ? formatLabel(item) : item}
                  </Text>
                  {active ? <Ionicons name="checkmark" size={18} color={colors.accent} /> : null}
                </Pressable>
              );
            }}
          />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const makeStyles = (colors: Palette) => ({
  ...makeSharedStyles(colors),
  ...StyleSheet.create({
    filterSheetCard: {
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.borderAccent,
      paddingVertical: 12,
      maxHeight: '70%',
    },
    filterSheetHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 20,
      paddingBottom: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    filterOption: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 20,
      paddingVertical: 14,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    filterOptionActive: { backgroundColor: colors.bgCardHover },
    filterOptionText: { color: colors.textPrimary, fontFamily: fonts.body, fontSize: 15 },
    filterOptionTextActive: { color: colors.accent, fontFamily: fonts.serifBold },
  }),
});
