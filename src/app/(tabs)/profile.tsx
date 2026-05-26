import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

export default function ProfileScreen() {
  const { session } = useAuth();

  return (
    <View style={styles.container}>
      <Text style={styles.label}>Signed in as</Text>
      <Text style={styles.email}>{session?.user.email ?? '—'}</Text>

      <Pressable style={styles.signOut} onPress={() => supabase.auth.signOut()}>
        <Text style={styles.signOutText}>Sign out</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 8, backgroundColor: '#fff' },
  label: { color: '#666', fontSize: 13 },
  email: { fontSize: 18, fontWeight: '600' },
  signOut: { marginTop: 24, padding: 14, borderRadius: 8, backgroundColor: '#eee', alignItems: 'center' },
  signOutText: { color: '#c00', fontWeight: '600' },
});
