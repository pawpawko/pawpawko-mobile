import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { DiceLoader } from '@/components/dice-loader';
import {
  CYBERPUNK_COLORS,
  CYBERPUNK_COSTS,
  CYBERPUNK_RAM,
  CYBERPUNK_RARITIES,
  CYBERPUNK_TAGS,
  CYBERPUNK_TYPES,
  OPTCG_ATTRIBUTES,
  OPTCG_COLORS,
  OPTCG_COSTS,
  OPTCG_RARITIES,
  OPTCG_TYPES,
  POKEMON_HP_BUCKETS,
  POKEMON_RARITIES,
  POKEMON_SUBTYPES,
  POKEMON_SUPERTYPES,
  POKEMON_TYPES,
} from '@/lib/binder-constants';
import { supabase } from '@/lib/supabase';
import { fonts, radius, type Palette } from '@/lib/theme';
import { useTheme } from '@/lib/theme-context';
import { FilterPickerSheet } from './filter-picker-sheet';
import { makeSharedStyles } from './styles';
import { type CardInfo } from './types';

type BrowserFilters = {
  series: string;
  color: string;
  type: string;
  cost: string;
  attribute: string;
  rarity: string;
  supertype: string;
  subtype: string;
  hp: string; // HP minimum
  tag: string; // Cyberpunk classification (types[])
  ram: string; // Cyberpunk RAM
};

const EMPTY_FILTERS: BrowserFilters = {
  series: '',
  color: '',
  type: '',
  cost: '',
  attribute: '',
  rarity: '',
  supertype: '',
  subtype: '',
  hp: '',
  tag: '',
  ram: '',
};

export type CardBrowserModalProps = {
  visible: boolean;
  onClose: () => void;
  game: string;
  onPickCard: (allResults: CardInfo[], index: number) => void;
};

