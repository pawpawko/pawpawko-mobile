import { StyleSheet, Text, View } from 'react-native';

import { CATEGORY_STYLES, FLAIR_STYLES } from '@/lib/binder-constants';
import { fonts } from '@/lib/theme';

type PillKind = 'flair' | 'category';

export function FlairPill({ value, kind = 'flair', size = 'md' }: { value: string; kind?: PillKind; size?: 'sm' | 'md' }) {
  const map = kind === 'category' ? CATEGORY_STYLES : FLAIR_STYLES;
  const def = map[value];
  if (!def) return null;
  const sizeStyle = size === 'sm' ? styles.pillSm : styles.pillMd;
  const textSizeStyle = size === 'sm' ? styles.textSm : styles.textMd;
  return (
    <View style={[styles.pill, sizeStyle, { borderColor: def.color }]}>
      <Text style={[styles.text, textSizeStyle, { color: def.color }]}>{def.label.toUpperCase()}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    borderWidth: 1,
    backgroundColor: 'transparent',
  },
  pillSm: { paddingHorizontal: 7, paddingVertical: 2 },
  pillMd: { paddingHorizontal: 10, paddingVertical: 4 },
  text: { fontFamily: fonts.serif, includeFontPadding: false },
  textSm: { fontSize: 9, letterSpacing: 1.6 },
  textMd: { fontSize: 10, letterSpacing: 2 },
});
