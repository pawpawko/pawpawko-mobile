import { Ionicons } from '@expo/vector-icons';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { fonts, radius, type Palette } from '@/lib/theme';
import { useTheme } from '@/lib/theme-context';

export type PaginationProps = {
  page: number;
  totalPages: number;
  onChange: (p: number) => void;
};

export function Pagination({
  page,
  totalPages,
  onChange,
}: PaginationProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.pagination}>
      <Pressable
        disabled={page <= 1}
        onPress={() => onChange(page - 1)}
        style={[styles.pageBtn, page <= 1 && styles.pageBtnDisabled]}>
        <Ionicons name="chevron-back" size={16} color={colors.textPrimary} />
      </Pressable>
      <Text style={styles.pageLabel}>
        Page {page} / {totalPages}
      </Text>
      <Pressable
        disabled={page >= totalPages}
        onPress={() => onChange(page + 1)}
        style={[styles.pageBtn, page >= totalPages && styles.pageBtnDisabled]}>
        <Ionicons name="chevron-forward" size={16} color={colors.textPrimary} />
      </Pressable>
    </View>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  pagination: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.bgSecondary,
  },
  pageBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgCard,
  },
  pageBtnDisabled: { opacity: 0.4 },
  pageLabel: { color: colors.textPrimary, fontFamily: fonts.body, fontSize: 13 },
});
