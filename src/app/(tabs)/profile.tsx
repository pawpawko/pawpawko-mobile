import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useAuth } from '@/lib/auth';
import { BOROUGHS_BY_CITY, CITIES } from '@/lib/constants';
import { supabase } from '@/lib/supabase';
import { colors, fonts, radius } from '@/lib/theme';

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

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

type NameCheck = { status: 'idle' | 'checking' | 'ok' | 'bad'; message: string };

export default function ProfileScreen() {
  const { session } = useAuth();
  const userId = session?.user.id;
  const scrollRef = useRef<ScrollView>(null);

  // Scroll back to the top whenever the tab regains focus so the user
  // never sees the previous scroll position when re-entering Profile.
  useFocusEffect(
    useCallback(() => {
      scrollRef.current?.scrollTo({ y: 0, animated: false });
    }, []),
  );

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [displayName, setDisplayName] = useState('');
  const [originalName, setOriginalName] = useState('');
  const [nameLockedUntil, setNameLockedUntil] = useState<Date | null>(null);
  const [nameCheck, setNameCheck] = useState<NameCheck>({ status: 'idle', message: '' });

  const [discord, setDiscord] = useState('');
  const [city, setCity] = useState('');
  const [boroughs, setBoroughs] = useState<string[]>([]);
  const [subways, setSubways] = useState<string[]>([]);
  const [shopsText, setShopsText] = useState('');
  const [setupRequired, setSetupRequired] = useState(false);

  useEffect(() => {
    if (!userId) return;
    (async () => {
      const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

      const notSetUp = !data || data.display_name_set !== true;
      setSetupRequired(notSetUp);
      setDisplayName(notSetUp ? '' : data?.display_name ?? '');
      setOriginalName(notSetUp ? '' : data?.display_name ?? '');
      setDiscord(data?.discord_handle ?? '');
      setCity(data?.city ?? '');
      setBoroughs(data?.boroughs ?? []);
      setSubways(data?.subway_stops ?? []);
      setShopsText((data?.local_shops ?? []).join(', '));

      if (!notSetUp && data?.display_name_changed_at) {
        const unlockAt = new Date(new Date(data.display_name_changed_at).getTime() + NINETY_DAYS_MS);
        setNameLockedUntil(unlockAt > new Date() ? unlockAt : null);
      } else {
        setNameLockedUntil(null);
      }
      setLoading(false);
    })();
  }, [userId]);

  // City change resets borough/subway selections that no longer apply
  useEffect(() => {
    if (city !== 'nyc') setSubways([]);
    const available = BOROUGHS_BY_CITY[city] ?? [];
    setBoroughs((prev) => prev.filter((b) => available.includes(b)));
  }, [city]);

  function toggle(list: string[], value: string, setter: (l: string[]) => void) {
    setter(list.includes(value) ? list.filter((x) => x !== value) : [...list, value]);
  }

  async function checkName() {
    const name = displayName.trim();
    if (!name) {
      setNameCheck({ status: 'bad', message: 'Enter a display name first.' });
      return;
    }
    setNameCheck({ status: 'checking', message: 'Checking…' });
    try {
      const [acc, avail] = await Promise.all([
        supabase.rpc('display_name_acceptable', { p_name: name }),
        supabase.rpc('display_name_available', { p_name: name }),
      ]);
      if (acc.error) throw acc.error;
      if (avail.error) throw avail.error;
      if (acc.data !== true) {
        setNameCheck({ status: 'bad', message: `"${name}" contains disallowed words.` });
      } else if (avail.data === true) {
        setNameCheck({ status: 'ok', message: `"${name}" is available.` });
      } else {
        setNameCheck({ status: 'bad', message: `"${name}" is already taken.` });
      }
    } catch (e: any) {
      setNameCheck({ status: 'bad', message: e?.message ?? 'Check failed.' });
    }
  }

  async function save() {
    if (!userId) return;
    const name = displayName.trim();
    if (!name) {
      Alert.alert('Display name required');
      return;
    }
    const nameChanged = name.toLowerCase() !== (originalName || '').toLowerCase();
    if (nameChanged && nameLockedUntil) {
      Alert.alert('Display name locked', 'It can only be changed once every 90 days.');
      return;
    }
    setSaving(true);
    try {
      if (nameChanged) {
        const [acc, avail] = await Promise.all([
          supabase.rpc('display_name_acceptable', { p_name: name }),
          supabase.rpc('display_name_available', { p_name: name }),
        ]);
        if (acc.data !== true) {
          Alert.alert('Not allowed', `"${name}" contains disallowed words.`);
          setSaving(false);
          return;
        }
        if (avail.data !== true) {
          Alert.alert('Already taken', `"${name}" is already taken.`);
          setSaving(false);
          return;
        }
      }

      const shops = shopsText
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      const { error } = await supabase.from('profiles').upsert(
        {
          user_id: userId,
          display_name: name,
          display_name_set: true,
          discord_handle: discord.trim() || null,
          city: city || null,
          boroughs,
          subway_stops: city === 'nyc' ? subways : [],
          local_shops: shops,
        },
        { onConflict: 'user_id' },
      );

      if (error) {
        if (error.code === '23505' && /display_name/i.test(error.message)) {
          Alert.alert('Already taken', 'That display name is already taken.');
        } else if (/90 days/i.test(error.message)) {
          Alert.alert('Locked', 'Display name can only change once every 90 days.');
        } else if (/disallowed words/i.test(error.message)) {
          Alert.alert('Not allowed', 'That display name contains disallowed words.');
        } else {
          Alert.alert('Save failed', error.message);
        }
      } else {
        Alert.alert('Saved');
        setSetupRequired(false);
        if (nameChanged) {
          setOriginalName(name);
          setNameLockedUntil(new Date(Date.now() + NINETY_DAYS_MS));
        }
      }
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.loadingWrap}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  const availableBoroughs = city ? BOROUGHS_BY_CITY[city] ?? [] : [];
  const nameLocked = !!nameLockedUntil;

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView ref={scrollRef} style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.welcome}>Welcome back{originalName ? `, ${originalName}` : ''}</Text>
        <Text style={styles.email}>{session?.user.email}</Text>

        {setupRequired ? (
          <View style={styles.notice}>
            <Text style={styles.noticeText}>
              Please set a unique display name to continue using Pawpaw Ko.
            </Text>
          </View>
        ) : null}

        <View style={styles.divider} />

        <Text style={styles.sectionTitle}>PROFILE</Text>

        <Field label="Display Name *">
          <View style={styles.nameRow}>
            <TextInput
              value={displayName}
              onChangeText={(t) => {
                setDisplayName(t);
                setNameCheck({ status: 'idle', message: '' });
              }}
              editable={!nameLocked}
              autoCapitalize="none"
              style={[styles.input, styles.nameInput, nameLocked && styles.inputDisabled]}
            />
            <Pressable
              style={({ pressed }) => [styles.checkBtn, pressed && styles.checkBtnPressed, nameLocked && styles.checkBtnDisabled]}
              onPress={checkName}
              disabled={nameLocked || nameCheck.status === 'checking'}>
              <Text style={styles.checkBtnText}>CHECK</Text>
            </Pressable>
          </View>
          <Text style={styles.hint}>
            Tip: use your local nickname so other players recognize you. Changes are limited to once every 90 days.
          </Text>
          {nameLocked ? (
            <Text style={styles.lockMsg}>
              Display name is locked until {nameLockedUntil!.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}.
            </Text>
          ) : null}
          {nameCheck.message ? (
            <Text style={[styles.hint, nameCheck.status === 'ok' && styles.hintOk, nameCheck.status === 'bad' && styles.hintBad]}>
              {nameCheck.message}
            </Text>
          ) : null}
        </Field>

        <Field label="Discord Handle">
          <TextInput
            value={discord}
            onChangeText={setDiscord}
            placeholder="yourname#0000 or @yourname"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
          />
        </Field>

        <Field label="City">
          <View style={styles.chipRow}>
            <Chip label="—" active={!city} onPress={() => setCity('')} />
            {CITIES.map((c) => (
              <Chip key={c.value} label={c.label} active={city === c.value} onPress={() => setCity(c.value)} />
            ))}
          </View>
          <Text style={styles.hint}>Used to pre-fill the binder search filters.</Text>
        </Field>

        {availableBoroughs.length > 0 ? (
          <Field label="Preferred Boroughs">
            <View style={styles.chipRow}>
              {availableBoroughs.map((b) => (
                <Chip key={b} label={b} active={boroughs.includes(b)} onPress={() => toggle(boroughs, b, setBoroughs)} />
              ))}
            </View>
          </Field>
        ) : (
          <Field label="Preferred Boroughs">
            <Text style={styles.hint}>Pick a city first.</Text>
          </Field>
        )}

        {city === 'nyc' ? (
          <Field label="Subway Stops">
            <SubwayDropdown
              options={NYC_SUBWAY_STOPS}
              selected={subways}
              onToggle={(s) => toggle(subways, s, setSubways)}
            />
          </Field>
        ) : null}

        <Field label="Local Card Shops (comma separated)">
          <TextInput
            value={shopsText}
            onChangeText={setShopsText}
            placeholder="The Comic Lab, Game Master"
            placeholderTextColor={colors.textMuted}
            style={styles.input}
          />
        </Field>

        <Pressable
          style={({ pressed }) => [styles.saveBtn, pressed && styles.saveBtnPressed, saving && styles.saveBtnDisabled]}
          onPress={save}
          disabled={saving}>
          {saving ? <ActivityIndicator color={colors.bgPrimary} /> : <Text style={styles.saveBtnText}>SAVE</Text>}
        </Pressable>

        <View style={styles.divider} />

        <Pressable
          style={({ pressed }) => [styles.signOut, pressed && styles.signOutPressed]}
          onPress={() => supabase.auth.signOut()}>
          <Text style={styles.signOutText}>SIGN OUT</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label.toUpperCase()}</Text>
      {children}
    </View>
  );
}

