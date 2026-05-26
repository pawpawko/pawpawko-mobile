import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { BINDER_CATEGORIES, type BinderCategory } from '@/lib/constants';
import { supabase } from '@/lib/supabase';

type BinderRow = {
  binder_id: string;
  user_id: string;
  display_name: string | null;
  name: string;
  description: string | null;
  category: BinderCategory;
  city: string | null;
  boroughs: string[] | null;
  subway_stops: string[] | null;
  last_updated_at: string | null;
};

export default function TradesScreen() {
  const router = useRouter();
  const [category, setCategory] = useState<BinderCategory>('optcg');
  const [rows, setRows] = useState<BinderRow[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc('search_binders', {
      p_boroughs: null,
      p_subways: null,
      p_shop: null,
      p_city: null,
      p_card_codes: null,
    });
    setLoading(false);
    if (error) {
      console.warn('search_binders error', error.message);
      setRows([]);
      return;
    }
    const filtered = (data ?? []).filter((r: BinderRow) => r.category === category);
    setRows(filtered);
  }, [category]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <View style={styles.container}>
      <View style={styles.tabBar}>
        {BINDER_CATEGORIES.map((c) => (
          <Pressable
            key={c.value}
            onPress={() => setCategory(c.value)}
            style={[styles.tab, category === c.value && styles.tabActive]}>
            <Text style={[styles.tabText, category === c.value && styles.tabTextActive]}>{c.label}</Text>
          </Pressable>
        ))}
      </View>

      {loading && rows.length === 0 ? (
        <ActivityIndicator style={{ marginTop: 32 }} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.binder_id}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
          ListEmptyComponent={<Text style={styles.empty}>No binders yet.</Text>}
          renderItem={({ item }) => (
            <Pressable
              style={styles.row}
              onPress={() => router.push({ pathname: '/binder/[id]', params: { id: item.binder_id } })}>
              <Text style={styles.rowTitle}>{item.name}</Text>
              <Text style={styles.rowSub}>
                {item.display_name ?? 'unknown'} · {item.city ?? '—'}
                {item.boroughs?.length ? ` · ${item.boroughs.join(', ')}` : ''}
              </Text>
              {item.description ? <Text style={styles.rowDesc} numberOfLines={2}>{item.description}</Text> : null}
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  tabBar: { flexDirection: 'row', borderBottomWidth: 1, borderColor: '#eee' },
  tab: { flex: 1, padding: 12, alignItems: 'center' },
  tabActive: { borderBottomWidth: 2, borderColor: '#208AEF' },
  tabText: { color: '#666', fontWeight: '500' },
  tabTextActive: { color: '#208AEF', fontWeight: '700' },
  row: { padding: 16, borderBottomWidth: 1, borderColor: '#eee' },
  rowTitle: { fontSize: 16, fontWeight: '600' },
  rowSub: { fontSize: 13, color: '#666', marginTop: 2 },
  rowDesc: { fontSize: 13, color: '#444', marginTop: 4 },
  empty: { textAlign: 'center', marginTop: 48, color: '#888' },
});
