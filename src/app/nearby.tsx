import { Ionicons } from '@expo/vector-icons';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  type TextStyle,
  View,
} from 'react-native';

import { DiceLoader } from '@/components/dice-loader';
import { FlairPill } from '@/components/flair-pill';
import { useAutoSearch } from '@/lib/auto-search-context';
import { fetchNearbyTradeBinders, type NearbyTradeBinder } from '@/lib/presence';
import { colors, fonts, radius } from '@/lib/theme';

const REFRESH_MS = 30_000;

export default function NearbyScreen() {
  const router = useRouter();
  const { active, lastLat, lastLng, eventCode, start } = useAutoSearch();
  const hasLoadedOnce = useRef(false);
  const [rows, setRows] = useState<NearbyTradeBinder[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refetch = useCallback(
    async (mode: 'auto' | 'pull' = 'auto') => {
      if (lastLat === null || lastLng === null) return;
      if (!hasLoadedOnce.current) setLoading(true);
      if (mode === 'pull') setRefreshing(true);
      const result = await fetchNearbyTradeBinders(lastLat, lastLng, eventCode);
      if (!hasLoadedOnce.current) setLoading(false);
      if (mode === 'pull') setRefreshing(false);
      hasLoadedOnce.current = true;
      setRows(result);
    },
    [lastLat, lastLng, eventCode],
  );

  // If Auto-Search is off when the screen opens, kick it on so we have
  // coordinates to query with.
  useEffect(() => {
    if (!active) {
      start(eventCode).catch(() => {});
    }
  }, [active, eventCode, start]);

  useFocusEffect(
    useCallback(() => {
      refetch('auto');
      intervalRef.current = setInterval(() => refetch('auto'), REFRESH_MS);
      return () => {
        if (intervalRef.current) clearInterval(intervalRef.current);
      };
    }, [refetch]),
  );

  const headerHint = active
    ? `${rows.length} binder${rows.length === 1 ? '' : 's'}${eventCode ? ` · code “${eventCode}”` : ' · 500m'}`
    : 'Auto-Search is off';

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          title: 'NEARBY',
          headerStyle: { backgroundColor: colors.bgSecondary },
          headerTintColor: colors.textPrimary,
          headerTitleStyle: { fontFamily: fonts.serifBold, letterSpacing: 3, fontSize: 14 } as TextStyle,
          headerLeft: () => (
            <Pressable
              onPress={() => router.back()}
              style={({ pressed }) => ({ padding: 10, opacity: pressed ? 0.6 : 1 })}
              accessibilityLabel="Close">
              <Ionicons name="close" size={24} color={colors.textPrimary} />
            </Pressable>
          ),
        }}
      />

      {loading && rows.length === 0 ? (
        <View style={styles.loaderWrap}>
          <DiceLoader />
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.binder_id}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => refetch('pull')}
              tintColor={colors.accent}
            />
          }
          ListHeaderComponent={
            <View style={styles.headerBlock}>
              <Text style={styles.headerHint}>{headerHint}</Text>
              {!active ? (
                <Text style={styles.headerWarn}>
                  Open the Jolly menu to turn Auto-Search on.
                </Text>
              ) : null}
            </View>
          }
          ListEmptyComponent={
            <Text style={styles.empty}>
              {active
                ? 'No one’s discoverable here right now. Try sharing an event code with people at the venue.'
                : 'Turn on Auto-Search to see nearby trade binders.'}
            </Text>
          }
          renderItem={({ item }) => (
            <Pressable
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              onPress={() => router.push({ pathname: '/binder/[id]', params: { id: item.binder_id } })}>
              <View style={styles.rowHeader}>
                <Text style={styles.rowTitle}>
                  <Text style={styles.rowOwner}>{item.display_name ?? 'someone'}'s </Text>
                  <Text style={styles.rowBinderName}>{item.binder_name ?? 'binder'}</Text>
                </Text>
                <View style={styles.distanceBadge}>
                  <Text style={styles.distanceText}>{formatDistance(item.distance_m)}</Text>
                </View>
              </View>
              <View style={styles.rowPills}>
                <FlairPill value={item.category} kind="category" size="sm" />
                <FlairPill value={item.flair} kind="flair" size="sm" />
              </View>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

function formatDistance(m: number): string {
  if (m < 1000) return `${Math.round(m)}m`;
  return `${(m / 1000).toFixed(1)}km`;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgPrimary },
  headerBlock: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
    gap: 6,
  },
  headerHint: {
    color: colors.textMuted,
    fontFamily: fonts.body,
    fontSize: 13,
    letterSpacing: 1,
  },
  headerWarn: {
    color: colors.accent,
    fontFamily: fonts.body,
    fontSize: 12,
  },
  loaderWrap: { alignItems: 'center', justifyContent: 'center', paddingVertical: 48, gap: 8 },
  loaderText: { color: colors.textMuted, fontFamily: fonts.serif, letterSpacing: 3, fontSize: 12 },
  row: { paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderColor: colors.border },
  rowPressed: { backgroundColor: colors.bgSecondary },
  rowHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  rowTitle: { flex: 1 },
  rowOwner: { fontSize: 14, color: colors.textSecondary, fontFamily: fonts.body },
  rowBinderName: { fontSize: 16, fontFamily: fonts.serifBold, color: colors.textPrimary, letterSpacing: 1 },
  rowPills: { flexDirection: 'row', gap: 6, marginTop: 6 },
  distanceBadge: {
    backgroundColor: colors.bgCard,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.borderAccent,
  },
  distanceText: {
    color: colors.accent,
    fontFamily: fonts.serifBold,
    fontSize: 11,
    letterSpacing: 1,
  },
  empty: { textAlign: 'center', marginTop: 48, color: colors.textMuted, fontFamily: fonts.body, paddingHorizontal: 24 },
});