export function CardBrowserModal({
  visible,
  onClose,
  game,
  onPickCard,
}: CardBrowserModalProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<BrowserFilters>(EMPTY_FILTERS);
  const [seriesOptions, setSeriesOptions] = useState<string[]>([]);
  const [results, setResults] = useState<CardInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [activeFilter, setActiveFilter] = useState<keyof BrowserFilters | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset when modal closes; load series list once per game when it opens.
  useEffect(() => {
    if (!visible) {
      setSearch('');
      setFilters(EMPTY_FILTERS);
      setResults([]);
      return;
    }
    loadSeries();
    runSearch('', EMPTY_FILTERS);
  }, [visible, game]);

  async function loadSeries() {
    // Track the newest release_order seen per series so we can sort sets
    // newest-first (matching the web app's release-order convention).
    const newestBySeries: Record<string, number> = {};
    let from = 0;
    const page = 1000;
    while (from < 20000) {
      const { data, error } = await supabase
        .from('cards')
        .select('series, release_order')
        .eq('game', game)
        .range(from, from + page - 1);
      if (error || !data || data.length === 0) break;
      data.forEach((r) => {
        if (!r.series) return;
        const ro = r.release_order ?? -Infinity;
        if (newestBySeries[r.series] === undefined || ro > newestBySeries[r.series]) {
          newestBySeries[r.series] = ro;
        }
      });
      if (data.length < page) break;
      from += page;
    }
    const sorted = Object.keys(newestBySeries).sort(
      (a, b) => newestBySeries[b] - newestBySeries[a],
    );
    setSeriesOptions(sorted);
  }

  function runSearch(q: string, f: BrowserFilters) {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      setBusy(true);
      const projection =
        game === 'pokemon'
          ? 'card_code, name, series, type, types, supertype, subtypes, hp, rarity, image_url, image_url_lg, release_order'
          : game === 'cyberpunk'
            ? 'card_code, name, series, color, type, cost, ram, types, rarity, image_url, image_url_lg, release_order'
            : 'card_code, name, series, color, type, cost, attribute, rarity, image_url, image_url_lg, release_order';
      let query = supabase
        .from('cards')
        .select(projection)
        .eq('game', game);

      if (q) {
        // PostgREST .or() reserved characters are stripped (they can't be
        // escaped inside .or() values) and LIKE wildcards are backslash-escaped
        // so they match literally — promo codes like 'OP01-001_p1' contain
        // underscores. Mirrors web js/trades.js.
        const safe = q.replace(/[,()"\\*]/g, '').replace(/[%_]/g, '\\$&');
        query = query.or(`name.ilike.%${safe}%,card_code.ilike.%${safe}%`);
      }
      if (f.series) query = query.eq('series', f.series);
      if (f.rarity) query = query.eq('rarity', f.rarity);

      if (game === 'pokemon') {
        if (f.type) query = query.contains('types', [f.type]);
        if (f.supertype) query = query.eq('supertype', f.supertype);
        if (f.subtype) query = query.contains('subtypes', [f.subtype]);
        if (f.hp) query = query.gte('hp', parseInt(f.hp, 10));
      } else if (game === 'cyberpunk') {
        if (f.color) query = query.eq('color', f.color); // colors are single-valued
        if (f.type) query = query.eq('type', f.type); // Legend/Unit/Gear/Program
        if (f.cost !== '') query = query.eq('cost', parseInt(f.cost, 10));
        if (f.tag) query = query.contains('types', [f.tag]); // classifications text[]
        if (f.ram !== '') query = query.eq('ram', parseInt(f.ram, 10));
      } else {
        if (f.color) query = query.ilike('color', `%${f.color}%`);
        if (f.type) query = query.eq('type', f.type);
        if (f.cost !== '') query = query.eq('cost', parseInt(f.cost, 10));
        if (f.attribute) query = query.eq('attribute', f.attribute);
      }

      const { data, error } = await query
        .order('release_order', { ascending: false })
        .order('card_code', { ascending: false })
        .limit(120);
      setBusy(false);
      if (error) {
        console.warn('browser search', error.message);
        setResults([]);
        return;
      }
      setResults((data ?? []) as unknown as CardInfo[]);
    }, 250);
  }

  function updateFilter(k: keyof BrowserFilters, v: string) {
    const next = { ...filters, [k]: v };
    setFilters(next);
    runSearch(search, next);
  }

  function clearAll() {
    setFilters(EMPTY_FILTERS);
    setSearch('');
    runSearch('', EMPTY_FILTERS);
  }

  const filterDefs: { key: keyof BrowserFilters; label: string; options: string[] }[] =
    game === 'pokemon'
      ? [
          { key: 'series', label: 'Set', options: seriesOptions },
          { key: 'supertype', label: 'Supertype', options: POKEMON_SUPERTYPES },
          { key: 'subtype', label: 'Subtype', options: POKEMON_SUBTYPES },
          { key: 'type', label: 'Type', options: POKEMON_TYPES },
          { key: 'hp', label: 'HP ≥', options: POKEMON_HP_BUCKETS.map(String) },
          { key: 'rarity', label: 'Rarity', options: POKEMON_RARITIES },
        ]
      : game === 'cyberpunk'
        ? [
            { key: 'series', label: 'Set', options: seriesOptions },
            { key: 'color', label: 'Color', options: CYBERPUNK_COLORS },
            { key: 'type', label: 'Type', options: CYBERPUNK_TYPES },
            { key: 'cost', label: 'Cost', options: CYBERPUNK_COSTS.map(String) },
            { key: 'tag', label: 'Tag', options: CYBERPUNK_TAGS },
            { key: 'ram', label: 'RAM', options: CYBERPUNK_RAM.map(String) },
            { key: 'rarity', label: 'Rarity', options: CYBERPUNK_RARITIES },
          ]
        : [
            { key: 'series', label: 'Set', options: seriesOptions },
            { key: 'color', label: 'Color', options: OPTCG_COLORS },
            { key: 'type', label: 'Type', options: OPTCG_TYPES },
            { key: 'cost', label: 'Cost', options: OPTCG_COSTS.map(String) },
            { key: 'attribute', label: 'Attribute', options: OPTCG_ATTRIBUTES },
            { key: 'rarity', label: 'Rarity', options: OPTCG_RARITIES },
          ];


  const activeFilterCount = Object.values(filters).filter((v) => v !== '').length;

  // Display helper for series names. Rule: a hyphen survives ONLY when it's
  // part of a series code (e.g. "OP-01", "sv1-1" — a letter/digit on each
  // side). Every other hyphen is dropped: " - " separators ("OP-01 - Romance
  // Dawn" → "OP-01 Romance Dawn"), stand-alone hyphens between words, and any
  // leading/trailing dashes ("- Romance Dawn -" → "Romance Dawn"). Applies to
  // all sets, current and future.
  function prettyOption(filterKey: keyof BrowserFilters, raw: string): string {
    if (raw === '' || filterKey !== 'series') return raw;
    return raw
      .replace(/\s+-\s+/g, ' ') // collapse " - " separators between words
      .replace(/([A-Za-z])-([A-Za-z])/g, '$1 $2') // stand-alone word hyphen → space
      .replace(/^[\s-]+|[\s-]+$/g, '') // strip leading/trailing dashes + space
      .replace(/\s{2,}/g, ' '); // squeeze any doubled spaces
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.browserWrap}>
        <View style={styles.browserHeader}>
          <Text style={styles.browserTitle}>ADD CARDS</Text>
          <Pressable onPress={onClose}>
            <Ionicons name="close" size={26} color={colors.textPrimary} />
          </Pressable>
        </View>
        <TextInput
          value={search}
          onChangeText={(v) => {
            setSearch(v);
            runSearch(v, filters);
          }}
          placeholder={game === 'pokemon' ? 'Pikachu, sv1-1, …' : 'Luffy, OP01-001, …'}
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.browserInput}
        />

        <Pressable style={styles.browserFilterToggle} onPress={() => setFiltersOpen((o) => !o)}>
          <Ionicons name="options-outline" size={16} color={colors.accent} />
          <Text style={styles.browserFilterToggleText}>
            {filtersOpen ? 'Hide filters' : 'Filters'}
            {activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
          </Text>
          <Ionicons
            name={filtersOpen ? 'chevron-up' : 'chevron-down'}
            size={16}
            color={colors.accent}
          />
        </Pressable>

        {filtersOpen ? (
          <ScrollView
            style={styles.browserFiltersWrap}
            contentContainerStyle={styles.browserFilters}>
            {filterDefs.map((def) => {
              if (def.options.length === 0) return null;
              const value = filters[def.key];
              return (
                <Pressable
                  key={def.key}
                  onPress={() => setActiveFilter(def.key)}
                  style={({ pressed }) => [styles.filterDropdown, pressed && { opacity: 0.7 }]}>
                  <Text style={styles.filterDropdownLabel}>{def.label.toUpperCase()}</Text>
                  <View style={styles.filterDropdownValueRow}>
                    <Text
                      style={[
                        styles.filterDropdownValue,
                        value === '' && styles.filterDropdownValueEmpty,
                      ]}
                      numberOfLines={1}>
                      {value === '' ? 'Any' : prettyOption(def.key, value)}
                    </Text>
                    <Ionicons name="chevron-down" size={16} color={colors.textMuted} />
                  </View>
                </Pressable>
              );
            })}
            <View style={styles.browserFilterButtons}>
              <Pressable
                style={({ pressed }) => [styles.applyBtn, pressed && { opacity: 0.7 }]}
                onPress={() => setFiltersOpen(false)}>
                <Text style={styles.applyBtnText}>APPLY</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.clearBtn, pressed && { opacity: 0.7 }]}
                onPress={clearAll}>
                <Text style={styles.clearBtnText}>CLEAR</Text>
              </Pressable>
            </View>
          </ScrollView>
        ) : busy ? (
          <View style={{ alignItems: 'center', marginTop: 24 }}>
            <DiceLoader />
          </View>
        ) : (
          <FlatList
            data={results}
            keyExtractor={(c) => c.card_code}
            numColumns={3}
            contentContainerStyle={{ padding: 8 }}
            ListEmptyComponent={
              <Text style={styles.empty}>{search ? 'No matches.' : 'Loading…'}</Text>
            }
            renderItem={({ item, index }) => (
              <Pressable
                onPress={() => onPickCard(results, index)}
                style={({ pressed }) => [styles.cell, { flex: 1 / 3 }, pressed && styles.cellPressed]}>
                {item.image_url ? (
                  <Image source={{ uri: item.image_url }} style={styles.cardImg} contentFit="contain" />
                ) : (
                  <View style={[styles.cardImg, styles.placeholder]} />
                )}
                <Text style={styles.cardCode} numberOfLines={1}>{item.card_code}</Text>
                <Text style={styles.cardMeta} numberOfLines={1}>{item.name}</Text>
              </Pressable>
            )}
          />
        )}

        <FilterPickerSheet
          visible={activeFilter !== null}
          label={activeFilter ? filterDefs.find((f) => f.key === activeFilter)?.label ?? '' : ''}
          options={activeFilter ? filterDefs.find((f) => f.key === activeFilter)?.options ?? [] : []}
          current={activeFilter ? filters[activeFilter] : ''}
          formatLabel={(v) => (activeFilter ? prettyOption(activeFilter, v) : v)}
          onPick={(v) => {
            if (activeFilter) updateFilter(activeFilter, v);
            setActiveFilter(null);
          }}
          onClose={() => setActiveFilter(null)}
        />
      </View>
    </Modal>
  );
}

