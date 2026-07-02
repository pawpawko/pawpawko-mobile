import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { DiceLoader } from '@/components/dice-loader';
import { FlairPill } from '@/components/flair-pill';

import {
  BINDER_CATEGORIES,
  BOROUGHS_BY_CITY,
  CITIES,
  type BinderCategory,
} from '@/lib/constants';
import { supabase } from '@/lib/supabase';
import { fonts, radius, type Palette } from '@/lib/theme';
import { useTheme } from '@/lib/theme-context';

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
  const listRef = useRef<FlatList<BinderRow>>(null);

  useFocusEffect(
    useCallback(() => {
      listRef.current?.scrollToOffset({ offset: 0, animated: false });
    }, []),
  );

  const [category, setCategory] = useState<BinderCategory>('optcg');
  const [cardsInput, setCardsInput] = useState('');
  const [city, setCity] = useState<string>(''); // '' = Any
  const [boroughs, setBoroughs] = useState<string[]>([]);
  const [subways, setSubways] = useState<string[]>([]);
  const [shop, setShop] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);

  const [rows, setRows] = useState<BinderRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  // Restore last-game choice
  useEffect(() => {
    AsyncStorage.getItem(LAST_GAME_KEY).then((g) => {
      if (g === 'optcg' || g === 'pokemon' || g === 'cyberpunk') setCategory(g);
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
    // OPTCG uppercase; Pokémon + Cyberpunk (cb-…) lowercase — matches
    // search_binders RPC / card_code casing per game.
    return raw.map((c) =>
      category === 'pokemon' || category === 'cyberpunk' ? c.toLowerCase() : c.toUpperCase(),
    );
  }, [cardsInput, category]);

  const load = useCallback(
    async (mode: 'initial' | 'pull' = 'initial') => {
      if (mode === 'initial') setLoading(true);
      if (mode === 'pull') setRefreshing(true);
      const { data, error } = await supabase.rpc('search_binders', {
        p_boroughs: boroughs.length ? boroughs : null,
        p_subways: subways.length ? subways : null,
        p_shop: shop.trim() || null,
        p_category: category,
        p_city: city || null,
        p_card_codes: parseCards(),
      });
      if (mode === 'initial') setLoading(false);
      if (mode === 'pull') setRefreshing(false);
      if (error) {
        console.warn('search_binders error', error.message);
        setRows([]);
        return;
      }
      setRows((data ?? []) as BinderRow[]);
    },
    [boroughs, subways, shop, city, category, parseCards],
  );

  useEffect(() => {
    // Clear the prior game's results so the DiceLoader shows during the
    // refetch instead of the RefreshControl spinner over stale rows.
    setRows([]);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category]);

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
      <Pressable
        style={styles.filterToggle}
        onPress={() => {
          // Closing the panel applies the current filter set — saves the user
          // an extra tap on APPLY.
          if (filtersOpen) load();
          setFiltersOpen((o) => !o);
        }}>
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
            placeholder={
              category === 'pokemon'
                ? 'sv1-1, sv3pt5-160, …'
                : category === 'cyberpunk'
                  ? 'cb-v-streetkid-wnc-005a, …'
                  : 'OP01-001, ST15-003, …'
            }
            placeholderTextColor={colors.textMuted}
            autoCapitalize={
              category === 'pokemon' || category === 'cyberpunk' ? 'none' : 'characters'
            }
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
              <Text style={styles.label}>SUBWAY STOPS</Text>
              <MultiSelectField
                label="Subway stops"
                options={NYC_SUBWAY_STOPS}
                selected={subways}
                onChange={setSubways}
                emptyLabel="Any"
              />
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
      <View style={styles.resultsWrap}>
      {loading && rows.length === 0 ? (
        <View style={styles.loaderWrap}>
          <DiceLoader />
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={rows}
          keyExtractor={(r) => r.binder_id}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => load('pull')}
              tintColor={colors.accent}
            />
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
                    <Text style={styles.matchBadgeText}>
                      {item.matched_card_count} {item.matched_card_count === 1 ? 'MATCH' : 'MATCHES'}
                    </Text>
                  </View>
                ) : null}
              </View>
              <View style={styles.rowPills}>
                <FlairPill value={item.flair} kind="flair" size="sm" />
              </View>
            </Pressable>
          )}
        />
      )}
      {filtersOpen ? (
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => {
            load();
            setFiltersOpen(false);
          }}
        />
      ) : null}
      </View>
    </View>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.chip, active && styles.chipActive, pressed && styles.chipPressed]}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

