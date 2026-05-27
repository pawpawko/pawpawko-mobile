import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { DiceLoader } from '@/components/dice-loader';

import {
  BINDER_CATEGORIES,
  BOROUGHS_BY_CITY,
  CITIES,
  type BinderCategory,
} from '@/lib/constants';
import { supabase } from '@/lib/supabase';
import { colors, fonts, radius } from '@/lib/theme';

type BinderRow = {
  binder_id: string;
  user_id: string;
  display_name: string | null;
  binder_name: string | null;
  binder_description: string | null;
  category: BinderCategory;
  flair: string;
  matched_card_count: number | null;
  last_updated_at: string | null;
};

// NYC major subway stops (flat list — borough grouping only matters on web)
const NYC_SUBWAY_STOPS = [
  'Times Sq-42 St', 'Grand Central-42 St', '34 St-Penn Station', '34 St-Herald Sq',
  'Union Sq-14 St', '14 St-8 Av', 'Columbus Circle-59 St', '86 St (Lex)', '96 St (Lex)',
  '125 St', 'Fulton St', 'Canal St', 'Chambers St', 'World Trade Center',
  'Atlantic Av-Barclays Ctr', 'Jay St-MetroTech', 'DeKalb Av', 'Bedford Av',
  'Borough Hall', 'Prospect Park', 'Coney Island-Stillwell Av',
  'Flatbush Av-Brooklyn College', 'Hoyt-Schermerhorn',
  'Court Sq-23 St', 'Queensboro Plaza', 'Jackson Hts-Roosevelt Av',
  'Forest Hills-71 Av', 'Flushing-Main St', 'Jamaica Ctr-Parsons/Archer',
  'Astoria-Ditmars Blvd', '149 St-Grand Concourse', 'Yankee Stadium-161 St',
  'Fordham Rd', 'Pelham Bay Park', 'St George',
];

const LAST_GAME_KEY = 'pawpaw:lastGame';

