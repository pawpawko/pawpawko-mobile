import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  type TextStyle,
  View,
} from 'react-native';

import { DiceLoader } from '@/components/dice-loader';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { colors, fonts, radius } from '@/lib/theme';

type Game = 'optcg' | 'pokemon';

type TradeMatch = {
  game: Game;
  card_code: string;
  card_name: string | null;
  card_image_url: string | null;
  i_want_they_have: boolean;
  they_want_i_have: boolean;
  my_trade_binder_id: string | null;
  their_trade_binder_id: string | null;
  mutual: boolean;
};

const GAME_LABEL: Record<Game, string> = {
  optcg: 'ONE PIECE',
  pokemon: 'POKÉMON',
};
const GAME_ORDER: Game[] = ['optcg', 'pokemon'];

export default function TradeMatchesScreen() {
  const { partnerId } = useLocalSearchParams<{ partnerId: string }>();
  const { session } = useAuth();
  const router = useRouter();

  const [matches, setMatches] = useState<TradeMatch[] | null>(null);
  const [partnerName, setPartnerName] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!partnerId || !session?.user.id) return;
    let cancelled = false;
    (async () => {
      // Run both queries in parallel: partner profile + the two-way match set.
      const [partnerRes, matchesRes] = await Promise.all([
        supabase
          .from('profiles')
          .select('display_name')
          .eq('user_id', partnerId)
          .maybeSingle(),
        supabase.rpc('trade_matches', { p_partner_user_id: partnerId }),
      ]);
      if (cancelled) return;

      if (partnerRes.error) console.warn('partner profile', partnerRes.error.message);
      setPartnerName(partnerRes.data?.display_name ?? 'them');

      if (matchesRes.error) {
        setError(matchesRes.error.message);
        setMatches([]);
        return;
      }
      const rows = (matchesRes.data ?? []) as TradeMatch[];
      setMatches(rows);

      // Phase-2 history: record the tap. Same-day repeat upserts; FK-guarded
      // for non-real partner UUIDs so a bad scan won't pollute the row.
      supabase
        .rpc('record_trade_tap', {
          p_partner_user_id: partnerId,
          p_match_count: rows.length,
        })
        .then(({ error: histErr }) => {
          if (histErr) console.warn('record_trade_tap', histErr.message);
        });
    })();
    return () => {
      cancelled = true;
    };
  }, [partnerId, session?.user.id]);

  const sections = useMemo(() => {
    if (!matches) return [];
    const buckets: Record<Game, TradeMatch[]> = { optcg: [], pokemon: [] };
    for (const m of matches) {
      if (m.game === 'optcg' || m.game === 'pokemon') buckets[m.game].push(m);
    }
    return GAME_ORDER
      .filter((g) => buckets[g].length > 0)
      .map((g) => ({ game: g, title: GAME_LABEL[g], data: buckets[g] }));
  }, [matches]);

  const mutualCount = matches?.filter((m) => m.mutual).length ?? 0;

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          title: 'TRADE MATCHES',
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

      {matches === null ? (
        <View style={styles.loaderWrap}>
          <DiceLoader />
        </View>
      ) : error ? (
        <View style={styles.emptyWrap}>
          <Text style={styles.errorText}>Couldn't load matches.</Text>
          <Text style={styles.errorSub}>{error}</Text>
        </View>
      ) : matches.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Ionicons name="link-outline" size={32} color={colors.textMuted} />
          <Text style={styles.emptyTitle}>No matches with {partnerName}</Text>
          <Text style={styles.emptyBody}>
            Their trade binders don't have any cards you're looking for, and vice versa. Maybe next
            time!
          </Text>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(m) => `${m.game}-${m.card_code}`}
          stickySectionHeadersEnabled={false}
          ListHeaderComponent={
            <View style={styles.headerBlock}>
              <Text style={styles.headerTitle}>
                <Text style={styles.headerTitleAccent}>{matches.length}</Text>{' '}
                {matches.length === 1 ? 'match' : 'matches'} with{' '}
                <Text style={styles.headerTitleAccent}>{partnerName}</Text>
              </Text>
              {mutualCount > 0 ? (
                <Text style={styles.headerSub}>
                  ✨ {mutualCount} mutual — both sides want each other's cards
                </Text>
              ) : null}
            </View>
          }
          renderSectionHeader={({ section }) => (
            <View style={styles.sectionHeader}>
              <View style={styles.sectionLine} />
              <Text style={styles.sectionTitle}>{section.title}</Text>
              <View style={styles.sectionLine} />
            </View>
          )}
          renderItem={({ item }) => <MatchRow item={item} partnerName={partnerName} />}
          contentContainerStyle={{ paddingBottom: 32 }}
        />
      )}
    </View>
  );
}

