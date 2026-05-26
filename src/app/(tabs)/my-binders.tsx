import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

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
        <ActivityIndicator style={{ marginTop: 32 }} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.id}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
          ListEmptyComponent={<Text style={styles.empty}>No binders yet.</Text>}
          renderItem={({ item }) => (
            <Pressable
              style={styles.row}
              onPress={() => router.push({ pathname: '/binder/[id]', params: { id: item.id } })}>
              <Text style={styles.rowTitle}>{item.name}</Text>
              <Text style={styles.rowSub}>
                {item.category.toUpperCase()} · {item.flair}
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
  row: { padding: 16, borderBottomWidth: 1, borderColor: '#eee' },
  rowTitle: { fontSize: 16, fontWeight: '600' },
  rowSub: { fontSize: 13, color: '#666', marginTop: 2 },
  rowDesc: { fontSize: 13, color: '#444', marginTop: 4 },
  empty: { textAlign: 'center', marginTop: 48, color: '#888' },
});
