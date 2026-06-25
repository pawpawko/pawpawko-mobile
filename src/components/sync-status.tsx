import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { clearFailed, pendingForBinder, usePendingSync } from '@/lib/sync-queue';
import { colors, fonts } from '@/lib/theme';

// Status strip shown while edits are queued, syncing, or have permanently
// failed. Pass `binderId` to scope counts to one binder (used on the binder
// screen); omit for an app-wide total.
export function SyncStatusBar({ binderId }: { binderId?: string }) {
  const { pending, syncing, failed } = usePendingSync();
  const count = binderId ? pendingForBinder(binderId) : pending;
  const failedCount = binderId ? failed.filter((f) => f.binderId === binderId).length : failed.length;

  if (count === 0 && failedCount === 0) return null;

  return (
    <View>
      {count > 0 ? (
        <View style={styles.bar}>
          {syncing ? (
            <ActivityIndicator size="small" color={colors.accent} />
          ) : (
            <Ionicons name="cloud-upload-outline" size={15} color={colors.accent} />
          )}
          <Text style={styles.text}>
            {syncing
              ? 'Syncing changes…'
              : `${count} change${count === 1 ? '' : 's'} will sync when you're back online`}
          </Text>
        </View>
      ) : null}
      {failedCount > 0 ? (
        <Pressable style={[styles.bar, styles.failBar]} onPress={() => clearFailed()}>
          <Ionicons name="warning-outline" size={15} color={colors.danger} />
          <Text style={[styles.text, styles.failText]}>
            {failedCount} change{failedCount === 1 ? '' : 's'} couldn&apos;t sync — tap to dismiss
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: colors.bgSecondary,
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  failBar: {
    backgroundColor: colors.bgCard,
  },
  text: {
    color: colors.textSecondary,
    fontFamily: fonts.body,
    fontSize: 12,
  },
  failText: {
    color: colors.danger,
  },
});
