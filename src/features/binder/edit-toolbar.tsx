import { Ionicons } from '@expo/vector-icons';
import { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { radius, type Palette } from '@/lib/theme';
import { useTheme } from '@/lib/theme-context';

export type EditToolbarProps = {
  aestheticsMode: boolean;
  onToggleAesthetics: () => void;
  onAddCards: () => void;
  onOpenSettings?: () => void; // owner-only; hidden for collaborators
};

export function EditToolbar({
  aestheticsMode,
  onToggleAesthetics,
  onAddCards,
  onOpenSettings,
}: EditToolbarProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.toolbar}>
      <Pressable
        style={({ pressed }) => [
          styles.toolbarIconBtn,
          aestheticsMode && styles.toolbarBtnActive,
          pressed && { opacity: 0.7 },
        ]}
        onPress={onToggleAesthetics}
        accessibilityLabel={aestheticsMode ? 'Exit sort mode' : 'Sort mode'}>
        <Ionicons
          name="color-palette-outline"
          size={18}
          color={aestheticsMode ? colors.bgPrimary : colors.accent}
        />
      </Pressable>
      {onOpenSettings ? (
        <Pressable
          onPress={onOpenSettings}
          style={({ pressed }) => [styles.toolbarIconBtn, pressed && { opacity: 0.7 }]}
          accessibilityLabel="Binder settings">
          <Ionicons name="settings-outline" size={18} color={colors.accent} />
        </Pressable>
      ) : null}
      <Pressable
        style={({ pressed }) => [styles.toolbarBtnPrimary, pressed && { opacity: 0.7 }]}
        onPress={onAddCards}
        accessibilityLabel="Add cards">
        <Ionicons name="add" size={22} color={colors.bgPrimary} />
      </Pressable>
    </View>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.bgSecondary,
  },
  toolbarIconBtn: {
    paddingHorizontal: 8,
    paddingVertical: 7,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgCard,
  },
  toolbarBtnActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  toolbarBtnPrimary: {
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: radius.sm,
    backgroundColor: colors.accent,
    marginLeft: 'auto',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