function MatchRow({ item, partnerName }: { item: TradeMatch; partnerName: string }) {
  const router = useRouter();
  const targetBinderId = item.their_trade_binder_id ?? item.my_trade_binder_id;
  return (
    <Pressable
      onPress={() => {
        if (targetBinderId) {
          router.push({ pathname: '/binder/[id]', params: { id: targetBinderId } });
        }
      }}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
      {item.card_image_url ? (
        <Image source={{ uri: item.card_image_url }} style={styles.cardImg} contentFit="contain" />
      ) : (
        <View style={[styles.cardImg, styles.placeholder]} />
      )}

      <View style={styles.rowInfo}>
        <Text style={styles.cardName} numberOfLines={2}>
          {item.card_name ?? item.card_code}
        </Text>
        <Text style={styles.cardCode}>{item.card_code}</Text>

        <View style={styles.badgeRow}>
          {item.mutual ? (
            <View style={[styles.badge, styles.badgeMutual]}>
              <Text style={[styles.badgeText, styles.badgeMutualText]}>✨ MUTUAL</Text>
            </View>
          ) : (
            <>
              {item.i_want_they_have ? (
                <View style={[styles.badge, styles.badgeWant]}>
                  <Text style={[styles.badgeText, styles.badgeWantText]}>YOU WANT</Text>
                </View>
              ) : null}
              {item.they_want_i_have ? (
                <View style={[styles.badge, styles.badgeOffer]}>
                  <Text style={[styles.badgeText, styles.badgeOfferText]}>
                    {partnerName ? `${partnerName.toUpperCase()} WANTS` : 'THEY WANT'}
                  </Text>
                </View>
              ) : null}
            </>
          )}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgPrimary },
  loaderWrap: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
    gap: 10,
  },
  emptyTitle: {
    color: colors.textPrimary,
    fontFamily: fonts.serifBold,
    fontSize: 16,
    letterSpacing: 1,
    textAlign: 'center',
  },
  emptyBody: {
    color: colors.textMuted,
    fontFamily: fonts.body,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },
  errorText: {
    color: colors.danger,
    fontFamily: fonts.serifBold,
    fontSize: 14,
    letterSpacing: 1,
  },
  errorSub: {
    color: colors.textMuted,
    fontFamily: fonts.body,
    fontSize: 12,
    textAlign: 'center',
    paddingHorizontal: 24,
  },

  headerBlock: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 8,
    gap: 6,
  },
  headerTitle: {
    color: colors.textPrimary,
    fontFamily: fonts.body,
    fontSize: 16,
    lineHeight: 22,
  },
  headerTitleAccent: { color: colors.accent, fontFamily: fonts.serifBold, letterSpacing: 1 },
  headerSub: { color: colors.accent, fontFamily: fonts.body, fontSize: 12, letterSpacing: 1 },

  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  sectionLine: { flex: 1, height: 1, backgroundColor: colors.borderAccent, opacity: 0.5 },
  sectionTitle: {
    color: colors.accent,
    fontFamily: fonts.serifBold,
    letterSpacing: 4,
    fontSize: 12,
  },

  row: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  rowPressed: { backgroundColor: colors.bgSecondary },
  cardImg: {
    width: 64,
    aspectRatio: 0.72,
    borderRadius: radius.sm,
    backgroundColor: colors.bgCard,
  },
  placeholder: { borderWidth: 1, borderColor: colors.border },
  rowInfo: { flex: 1, gap: 3 },
  cardName: {
    color: colors.textPrimary,
    fontFamily: fonts.serifBold,
    fontSize: 14,
    letterSpacing: 0.5,
  },
  cardCode: { color: colors.accent, fontFamily: fonts.body, fontSize: 11, letterSpacing: 1 },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
  },
  badgeText: { fontFamily: fonts.serifBold, fontSize: 9, letterSpacing: 1.5 },
  badgeWant: { borderColor: colors.accent, backgroundColor: 'transparent' },
  badgeWantText: { color: colors.accent },
  badgeOffer: { borderColor: '#7ec96a', backgroundColor: 'transparent' },
  badgeOfferText: { color: '#7ec96a' },
  badgeMutual: { borderColor: colors.accent, backgroundColor: colors.accent },
  badgeMutualText: { color: colors.onAccent },
});
