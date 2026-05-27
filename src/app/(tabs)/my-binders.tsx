import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { colors, fonts } from '@/lib/theme';

type Binder = {
  id: string;
  name: string;
  description: string | null;
  category: string;
  flair: string;
};

export default function MyBindersScreen() {
  const { session } = useAuth();
  const router = useRouter();
  const [rows, setRows] = useState<Binder[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!session?.user.id) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('binders')
      .select('id,name,description,category,flair')
      .eq('user_id', session.user.id)
      .order('created_at', { ascending: true });
    setLoading(false);
    if (error) {
      console.warn('binders fetch error', error.message);
      return;
    }
    setRows(data ?? []);
  }, [session?.user.id]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <View style={styles.container}>
      {loading && rows.length === 0 ? (
        <ActivityIndicator style={{ marginTop: 32 }} color={colors.accent} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.id}
          refreshControl={
            <RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.accent} />
          }
          ListEmptyComponent={<Text style={styles.empty}>No binders yet.</Text>}
          renderItem={({ item }) => (
            <Pressable
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              onPress={() => router.push({ pathname: '/binder/[id]', params: { id: item.id } })}>
              <Text style={styles.rowTitle}>{item.name}</Text>
              <Text style={styles.rowSub}>
                {item.category.toUpperCase()} · {item.flair}
              </Text>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgPrimary },
  row: { paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderColor: colors.border },
  rowPressed: { backgroundColor: colors.bgSecondary },
  rowTitle: { fontSize: 16, fontFamily: fonts.serif, color: colors.textPrimary, letterSpacing: 1 },
  rowSub: { fontSize: 12, color: colors.textMuted, marginTop: 4, fontFamily: fonts.body, letterSpacing: 1 },
  rowDesc: { fontSize: 13, color: colors.textSecondary, marginTop: 6, fontFamily: fonts.body },
  empty: { textAlign: 'center', marginTop: 48, color: colors.textMuted, fontFamily: fonts.body },
});
