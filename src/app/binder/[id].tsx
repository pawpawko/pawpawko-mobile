import { Image } from 'expo-image';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';

import { supabase } from '@/lib/supabase';

type BinderHeader = {
  id: string;
  name: string;
  description: string | null;
  display_name: string | null;
  category: string;
  flair: string;
};

type Listing = {
  id: string;
  card_code: string;
  quantity: number;
  listing_type: string;
  notes: string | null;
  image_url: string | null;
  card_name: string | null;
};

export default function BinderDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [header, setHeader] = useState<BinderHeader | null>(null);
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    (async () => {
      setLoading(true);
      const [hRes, lRes] = await Promise.all([
        supabase.rpc('get_binder_public', { p_binder_id: id }),
        supabase.rpc('get_binder_listings_public', { p_binder_id: id }),
      ]);
      if (hRes.error) console.warn('header', hRes.error.message);
      if (lRes.error) console.warn('listings', lRes.error.message);
      setHeader(Array.isArray(hRes.data) ? hRes.data[0] : hRes.data);
      setListings(lRes.data ?? []);
      setLoading(false);
    })();
  }, [id]);

  if (loading) return <ActivityIndicator style={{ marginTop: 32 }} />;
  if (!header) return <Text style={styles.empty}>Binder not found.</Text>;

  return (
    <FlatList
      data={listings}
      keyExtractor={(l) => l.id}
      numColumns={3}
      contentContainerStyle={styles.grid}
      ListHeaderComponent={
        <View style={styles.header}>
          <Text style={styles.title}>{header.name}</Text>
          <Text style={styles.sub}>by {header.display_name ?? 'unknown'} · {header.category.toUpperCase()}</Text>
          {header.description ? <Text style={styles.desc}>{header.description}</Text> : null}
        </View>
      }
      ListEmptyComponent={<Text style={styles.empty}>No listings.</Text>}
      renderItem={({ item }) => (
        <View style={styles.cell}>
          {item.image_url ? (
            <Image source={{ uri: item.image_url }} style={styles.cardImg} contentFit="contain" />
          ) : (
            <View style={[styles.cardImg, styles.placeholder]} />
          )}
          <Text style={styles.cardCode}>{item.card_code}</Text>
          <Text style={styles.cardMeta}>×{item.quantity} · {item.listing_type}</Text>
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  grid: { padding: 8 },
  header: { padding: 12, marginBottom: 8 },
  title: { fontSize: 20, fontWeight: '700' },
  sub: { color: '#666', marginTop: 4 },
  desc: { marginTop: 8, color: '#333' },
  cell: { flex: 1 / 3, padding: 4, alignItems: 'center' },
  cardImg: { width: '100%', aspectRatio: 0.72, borderRadius: 4, backgroundColor: '#f4f4f4' },
  placeholder: { borderWidth: 1, borderColor: '#ddd' },
  cardCode: { fontSize: 11, marginTop: 4, fontWeight: '600' },
  cardMeta: { fontSize: 10, color: '#666' },
  empty: { textAlign: 'center', marginTop: 48, color: '#888' },
});