export default function TradesScreen() {
  const router = useRouter();

  const [category, setCategory] = useState<BinderCategory>('optcg');
  const [cardsInput, setCardsInput] = useState('');
  const [city, setCity] = useState<string>(''); // '' = Any
  const [boroughs, setBoroughs] = useState<string[]>([]);
  const [subways, setSubways] = useState<string[]>([]);
  const [shop, setShop] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);

  const [rows, setRows] = useState<BinderRow[]>([]);
  const [loading, setLoading] = useState(false);

  // Restore last-game choice
  useEffect(() => {
    AsyncStorage.getItem(LAST_GAME_KEY).then((g) => {
      if (g === 'optcg' || g === 'pokemon') setCategory(g);
    });
  }, []);

  // Persist game choice; reset boroughs/subway when leaving NYC
  useEffect(() => {
    AsyncStorage.setItem(LAST_GAME_KEY, category);
  }, [category]);

  useEffect(() => {
    if (city !== 'nyc') setSubways([]);
    setBoroughs((prev) => prev.filter((b) => (BOROUGHS_BY_CITY[city] ?? []).includes(b)));
  }, [city]);

  const parseCards = useCallback(() => {
    const raw = cardsInput
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (raw.length === 0) return null;
    // OPTCG uppercase, Pokémon lowercase (matches search_binders RPC expectations)
    return raw.map((c) => (category === 'pokemon' ? c.toLowerCase() : c.toUpperCase()));
  }, [cardsInput, category]);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc('search_binders', {
      p_boroughs: boroughs.length ? boroughs : null,
      p_subways: subways.length ? subways : null,
      p_shop: shop.trim() || null,
      p_category: category,
      p_city: city || null,
      p_card_codes: parseCards(),
    });
    setLoading(false);
    if (error) {
      console.warn('search_binders error', error.message);
      setRows([]);
      return;
    }
    setRows((data ?? []) as BinderRow[]);
  }, [boroughs, subways, shop, city, category, parseCards]);

  useEffect(() => {
    load();
  }, [category]); // reload list when game tab changes

  function clearFilters() {
    setCardsInput('');
    setCity('');
    setBoroughs([]);
    setSubways([]);
    setShop('');
  }

  function toggleBorough(b: string) {
    setBoroughs((prev) => (prev.includes(b) ? prev.filter((x) => x !== b) : [...prev, b]));
  }
  function toggleSubway(s: string) {
    setSubways((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  }

  const availableBoroughs = city ? BOROUGHS_BY_CITY[city] ?? [] : [];

  return (
    <View style={styles.container}>
      {/* Game category tabs */}
      <View style={styles.tabBar}>
        {BINDER_CATEGORIES.map((c) => (
          <Pressable
            key={c.value}
            onPress={() => setCategory(c.value)}
            style={[styles.tab, category === c.value && styles.tabActive]}>
            <Text style={[styles.tabText, category === c.value && styles.tabTextActive]}>
              {c.label.toUpperCase()}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Filters toggle bar */}
      <Pressable style={styles.filterToggle} onPress={() => setFiltersOpen((o) => !o)}>
        <Ionicons name="options-outline" size={16} color={colors.accent} />
        <Text style={styles.filterToggleText}>{filtersOpen ? 'Hide filters' : 'Filters'}</Text>
        <Ionicons name={filtersOpen ? 'chevron-up' : 'chevron-down'} size={16} color={colors.accent} />
      </Pressable>

      {filtersOpen ? (
        <ScrollView style={styles.filtersWrap} contentContainerStyle={styles.filters}>
          <Text style={styles.label}>CARDS</Text>
          <TextInput
            value={cardsInput}
            onChangeText={setCardsInput}
            placeholder={category === 'pokemon' ? 'sv1-1, sv3pt5-160, …' : 'OP01-001, ST15-003, …'}
            placeholderTextColor={colors.textMuted}
            autoCapitalize={category === 'pokemon' ? 'none' : 'characters'}
            autoCorrect={false}
            style={styles.input}
          />

          <Text style={styles.label}>CITY</Text>
          <View style={styles.chipRow}>
            <Chip label="Any" active={!city} onPress={() => setCity('')} />
            {CITIES.map((c) => (
              <Chip key={c.value} label={c.label} active={city === c.value} onPress={() => setCity(c.value)} />
            ))}
          </View>

          {availableBoroughs.length > 0 ? (
            <>
              <Text style={styles.label}>BOROUGH</Text>
              <View style={styles.chipRow}>
                {availableBoroughs.map((b) => (
                  <Chip key={b} label={b} active={boroughs.includes(b)} onPress={() => toggleBorough(b)} />
                ))}
              </View>
            </>
          ) : null}

          {city === 'nyc' ? (
            <>
              <Text style={styles.label}>SUBWAY STOP</Text>
              <View style={styles.chipRow}>
                {NYC_SUBWAY_STOPS.map((s) => (
                  <Chip key={s} label={s} active={subways.includes(s)} onPress={() => toggleSubway(s)} />
                ))}
              </View>
            </>
          ) : null}

          <Text style={styles.label}>LOCAL CARD SHOP</Text>
          <TextInput
            value={shop}
            onChangeText={setShop}
            placeholder="e.g. The Comic Lab"
            placeholderTextColor={colors.textMuted}
            style={styles.input}
          />

          <View style={styles.filterButtons}>
            <Pressable style={({ pressed }) => [styles.applyBtn, pressed && styles.applyBtnPressed]} onPress={() => { setFiltersOpen(false); load(); }}>
              <Text style={styles.applyBtnText}>APPLY</Text>
            </Pressable>
            <Pressable style={({ pressed }) => [styles.clearBtn, pressed && styles.clearBtnPressed]} onPress={clearFilters}>
              <Text style={styles.clearBtnText}>CLEAR</Text>
            </Pressable>
          </View>
        </ScrollView>
      ) : null}

      {/* Results */}
      {loading && rows.length === 0 ? (
        <View style={styles.loaderWrap}>
          <DiceLoader />
          <Text style={styles.loaderText}>Rolling…</Text>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.binder_id}
          refreshControl={
            <RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.accent} />
          }
          ListHeaderComponent={
            <Text style={styles.resultsCount}>
              {loading ? 'Searching…' : `${rows.length} binder${rows.length === 1 ? '' : 's'}`}
            </Text>
          }
          ListEmptyComponent={<Text style={styles.empty}>No binders match.</Text>}
          renderItem={({ item }) => (
            <Pressable
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              onPress={() => router.push({ pathname: '/binder/[id]', params: { id: item.binder_id } })}>
              <View style={styles.rowHeader}>
                <Text style={styles.rowTitle}>
                  <Text style={styles.rowOwner}>{item.display_name ?? 'someone'}'s </Text>
                  <Text style={styles.rowBinderName}>{item.binder_name ?? 'binder'}</Text>
                </Text>
                {item.matched_card_count ? (
                  <View style={styles.matchBadge}>
                    <Text style={styles.matchBadgeText}>{item.matched_card_count}</Text>
                  </View>
                ) : null}
              </View>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.chip, active && styles.chipActive, pressed && styles.chipPressed]}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgPrimary },
  tabBar: { flexDirection: 'row', borderBottomWidth: 1, borderColor: colors.border, backgroundColor: colors.bgSecondary },
  tab: { flex: 1, paddingVertical: 14, alignItems: 'center' },
  tabActive: { borderBottomWidth: 2, borderColor: colors.accent },
  tabText: { color: colors.textSecondary, fontFamily: fonts.serif, letterSpacing: 2, fontSize: 12 },
  tabTextActive: { color: colors.accent },

  filterToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgSecondary,
  },
  filterToggleText: { color: colors.accent, fontFamily: fonts.serif, letterSpacing: 2, fontSize: 12 },

  filtersWrap: { maxHeight: '60%', backgroundColor: colors.bgSecondary, borderBottomWidth: 1, borderColor: colors.border },
  filters: { padding: 16, gap: 8 },
  label: { color: colors.textMuted, fontFamily: fonts.serif, letterSpacing: 2, fontSize: 11, marginTop: 6 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgCard,
    borderRadius: radius.sm,
    padding: 10,
    color: colors.textPrimary,
    fontFamily: fonts.body,
    fontSize: 14,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgCard,
  },
  chipActive: { borderColor: colors.accent, backgroundColor: colors.bgCardHover },
  chipPressed: { opacity: 0.7 },
  chipText: { color: colors.textSecondary, fontFamily: fonts.body, fontSize: 12 },
  chipTextActive: { color: colors.accent },

  filterButtons: { flexDirection: 'row', gap: 8, marginTop: 12 },
  applyBtn: { flex: 1, padding: 12, borderRadius: radius.sm, backgroundColor: colors.accent, alignItems: 'center' },
  applyBtnPressed: { backgroundColor: colors.accentLight },
  applyBtnText: { color: colors.bgPrimary, fontFamily: fonts.serifBold, letterSpacing: 2, fontSize: 13 },
  clearBtn: { flex: 1, padding: 12, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.borderAccent, alignItems: 'center' },
  clearBtnPressed: { backgroundColor: colors.bgCard },
  clearBtnText: { color: colors.accent, fontFamily: fonts.serifBold, letterSpacing: 2, fontSize: 13 },

  resultsCount: { padding: 12, color: colors.textMuted, fontFamily: fonts.body, fontSize: 13 },
  row: { paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderColor: colors.border },
  rowPressed: { backgroundColor: colors.bgSecondary },
  rowHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowTitle: { flex: 1 },
  rowOwner: { fontSize: 14, color: colors.textSecondary, fontFamily: fonts.body },
  rowBinderName: { fontSize: 16, fontFamily: fonts.serifBold, color: colors.textPrimary, letterSpacing: 1 },
  rowDesc: { fontSize: 13, color: colors.textSecondary, marginTop: 6, fontFamily: fonts.body },
  matchBadge: {
    backgroundColor: colors.accent,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    marginLeft: 8,
  },
  matchBadgeText: { color: colors.bgPrimary, fontFamily: fonts.serifBold, fontSize: 11 },
  empty: { textAlign: 'center', marginTop: 48, color: colors.textMuted, fontFamily: fonts.body },
  loaderWrap: { alignItems: 'center', justifyContent: 'center', paddingVertical: 48, gap: 8 },
  loaderText: { color: colors.textMuted, fontFamily: fonts.serif, letterSpacing: 3, fontSize: 12 },
});