function SubwayDropdown({
  options,
  selected,
  onToggle,
}: {
  options: string[];
  selected: string[];
  onToggle: (s: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const label =
    selected.length === 0 ? 'Any' : selected.length === 1 ? selected[0] : `${selected.length} selected`;
  return (
    <View>
      <Pressable
        onPress={() => setOpen((o) => !o)}
        style={({ pressed }) => [styles.dropdownBtn, pressed && styles.chipPressed]}>
        <Text style={styles.dropdownBtnText}>{label}</Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textSecondary} />
      </Pressable>
      {open ? (
        <View style={styles.dropdownPanel}>
          <View style={styles.chipRow}>
            {options.map((s) => (
              <Chip key={s} label={s} active={selected.includes(s)} onPress={() => onToggle(s)} />
            ))}
          </View>
        </View>
      ) : null}
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
  flex: { flex: 1, backgroundColor: colors.bgPrimary },
  container: { flex: 1, backgroundColor: colors.bgPrimary },
  content: { padding: 20, gap: 4, paddingBottom: 60 },
  loadingWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bgPrimary },

  welcome: { color: colors.textPrimary, fontFamily: fonts.serif, fontSize: 22, letterSpacing: 2 },
  email: { color: colors.textMuted, fontFamily: fonts.body, fontSize: 13, marginBottom: 6 },

  notice: {
    backgroundColor: colors.bgCard,
    borderLeftWidth: 3,
    borderLeftColor: colors.accent,
    padding: 12,
    borderRadius: radius.sm,
    marginTop: 8,
  },
  noticeText: { color: colors.textSecondary, fontFamily: fonts.body, fontSize: 13 },

  divider: { height: 1, backgroundColor: colors.border, marginVertical: 16 },
  sectionTitle: { color: colors.accent, fontFamily: fonts.serifBold, letterSpacing: 3, fontSize: 14, marginBottom: 4 },

  field: { gap: 6, marginTop: 12 },
  label: { color: colors.textMuted, fontFamily: fonts.serif, letterSpacing: 2, fontSize: 11 },

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
  inputDisabled: { opacity: 0.6 },

  nameRow: { flexDirection: 'row', gap: 8 },
  nameInput: { flex: 1 },
  checkBtn: {
    paddingHorizontal: 14,
    justifyContent: 'center',
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.borderAccent,
  },
  checkBtnPressed: { backgroundColor: colors.bgCard },
  checkBtnDisabled: { opacity: 0.4 },
  checkBtnText: { color: colors.accent, fontFamily: fonts.serifBold, letterSpacing: 2, fontSize: 12 },

  hint: { color: colors.textMuted, fontFamily: fonts.body, fontSize: 12, marginTop: 2 },
  hintOk: { color: '#7cbf7c' },
  hintBad: { color: colors.danger },
  lockMsg: { color: colors.accent, fontFamily: fonts.body, fontSize: 12, marginTop: 2 },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  dropdownBtn: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgCard,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  dropdownBtnText: { color: colors.textPrimary, fontFamily: fonts.body, fontSize: 14 },
  dropdownPanel: {
    marginTop: 6,
    padding: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.bgCard,
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

  saveBtn: { marginTop: 20, padding: 14, borderRadius: radius.sm, backgroundColor: colors.accent, alignItems: 'center' },
  saveBtnPressed: { backgroundColor: colors.accentLight },
  saveBtnDisabled: { opacity: 0.5 },
  saveBtnText: { color: colors.bgPrimary, fontFamily: fonts.serifBold, letterSpacing: 2, fontSize: 14 },

  signOut: {
    marginTop: 4,
    padding: 14,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.borderAccent,
    alignItems: 'center',
  },
  signOutPressed: { backgroundColor: colors.bgCard },
  signOutText: { color: colors.danger, fontFamily: fonts.serifBold, letterSpacing: 2 },
});
