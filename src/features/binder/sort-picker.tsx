import { useMemo } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { type SortMode } from '@/lib/binder-constants';
import { fonts, type Palette } from '@/lib/theme';
import { useTheme } from '@/lib/theme-context';

export type SortPickerProps = {
  value: SortMode;
  options: { value: SortMode; label: string }[];
  onChange: (m: SortMode) => void;
};

export function SortPicker({
  value,
  options,
  onChange,
}: SortPickerProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.sortPicker}>
      <FlatList
        horizontal
        keyExtractor={(o) => o.value}
        data={options}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 8, paddingHorizontal: 12 }}
        renderItem={({ item }) => {
          const active = item.value === value;
          return (
            <Pressable
              onPress={() => onChange(item.value)}
              style={[styles.sortChip, active && styles.sortChipActive]}>
              <Text style={[styles.sortChipText, active && styles.sortChipTextActive]}>
                {item.label}
              </Text>
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  sortPicker: {
    paddingVertical: 8,
    backgroundColor: colors.bgSecondary,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  sortChip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgCard,
  },
  sortChipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  sortChipText: {
    color: colors.textSecondary,
    fontFamily: fonts.body,
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: 1,
    includeFontPadding: false,
  },
  sortChipTextActive: { color: colors.onAccent, fontFamily: fonts.serifBold },
});
