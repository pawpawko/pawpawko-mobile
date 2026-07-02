import { StyleSheet } from 'react-native';

import { fonts, radius, type Palette } from '@/lib/theme';

// Binder styles used by two or more feature files; single-consumer styles
// live in their component's file.
export const makeSharedStyles = (colors: Palette) => StyleSheet.create({
  cell: { padding: 4, alignItems: 'center' },
  cellPressed: { opacity: 0.7 },
  cardImg: { width: '100%', aspectRatio: 0.72, borderRadius: radius.sm, backgroundColor: colors.bgCard },
  placeholder: { borderWidth: 1, borderColor: colors.border },
  cardCode: { fontSize: 11, marginTop: 4, fontFamily: fonts.serifBold, color: colors.textPrimary, letterSpacing: 1 },
  cardMeta: { fontSize: 10, color: colors.textMuted, fontFamily: fonts.body },
  empty: { textAlign: 'center', marginTop: 48, color: colors.textMuted, fontFamily: fonts.body },
  shareBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', padding: 24 },
  shareCloseBtn: { position: 'absolute', top: 8, right: 8, padding: 8, zIndex: 1 },
  shareTitle: { color: colors.accent, fontFamily: fonts.serifBold, letterSpacing: 3, fontSize: 14 },
  shareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: radius.sm,
    backgroundColor: colors.accent,
    alignSelf: 'stretch',
    justifyContent: 'center',
    marginTop: 4,
  },
  shareBtnPressed: { backgroundColor: colors.accentLight },
  shareBtnText: { color: colors.onAccent, fontFamily: fonts.serifBold, letterSpacing: 2, fontSize: 13 },

  editCard: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderAccent,
    padding: 24,
    gap: 10,
  },
  editLabel: {
    color: colors.textMuted,
    fontFamily: fonts.serif,
    letterSpacing: 2,
    fontSize: 11,
    marginTop: 8,
  },
  editInput: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgCard,
    borderRadius: radius.sm,
    padding: 12,
    fontSize: 16,
    color: colors.textPrimary,
    fontFamily: fonts.body,
  },
  editPillRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  editPill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgCard,
  },
  editPillActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  editPillText: { color: colors.textSecondary, fontFamily: fonts.body, fontSize: 13, letterSpacing: 1 },
  editPillTextActive: { color: colors.onAccent, fontFamily: fonts.serifBold },
  editSaveDisabled: { opacity: 0.4 },
  deleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    marginTop: 4,
  },
  deleteBtnText: {
    color: colors.danger,
    fontFamily: fonts.serifBold,
    letterSpacing: 2,
    fontSize: 12,
  },

  sheetCardName: {
    color: colors.textPrimary,
    fontFamily: fonts.serifBold,
    letterSpacing: 1,
    fontSize: 16,
    textAlign: 'center',
  },
  sheetCode: { color: colors.accent, fontFamily: fonts.body, letterSpacing: 2, fontSize: 12, textAlign: 'center' },
});
