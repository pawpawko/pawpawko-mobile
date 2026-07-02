import { Ionicons } from '@expo/vector-icons';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, type ReactNode } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, type TextStyle, View } from 'react-native';

import { useAuth } from '@/lib/auth';
import { useNotifications, type AppNotification } from '@/lib/notifications-context';
import { supabase } from '@/lib/supabase';
import { fonts, type Palette } from '@/lib/theme';
import { useTheme } from '@/lib/theme-context';

export default function NotificationsScreen() {
  const router = useRouter();
  const { items, reload, markAllRead, dismiss, respond } = useNotifications();
  const { session } = useAuth();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  // Opening the screen marks everything read (clears the bell badge), mirroring
  // the web dropdown behaviour.
  useFocusEffect(
    useCallback(() => {
      reload().then(() => markAllRead());
    }, [reload, markAllRead]),
  );

  const onRespond = (n: AppNotification, accept: boolean) => {
    const kind = n.type === 'deck_invite' ? 'deck' : 'binder';
    if (kind === 'binder' && accept) {
      Alert.alert(
        'Accept shared binder?',
        "Your own trade binder for that game will be merged into the shared one (nothing is lost) and you'll co-edit it together.",
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Accept',
            onPress: async () => {
              const err = await respond(n.id, true, 'binder');
              if (err) Alert.alert('Could not accept', err);
            },
          },
        ],
      );
      return;
    }
    if (kind === 'deck' && accept) {
      acceptDeck(n);
      return;
    }
    respond(n.id, accept, kind).then((err) => {
      if (err) Alert.alert('Something went wrong', err);
    });
  };

  // Accepting a deck invite REPLACES the recipient's own deck for this leader
  // (the server deletes it). Warn first when such a deck actually exists.
  const acceptDeck = async (n: AppNotification) => {
    const d = n.data || {};
    const doAccept = async () => {
      const err = await respond(n.id, true, 'deck');
      if (err) Alert.alert('Could not accept', err);
    };
    const uid = session?.user.id;
    if (uid && d.leader_card_code && d.game) {
      const { data } = await supabase
        .from('decks')
        .select('id,name')
        .eq('user_id', uid)
        .eq('game', d.game)
        .eq('leader_card_code', d.leader_card_code)
        .limit(1);
      const mine = (data as { id: string; name: string }[] | null)?.[0];
      if (mine && mine.id !== d.deck_id) {
        Alert.alert(
          'Replace your own deck?',
          `Accepting permanently deletes your own deck "${mine.name}" for this leader — you'll co-edit "${d.deck_name}" instead.`,
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Replace', style: 'destructive', onPress: doAccept },
          ],
        );
        return;
      }
    }
    doAccept();
  };

  const openDeck = (deckId?: string) => {
    if (deckId) router.push({ pathname: '/deck/[id]', params: { id: deckId } });
  };

  const renderItem = ({ item: n }: { item: AppNotification }) => {
    const d = n.data || {};
    let body: ReactNode = null;
    let pending = false;
    let deckId = '';

    switch (n.type) {
      case 'binder_invite':
        if (n.status === 'pending') {
          pending = true;
          body = (
            <Text style={styles.text}>
              <Text style={styles.strong}>{d.from_name}</Text> wants to share their binder{' '}
              <Text style={styles.strong}>{d.binder_name}</Text> with you.
            </Text>
          );
        } else {
          body = (
            <Text style={styles.text}>
              You {n.status} sharing <Text style={styles.strong}>{d.binder_name}</Text>.
            </Text>
          );
        }
        break;
      case 'binder_invite_accepted':
        body = (
          <Text style={styles.text}>
            <Text style={styles.strong}>{d.by_name}</Text> accepted your shared binder{' '}
            <Text style={styles.strong}>{d.binder_name}</Text>.
          </Text>
        );
        break;
      case 'binder_invite_declined':
        body = (
          <Text style={styles.text}>
            <Text style={styles.strong}>{d.by_name}</Text> declined your shared binder{' '}
            <Text style={styles.strong}>{d.binder_name}</Text>.
          </Text>
        );
        break;
      case 'deck_invite':
        if (n.status === 'pending') {
          pending = true;
          body = (
            <Text style={styles.text}>
              <Text style={styles.strong}>{d.from_name}</Text> wants to share their deck{' '}
              <Text style={styles.strong}>{d.deck_name}</Text> with you.
            </Text>
          );
        } else {
          body = (
            <Text style={styles.text}>
              You {n.status} sharing deck <Text style={styles.strong}>{d.deck_name}</Text>.
            </Text>
          );
        }
        break;
      case 'deck_invite_accepted':
        deckId = d.deck_id || '';
        body = (
          <Text style={styles.text}>
            <Text style={styles.strong}>{d.by_name}</Text> accepted your shared deck{' '}
            <Text style={styles.strong}>{d.deck_name}</Text>.
          </Text>
        );
        break;
      case 'deck_invite_declined':
        body = (
          <Text style={styles.text}>
            <Text style={styles.strong}>{d.by_name}</Text> declined your shared deck{' '}
            <Text style={styles.strong}>{d.deck_name}</Text>.
          </Text>
        );
        break;
      case 'deck_card_collected': {
        deckId = d.deck_id || '';
        const qty = Number(d.qty) > 1 ? ` ×${d.qty}` : '';
        body = (
          <Text style={styles.text}>
            <Text style={styles.strong}>{d.by_name}</Text> got{' '}
            <Text style={styles.strong}>{d.card_name}</Text>
            {qty} — <Text style={styles.strong}>{d.deck_name}</Text> and your wishlist updated.
          </Text>
        );
        break;
      }
      default:
        return null;
    }

    const tappable = !!deckId;

    return (
      <Pressable
        disabled={!tappable}
        onPress={() => openDeck(deckId)}
        style={({ pressed }) => [styles.row, tappable && pressed ? styles.rowPressed : null]}>
        <View style={styles.bodyWrap}>{body}</View>
        {pending ? (
          <View style={styles.actions}>
            <Pressable style={[styles.btn, styles.btnAccept]} onPress={() => onRespond(n, true)}>
              <Text style={styles.btnAcceptText}>Accept</Text>
            </Pressable>
            <Pressable style={[styles.btn, styles.btnDecline]} onPress={() => onRespond(n, false)}>
              <Text style={styles.btnDeclineText}>Decline</Text>
            </Pressable>
          </View>
        ) : null}
        <Pressable
          onPress={() => dismiss(n.id)}
          hitSlop={10}
          style={styles.dismiss}
          accessibilityLabel="Dismiss">
          <Ionicons name="close" size={16} color={colors.textMuted} />
        </Pressable>
      </Pressable>
    );
  };

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          title: 'NOTIFICATIONS',
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
      <FlatList
        data={items}
        keyExtractor={(n) => n.id}
        renderItem={renderItem}
        ListEmptyComponent={<Text style={styles.empty}>No notifications yet.</Text>}
        contentContainerStyle={items.length === 0 ? styles.emptyWrap : undefined}
      />
    </View>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgPrimary },
  row: {
    paddingVertical: 14,
    paddingLeft: 16,
    paddingRight: 38, // room for the × dismiss
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  rowPressed: { backgroundColor: colors.bgSecondary },
  bodyWrap: {},
  text: { color: colors.textPrimary, fontFamily: fonts.body, fontSize: 14, lineHeight: 21 },
  strong: { fontFamily: fonts.bodyBold, color: colors.textPrimary },
  actions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  btn: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 999, borderWidth: 1 },
  btnAccept: { backgroundColor: colors.accent, borderColor: colors.accent },
  btnAcceptText: { color: colors.onAccent, fontFamily: fonts.bodyBold, fontSize: 13 },
  btnDecline: { borderColor: colors.border },
  btnDeclineText: { color: colors.textSecondary, fontFamily: fonts.body, fontSize: 13 },
  dismiss: { position: 'absolute', top: 10, right: 10, padding: 4 },
  empty: { textAlign: 'center', color: colors.textMuted, fontFamily: fonts.body, paddingHorizontal: 24 },
  emptyWrap: { flexGrow: 1, justifyContent: 'center' },
});
