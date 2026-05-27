import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  Modal,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { binderShareUrl } from '@/lib/slug';
import { supabase } from '@/lib/supabase';
import { colors, fonts, radius } from '@/lib/theme';

type BinderHeader = {
  id: string;
  binder_name: string | null;
  binder_description: string | null;
  display_name: string | null;
  category: string;
  flair: string;
};

type Listing = {
  id: string;
  card_code: string;
  quantity: number;
  listing_type: string;
  sort_order: number | null;
};

type CardInfo = {
  card_code: string;
  name: string | null;
  image_url: string | null;
  image_url_lg: string | null;
};

export default function BinderDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [header, setHeader] = useState<BinderHeader | null>(null);
  const [listings, setListings] = useState<Listing[]>([]);
  const [cards, setCards] = useState<Record<string, CardInfo>>({});
  const [loading, setLoading] = useState(true);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [shareOpen, setShareOpen] = useState(false);

  const shareUrl = id && header ? binderShareUrl(header.display_name, header.binder_name, id) : '';

  async function nativeShare() {
    try {
      await Share.share({ message: shareUrl, url: shareUrl });
    } catch {
      // user cancelled
    }
  }

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

      const head: BinderHeader | null = Array.isArray(hRes.data) ? hRes.data[0] : hRes.data;
      const lst: Listing[] = lRes.data ?? [];
      setHeader(head);
      setListings(lst);

      if (head && lst.length > 0) {
        const codes = Array.from(new Set(lst.map((l) => l.card_code)));
        const { data: cardRows, error: cErr } = await supabase
          .from('cards')
          .select('card_code,name,image_url,image_url_lg')
          .eq('game', head.category)
          .in('card_code', codes);
        if (cErr) console.warn('cards', cErr.message);
        const map: Record<string, CardInfo> = {};
        (cardRows ?? []).forEach((c: CardInfo) => {
          map[c.card_code] = c;
        });
        setCards(map);
      }

      setLoading(false);
    })();
  }, [id]);

  if (loading) {
    return (
      <View style={styles.loadingWrap}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }
  if (!header) return <Text style={styles.empty}>Binder not found.</Text>;

  return (
    <>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Pressable
              onPress={() => setShareOpen(true)}
              style={({ pressed }) => ({ paddingHorizontal: 12, opacity: pressed ? 0.6 : 1 })}
              accessibilityLabel="Share binder">
              <Ionicons name="share-social-outline" size={22} color={colors.accent} />
            </Pressable>
          ),
        }}
      />
      <FlatList
        style={{ backgroundColor: colors.bgPrimary }}
        data={listings}
        keyExtractor={(l) => l.id}
        numColumns={3}
        contentContainerStyle={styles.grid}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.title}>
              <Text style={styles.titleOwner}>{header.display_name ?? 'someone'}'s </Text>
              {header.binder_name ?? 'binder'}
            </Text>
            <Text style={styles.sub}>{header.category.toUpperCase()} · {header.flair}</Text>
          </View>
        }
        ListEmptyComponent={<Text style={styles.empty}>No listings.</Text>}
        renderItem={({ item, index }) => {
          const card = cards[item.card_code];
          return (
            <Pressable
              onPress={() => setExpandedIdx(index)}
              style={({ pressed }) => [styles.cell, pressed && styles.cellPressed]}>
              {card?.image_url ? (
                <Image source={{ uri: card.image_url }} style={styles.cardImg} contentFit="contain" />
              ) : (
                <View style={[styles.cardImg, styles.placeholder]} />
              )}
              <Text style={styles.cardCode}>{item.card_code}</Text>
              <Text style={styles.cardMeta}>
                ×{item.quantity} · {item.listing_type}
              </Text>
            </Pressable>
          );
        }}
      />

      <Modal visible={shareOpen} transparent animationType="fade" onRequestClose={() => setShareOpen(false)}>
        <Pressable style={styles.shareBackdrop} onPress={() => setShareOpen(false)}>
          <Pressable style={styles.shareCard} onPress={(e) => e.stopPropagation()}>
            <Pressable style={styles.shareCloseBtn} onPress={() => setShareOpen(false)}>
              <Ionicons name="close" size={24} color={colors.textPrimary} />
            </Pressable>
            <Text style={styles.shareTitle}>SHARE BINDER</Text>
            <View style={styles.qrWrap}>
              {shareUrl ? (
                <QRCode
                  value={shareUrl}
                  size={220}
                  backgroundColor={colors.textPrimary}
                  color={colors.bgPrimary}
                />
              ) : null}
            </View>
            <Text style={styles.shareUrl} numberOfLines={2}>{shareUrl}</Text>
            <Pressable
              style={({ pressed }) => [styles.shareBtn, pressed && styles.shareBtnPressed]}
              onPress={nativeShare}>
              <Ionicons name="share-outline" size={18} color={colors.bgPrimary} />
              <Text style={styles.shareBtnText}>SHARE LINK</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <CardPagerModal
        visible={expandedIdx !== null}
        onClose={() => setExpandedIdx(null)}
        listings={listings}
        cards={cards}
        initialIndex={expandedIdx ?? 0}
      />
    </>
  );
}