const makeStyles = (colors: Palette) => ({
  ...makeSharedStyles(colors),
  ...StyleSheet.create({
    browserWrap: { flex: 1, backgroundColor: colors.bgPrimary, paddingTop: 48 },
    browserHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingBottom: 8,
    },
    browserTitle: { color: colors.accent, fontFamily: fonts.serifBold, letterSpacing: 3, fontSize: 14 },
    browserInput: {
      marginHorizontal: 16,
      marginBottom: 8,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.bgCard,
      borderRadius: radius.sm,
      padding: 12,
      fontSize: 15,
      color: colors.textPrimary,
      fontFamily: fonts.body,
    },

    browserFilterToggle: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      paddingVertical: 10,
      borderTopWidth: 1,
      borderBottomWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.bgSecondary,
    },
    browserFilterToggleText: {
      color: colors.accent,
      fontFamily: fonts.serif,
      letterSpacing: 2,
      fontSize: 12,
      includeFontPadding: false,
    },
    browserFiltersWrap: { flex: 1, backgroundColor: colors.bgSecondary },
    browserFilters: { padding: 16, gap: 8 },
    filterDropdown: {
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.bgCard,
      borderRadius: radius.sm,
      paddingHorizontal: 12,
      paddingVertical: 10,
      marginTop: 4,
      gap: 4,
    },
    filterDropdownLabel: {
      color: colors.textMuted,
      fontFamily: fonts.serif,
      letterSpacing: 2,
      fontSize: 10,
      includeFontPadding: false,
    },
    filterDropdownValueRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    filterDropdownValue: {
      flex: 1,
      color: colors.textPrimary,
      fontFamily: fonts.body,
      fontSize: 14,
      lineHeight: 20,
      includeFontPadding: false,
    },
    filterDropdownValueEmpty: { color: colors.textMuted },
    browserFilterButtons: { flexDirection: 'row', gap: 8, marginTop: 16 },
    applyBtn: {
      flex: 1,
      padding: 12,
      borderRadius: radius.sm,
      backgroundColor: colors.accent,
      alignItems: 'center',
    },
    applyBtnText: {
      color: colors.onAccent,
      fontFamily: fonts.serifBold,
      letterSpacing: 2,
      fontSize: 13,
    },
    clearBtn: {
      flex: 1,
      padding: 12,
      borderRadius: radius.sm,
      borderWidth: 1,
      borderColor: colors.borderAccent,
      alignItems: 'center',
    },
    clearBtnText: {
      color: colors.accent,
      fontFamily: fonts.serifBold,
      letterSpacing: 2,
      fontSize: 13,
    },
  }),
});