function MultiSelectField({
  label,
  options,
  selected,
  onChange,
  emptyLabel = 'Any',
}: {
  label: string;
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  emptyLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const summary =
    selected.length === 0
      ? emptyLabel
      : selected.length === 1
        ? selected[0]
        : `${selected.length} selected`;

  function toggle(value: string) {
    if (selected.includes(value)) {
      onChange(selected.filter((s) => s !== value));
    } else {
      onChange([...selected, value]);
    }
  }

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        style={({ pressed }) => [styles.dropdown, pressed && { opacity: 0.7 }]}>
        <Text
          style={[
            styles.dropdownValue,
            selected.length === 0 && styles.dropdownValueEmpty,
          ]}
          numberOfLines={1}>
          {summary}
        </Text>
        <Ionicons name="chevron-down" size={16} color={colors.textMuted} />
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setOpen(false)}>
          <Pressable style={styles.sheetCard} onPress={(e) => e.stopPropagation()}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>{label.toUpperCase()}</Text>
              <Pressable onPress={() => setOpen(false)}>
                <Ionicons name="close" size={24} color={colors.textPrimary} />
              </Pressable>
            </View>
            <FlatList
              data={options}
              keyExtractor={(v, i) => `${i}-${v}`}
              renderItem={({ item }) => {
                const active = selected.includes(item);
                return (
                  <Pressable
                    onPress={() => toggle(item)}
                    style={({ pressed }) => [
                      styles.sheetRow,
                      active && styles.sheetRowActive,
                      pressed && { opacity: 0.7 },
                    ]}>
                    <Text style={[styles.sheetRowText, active && styles.sheetRowTextActive]}>
                      {item}
                    </Text>
                    {active ? (
                      <Ionicons name="checkmark" size={18} color={colors.accent} />
                    ) : null}
                  </Pressable>
                );
              }}
            />
            <View style={styles.sheetFooter}>
              {selected.length > 0 ? (
                <Pressable
                  onPress={() => onChange([])}
                  style={({ pressed }) => [styles.sheetFooterBtn, pressed && { opacity: 0.7 }]}>
                  <Text style={styles.sheetFooterBtnText}>CLEAR ALL</Text>
                </Pressable>
              ) : (
                <View style={{ flex: 1 }} />
              )}
              <Pressable
                onPress={() => setOpen(false)}
                style={({ pressed }) => [styles.sheetDoneBtn, pressed && { opacity: 0.7 }]}>
                <Text style={styles.sheetDoneBtnText}>DONE</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
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

  dropdown: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgCard,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  dropdownValue: {
    flex: 1,
    color: colors.textPrimary,
    fontFamily: fonts.body,
    fontSize: 14,
  },
  dropdownValueEmpty: { color: colors.textMuted },

  sheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    padding: 24,
  },
  sheetCard: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderAccent,
    paddingVertical: 12,
    maxHeight: '75%',
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  sheetTitle: {
    color: colors.accent,
    fontFamily: fonts.serifBold,
    letterSpacing: 3,
    fontSize: 14,
  },
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  sheetRowActive: { backgroundColor: colors.bgCardHover },
  sheetRowText: { color: colors.textPrimary, fontFamily: fonts.body, fontSize: 15 },
  sheetRowTextActive: { color: colors.accent, fontFamily: fonts.serifBold },
  sheetFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingTop: 12,
    paddingHorizontal: 20,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  sheetFooterBtn: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.borderAccent,
  },
  sheetFooterBtnText: {
    color: colors.accent,
    fontFamily: fonts.serifBold,
    letterSpacing: 2,
    fontSize: 12,
  },
  sheetDoneBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: radius.sm,
    backgroundColor: colors.accent,
    alignItems: 'center',
  },
  sheetDoneBtnText: {
    color: colors.onAccent,
    fontFamily: fonts.serifBold,
    letterSpacing: 2,
    fontSize: 13,
  },
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
  applyBtnText: { color: colors.onAccent, fontFamily: fonts.serifBold, letterSpacing: 2, fontSize: 13 },
  clearBtn: { flex: 1, padding: 12, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.borderAccent, alignItems: 'center' },
  clearBtnPressed: { backgroundColor: colors.bgCard },
  clearBtnText: { color: colors.accent, fontFamily: fonts.serifBold, letterSpacing: 2, fontSize: 13 },

  resultsWrap: { flex: 1 },
  resultsCount: { padding: 12, color: colors.textMuted, fontFamily: fonts.body, fontSize: 13 },
  row: { paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderColor: colors.border },
  rowPressed: { backgroundColor: colors.bgSecondary },
  rowHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowTitle: { flex: 1 },
  rowOwner: { fontSize: 14, color: colors.textSecondary, fontFamily: fonts.body },
  rowBinderName: { fontSize: 16, fontFamily: fonts.serifBold, color: colors.textPrimary, letterSpacing: 1 },
  rowPills: { flexDirection: 'row', gap: 6, marginTop: 6 },
  rowDesc: { fontSize: 13, color: colors.textSecondary, marginTop: 6, fontFamily: fonts.body },
  matchBadge: {
    backgroundColor: colors.accent,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    marginLeft: 8,
  },
  matchBadgeText: {
    color: colors.onAccent,
    fontFamily: fonts.serifBold,
    fontSize: 11,
    letterSpacing: 1.5,
  },
  empty: { textAlign: 'center', marginTop: 48, color: colors.textMuted, fontFamily: fonts.body },
  loaderWrap: { alignItems: 'center', justifyContent: 'center', paddingVertical: 48, gap: 8 },
  loaderText: { color: colors.textMuted, fontFamily: fonts.serif, letterSpacing: 3, fontSize: 12 },
});