function CardPagerModal({
  visible,
  onClose,
  listings,
  cards,
  initialIndex,
}: {
  visible: boolean;
  onClose: () => void;
  listings: Listing[];
  cards: Record<string, CardInfo>;
  initialIndex: number;
}) {
  const [pageWidth, setPageWidth] = useState(Dimensions.get('window').width);
  const [currentIdx, setCurrentIdx] = useState(initialIndex);
  const listRef = useRef<FlatList<Listing>>(null);

  // Keep currentIdx synced with the initial index whenever the modal reopens
  useEffect(() => {
    if (visible) setCurrentIdx(initialIndex);
  }, [visible, initialIndex]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View
        style={styles.modalBackdrop}
        onLayout={(e) => setPageWidth(e.nativeEvent.layout.width)}>
        <Pressable style={styles.closeBtn} onPress={onClose}>
          <Ionicons name="close" size={28} color={colors.textPrimary} />
        </Pressable>

        <FlatList
          ref={listRef}
          data={listings}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          keyExtractor={(l) => l.id}
          initialScrollIndex={initialIndex}
          getItemLayout={(_, index) => ({ length: pageWidth, offset: pageWidth * index, index })}
          onMomentumScrollEnd={(e) => {
            const idx = Math.round(e.nativeEvent.contentOffset.x / pageWidth);
            setCurrentIdx(idx);
          }}
          renderItem={({ item }) => {
            const card = cards[item.card_code];
            return (
              <View style={[styles.pagerPage, { width: pageWidth }]}>
                {card?.image_url_lg || card?.image_url ? (
                  <Image
                    source={{ uri: card.image_url_lg ?? card.image_url! }}
                    style={styles.modalImg}
                    contentFit="contain"
                  />
                ) : (
                  <View style={[styles.modalImg, styles.placeholder]} />
                )}
                <Text style={styles.modalCardName}>{card?.name ?? item.card_code}</Text>
                <Text style={styles.modalCode}>{item.card_code}</Text>
                <View style={styles.modalRow}>
                  <Text style={styles.modalLabel}>QUANTITY</Text>
                  <Text style={styles.modalValue}>×{item.quantity}</Text>
                </View>
                <View style={styles.modalRow}>
                  <Text style={styles.modalLabel}>LISTING</Text>
                  <Text style={styles.modalValue}>{item.listing_type}</Text>
                </View>
              </View>
            );
          }}
        />

        <Text style={styles.pagerCount}>
          {currentIdx + 1} / {listings.length}
        </Text>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  loadingWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bgPrimary },
  grid: { padding: 8 },
  header: { padding: 12, marginBottom: 8 },
  title: { fontSize: 22, fontFamily: fonts.serifBold, color: colors.textPrimary, letterSpacing: 1 },
  titleOwner: { fontSize: 18, color: colors.textSecondary, fontFamily: fonts.body },
  sub: { color: colors.textMuted, marginTop: 4, fontFamily: fonts.body, letterSpacing: 1 },
  desc: { marginTop: 8, color: colors.textSecondary, fontFamily: fonts.body },
  cell: { flex: 1 / 3, padding: 4, alignItems: 'center' },
  cellPressed: { opacity: 0.7 },
  cardImg: { width: '100%', aspectRatio: 0.72, borderRadius: radius.sm, backgroundColor: colors.bgCard },
  placeholder: { borderWidth: 1, borderColor: colors.border },
  cardCode: { fontSize: 11, marginTop: 4, fontFamily: fonts.serifBold, color: colors.textPrimary, letterSpacing: 1 },
  cardMeta: { fontSize: 10, color: colors.textMuted, fontFamily: fonts.body },
  empty: { textAlign: 'center', marginTop: 48, color: colors.textMuted, fontFamily: fonts.body },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.95)' },
  closeBtn: { position: 'absolute', top: 40, right: 16, zIndex: 10, padding: 8 },
  pagerPage: { padding: 24, paddingTop: 80, alignItems: 'center', gap: 8 },
  modalImg: { width: '90%', aspectRatio: 0.72, borderRadius: radius.sm, backgroundColor: colors.bgCard },
  modalCardName: {
    fontSize: 18,
    fontFamily: fonts.serifBold,
    color: colors.textPrimary,
    letterSpacing: 1,
    textAlign: 'center',
    marginTop: 12,
  },
  modalCode: { fontSize: 13, color: colors.accent, fontFamily: fonts.body, letterSpacing: 2 },
  modalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignSelf: 'stretch',
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderTopWidth: 1,
    borderColor: colors.border,
    marginTop: 4,
  },
  modalLabel: { color: colors.textMuted, fontFamily: fonts.serif, letterSpacing: 2, fontSize: 11 },
  modalValue: { color: colors.textPrimary, fontFamily: fonts.body, fontSize: 14 },
  shareBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', padding: 24 },
  shareCard: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderAccent,
    padding: 24,
    alignItems: 'center',
    gap: 14,
  },
  shareCloseBtn: { position: 'absolute', top: 8, right: 8, padding: 8, zIndex: 1 },
  shareTitle: { color: colors.accent, fontFamily: fonts.serifBold, letterSpacing: 3, fontSize: 14 },
  qrWrap: { padding: 16, backgroundColor: colors.textPrimary, borderRadius: radius.sm },
  shareUrl: { color: colors.textMuted, fontFamily: fonts.body, fontSize: 12, textAlign: 'center' },
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
  shareBtnText: { color: colors.bgPrimary, fontFamily: fonts.serifBold, letterSpacing: 2, fontSize: 13 },

  pagerCount: {
    position: 'absolute',
    bottom: 24,
    alignSelf: 'center',
    color: colors.textMuted,
    fontFamily: fonts.serif,
    letterSpacing: 3,
    fontSize: 13,
  },
});
