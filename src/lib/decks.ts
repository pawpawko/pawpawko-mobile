// Decks — One Piece deck building (v1, optcg only). Mirrors the web
// js/decks.js client logic. All rules live server-side (the shared Supabase
// project: deck tables, triggers, deck_validity / publish_deck /
// unpublish_deck RPCs, auto wishlist-sync trigger, Standard rotation tables).
// This module just mirrors them for instant feedback + wraps the RPCs.

import { supabase } from './supabase';

export const GAME = 'optcg';

export type DeckRow = {
  id: string;
  user_id: string;
  game: string;
  leader_card_code: string;
  name: string;
  is_public: boolean;
  listing_type: string | null;
  format: 'standard' | 'eternal';
  created_at?: string;
};

export type DeckCardRow = { card_code: string; quantity: number; owned: number };

export type CardInfo = {
  card_code: string;
  name: string | null;
  color: string | null;
  cost: number | null;
  type: string | null;
  types?: string[] | null;
  counter?: number | null;
  effect_text?: string | null;
  attribute?: string | null;
  image_url: string | null;
  image_url_lg?: string | null;
};

export type Validity = {
  valid: boolean;
  problems: string[];
  total_cards: number;
  owned_cards: number;
  missing_cards: number;
  owned_complete: boolean;
};

// ---- rules cache (loaded once per app session) ----
const exceptions: Record<string, number | null> = {}; // base code -> max_copies (null = unlimited, 0 = banned)
let rotatedPrefixes = new Set<string>();
let rotationExempt = new Set<string>();
let rulesLoaded = false;

export async function loadRules(): Promise<void> {
  if (rulesLoaded) return;
  const [ex, rs, re] = await Promise.all([
    supabase.from('deck_rule_exceptions').select('card_code,max_copies').eq('game', GAME),
    supabase.from('rotated_sets').select('set_prefix').eq('game', GAME),
    supabase.from('rotation_exempt_cards').select('card_code').eq('game', GAME),
  ]);
  (ex.data ?? []).forEach((r: any) => {
    exceptions[r.card_code] = r.max_copies;
  });
  rotatedPrefixes = new Set((rs.data ?? []).map((r: any) => r.set_prefix));
  rotationExempt = new Set((re.data ?? []).map((r: any) => r.card_code));
  rulesLoaded = true;
}

export const baseCode = (code: string) => String(code).split('_')[0];
export const isBase = (code: string) => !/_p\d+$/i.test(code);

// copy cap: undefined exception -> 4; null -> unlimited; n -> n (0 = banned)
export function capFor(code: string): number | null {
  const b = baseCode(code);
  if (!(b in exceptions)) return 4;
  return exceptions[b];
}

export function standardLegal(code: string): boolean {
  const b = baseCode(code);
  return !rotatedPrefixes.has(b.split('-')[0]) || rotationExempt.has(b);
}

export function colorsOverlap(a: string | null, b: string | null): boolean {
  const aa = String(a ?? '').split('/').filter(Boolean);
  const bb = String(b ?? '').split('/').filter(Boolean);
  return aa.some((c) => bb.includes(c));
}

export async function fetchValidity(deckId: string): Promise<Validity | null> {
  const { data } = await supabase.rpc('deck_validity', { p_deck_id: deckId });
  return (data as Validity) ?? null;
}

// ---- decklist parse / format (NxCODE per line; leader as its own 1x line) ----

export function parseDecklist(text: string): { rows: Map<string, number>; errors: string[] } {
  const rows = new Map<string, number>();
  const errors: string[] = [];
  String(text ?? '').split(/\r?\n/).forEach((line, i) => {
    const t = line.trim();
    if (!t) return;
    const m = t.match(/^(\d+)\s*[x×]\s*([A-Za-z0-9_-]+)$/i);
    if (!m) {
      errors.push(`line ${i + 1}`);
      return;
    }
    const code = baseCode(m[2].toUpperCase());
    rows.set(code, (rows.get(code) ?? 0) + Number(m[1]));
  });
  return { rows, errors };
}

export function formatDecklist(leaderCode: string, cards: DeckCardRow[], info: Record<string, CardInfo>): string {
  const sorted = cards.slice().sort((a, b) => {
    const ca = info[a.card_code], cb = info[b.card_code];
    return (ca?.cost ?? 99) - (cb?.cost ?? 99) || a.card_code.localeCompare(b.card_code);
  });
  return [`1x${leaderCode}`, ...sorted.map((r) => `${r.quantity}x${r.card_code}`)].join('\n');
}

export async function lookupCards(codes: string[]): Promise<Record<string, CardInfo>> {
  const out: Record<string, CardInfo> = {};
  for (let i = 0; i < codes.length; i += 100) {
    const { data } = await supabase
      .from('cards')
      .select('card_code,name,color,cost,type,types,counter,effect_text,attribute,image_url,image_url_lg')
      .eq('game', GAME)
      .in('card_code', codes.slice(i, i + 100));
    (data ?? []).forEach((c: any) => {
      out[c.card_code] = c;
    });
  }
  return out;
}

// ---- Searcher detection ----------------------------------------------------
// Faithful port of the web js/decks.js parser (itself a port of the canonical
// scripts/search_meta.py). Real OPTCG wording is "look at N cards FROM THE TOP
// of your deck … reveal up to 1 <filter> … add it to your hand". Pure string
// logic — kept identical to web so the two stats panels agree.

const SEARCH_COLORS = ['red', 'green', 'blue', 'purple', 'black', 'yellow'];
const SEARCH_CLAUSE_RE =
  /look at (?:up to )?(\d+) cards? from the top of your deck[;:,. ]*reveal\s+(.*?)\s*[,;]?\s*(?:and\s+)?add\s+(?:it|them|up to \d+[^.]*?)\s+to your hand/i;

export type SearcherCost =
  | { op: 'range'; min: number; max: number }
  | { op: '>='; val: number }
  | { op: '<='; val: number }
  | { op: '=='; val: number };

export type SearcherFilter = {
  category?: string;
  traits?: string[];
  colors?: string[];
  names?: string[];
  exclude?: string[];
  cost?: SearcherCost;
};

export type SearcherMeta = {
  look: number;
  take: number;
  filters: SearcherFilter[];
  gated: boolean;
  gate: string | null;
};

function parseSearcherSub(input: string): SearcherFilter {
  const s = input.replace(/\s+/g, ' ').trim();
  const f: SearcherFilter = {};
  const excl = [...s.matchAll(/other than \[([^\]]+)\]/gi)].map((x) => x[1]);
  const rest = s.replace(/other than \[[^\]]+\]/gi, ' ');
  const names = [...rest.matchAll(/\[([^\]]+)\]/g)].map((x) => x[1]);
  const traits = [...s.matchAll(/\{([^}]+)\}/g)]
    .map((x) => x[1])
    .concat([...s.matchAll(/type including "([^"]+)"/gi)].map((x) => x[1]));
  const colors = [
    ...new Set(
      [...s.matchAll(new RegExp('\\b(' + SEARCH_COLORS.join('|') + ')\\b', 'gi'))].map((x) =>
        x[1].toLowerCase(),
      ),
    ),
  ];
  const masked = s.replace(/\{[^}]*\}|\[[^\]]*\]/g, ' '); // don't read trait/name words as the category
  let category: string | null = null;
  for (const [w, code] of [
    ['Character', 'CHARACTER'],
    ['Event', 'EVENT'],
    ['Stage', 'STAGE'],
    ['Leader', 'LEADER'],
  ]) {
    if (new RegExp('\\b' + w + '\\b', 'i').test(masked)) {
      category = code;
      break;
    }
  }
  let cost: SearcherCost | null = null;
  let mm: RegExpMatchArray | null;
  if ((mm = s.match(/cost of (\d+) to (\d+)/i))) cost = { op: 'range', min: +mm[1], max: +mm[2] };
  else if ((mm = s.match(/cost of (\d+) or more/i))) cost = { op: '>=', val: +mm[1] };
  else if ((mm = s.match(/cost of (\d+) or less/i))) cost = { op: '<=', val: +mm[1] };
  else if ((mm = s.match(/cost of (\d+)\b/i))) cost = { op: '==', val: +mm[1] };
  if (category) f.category = category;
  if (traits.length) f.traits = traits;
  if (colors.length) f.colors = colors;
  if (names.length) f.names = names;
  if (excl.length) f.exclude = excl;
  if (cost) f.cost = cost;
  return f;
}

// Within a filter, names/traits/colors are OR-matched; category/cost AND'd;
// multiple filters are OR'd (the "… or up to 1 …" form).
export function parseSearcher(effect: string | null | undefined): SearcherMeta | null {
  if (!effect) return null;
  const eff = effect.replace(/\s+/g, ' ').trim();
  const m = eff.match(SEARCH_CLAUSE_RE);
  if (!m) return null;
  const look = parseInt(m[1], 10);
  const body = m[2];
  const takeM = body.match(/up to (\d+)/i);
  const take = takeM ? parseInt(takeM[1], 10) : 1;
  const core = body.replace(/^\s*up to \d+\s+/i, '');
  const filters = core.split(/\s+or up to \d+\s+/i).map(parseSearcherSub);
  // Capture the gating condition ("If your Leader …, look at …") so we can test
  // it against the deck's actual leader.
  const gateM = eff.match(/\bif ((?:your|you)\b.*?)(?=,?\s*look at (?:up to )?\d+ cards? from the top)/i);
  const gate = gateM ? gateM[1].trim() : null;
  return { look, take, filters, gated: !!gate, gate };
}

export type GateStatus = 'always' | 'fires' | 'dead' | 'situational';

// Evaluate a searcher's gate against the deck's leader.
export function evalSearcherGate(
  gate: string | null,
  L: CardInfo | null,
): { status: GateStatus; why?: string } {
  if (!gate) return { status: 'always' };
  let m: RegExpMatchArray | null;
  if ((m = gate.match(/leader is \[([^\]]+)\]/i)))
    return { status: L && L.name === m[1] ? 'fires' : 'dead', why: `Leader = ${m[1]}` };
  if ((m = gate.match(/leader has the \{([^}]+)\} type/i)))
    return {
      status: L && Array.isArray(L.types) && L.types.includes(m[1]) ? 'fires' : 'dead',
      why: `Leader is {${m[1]}}`,
    };
  if ((m = gate.match(/leader has the <([^>]+)> attribute/i)))
    return {
      status: L && (L.attribute || '').toLowerCase() === m[1].toLowerCase() ? 'fires' : 'dead',
      why: `Leader is <${m[1]}>`,
    };
  if (/leader is multicolored/i.test(gate))
    return { status: L && /\//.test(L.color || '') ? 'fires' : 'dead', why: 'multicolored Leader' };
  if ((m = gate.match(/leader is (red|green|blue|purple|black|yellow)\b/i)))
    return {
      status: L && (L.color || '').toLowerCase().includes(m[1].toLowerCase()) ? 'fires' : 'dead',
      why: `${m[1]} Leader`,
    };
  return { status: 'situational', why: gate };
}

export function cardMatchesSub(ci: CardInfo, f: SearcherFilter): boolean {
  const id: boolean[] = [];
  if (f.names) id.push(f.names.includes(ci.name ?? ''));
  if (f.traits) id.push(Array.isArray(ci.types) && ci.types.some((t) => f.traits!.includes(t)));
  if (f.colors) {
    const cc = (ci.color || '').toLowerCase();
    id.push(f.colors.some((col) => cc.includes(col)));
  }
  if (id.length && !id.some(Boolean)) return false; // identity constraints are OR'd
  if (f.category && ci.type !== f.category) return false;
  if (f.cost) {
    const v = ci.cost;
    if (v == null) return false;
    if (f.cost.op === 'range' && (v < f.cost.min || v > f.cost.max)) return false;
    if (f.cost.op === '>=' && !(v >= f.cost.val)) return false;
    if (f.cost.op === '<=' && !(v <= f.cost.val)) return false;
    if (f.cost.op === '==' && v !== f.cost.val) return false;
  }
  if (f.exclude && f.exclude.includes(ci.name ?? '')) return false;
  return true;
}

export function searcherTargetLabel(filters: SearcherFilter[]): string {
  return filters
    .map((f) => {
      const p: string[] = [];
      if (f.names) p.push(f.names.map((n) => '[' + n + ']').join('/'));
      if (f.traits) p.push(f.traits.map((t) => '{' + t + '}').join('/'));
      if (f.colors) p.push(f.colors.join('/'));
      if (f.category) p.push(f.category[0] + f.category.slice(1).toLowerCase());
      if (f.cost)
        p.push(
          'cost ' +
            (f.cost.op === 'range'
              ? `${f.cost.min}-${f.cost.max}`
              : f.cost.op === '=='
                ? f.cost.val
                : f.cost.op + f.cost.val),
        );
      return p.join(' ') || 'any card';
    })
    .join(' or ');
}

// Hypergeometric: chance of ≥1 target in the top N of a D-card deck holding T
// targets. Computed as 1 − P(all N miss) to avoid big factorials.
export function hitChance(D: number, T: number, N: number): number {
  N = Math.min(N, D);
  if (T <= 0 || N <= 0) return 0;
  if (D - T < N) return 1;
  let pMiss = 1;
  for (let i = 0; i < N; i++) pMiss *= (D - T - i) / (D - i);
  return 1 - pMiss;
}

// ---- Leader-lock (Add Cards greying) --------------------------------------
// A card is "leader-locked" for this deck if its effect carries an "If your
// Leader …" condition the deck's leader can't meet. Still LEGAL to run — only
// greyed. Conservative: locked only when the leader matches NONE of the card's
// leader conditions.
function evalLeaderClause(clause: string, L: CardInfo): 'met' | 'unmet' | 'unknown' {
  let m: RegExpMatchArray | null;
  if (/leader is \[/i.test(clause)) {
    const names = [...clause.matchAll(/\[([^\]]+)\]/g)].map((x) => x[1]);
    return names.includes(L.name ?? '') ? 'met' : 'unmet';
  }
  if ((m = clause.match(/leader has the \{([^}]+)\} type/i)))
    return Array.isArray(L.types) && L.types.includes(m[1]) ? 'met' : 'unmet';
  if ((m = clause.match(/leader has the <([^>]+)> attribute/i)))
    return (L.attribute || '').toLowerCase() === m[1].toLowerCase() ? 'met' : 'unmet';
  if (/leader is multicolored/i.test(clause)) return /\//.test(L.color || '') ? 'met' : 'unmet';
  if ((m = clause.match(/leader is (red|green|blue|purple|black|yellow)\b/i)))
    return (L.color || '').toLowerCase().includes(m[1].toLowerCase()) ? 'met' : 'unmet';
  return 'unknown'; // some other leader reference we can't judge → don't grey
}

export function leaderLocked(effect: string | null | undefined, L: CardInfo | null): boolean {
  if (!effect || !L) return false;
  const clauses = effect.replace(/\s+/g, ' ').match(/if your leader\b[^.,;:]*/gi);
  if (!clauses) return false;
  let met = false;
  let unmet = false;
  clauses.forEach((cl) => {
    const r = evalLeaderClause(cl, L);
    if (r === 'met') met = true;
    else if (r === 'unmet') unmet = true;
  });
  return unmet && !met;
}

// ---- Owned elsewhere -------------------------------------------------------
// How many copies of each card you physically hold in your OTHER (non-wishlist)
// binders for this game, keyed by BASE code so alt-art prints count toward the
// same number the deck tracks. Port of web js/decks.js loadOwnedElsewhere.
export type OwnedElsewhere = Record<string, { qty: number; binders: string[] }>;

export async function loadOwnedElsewhere(userId: string): Promise<OwnedElsewhere> {
  const out: OwnedElsewhere = {};
  const { data: binders } = await supabase
    .from('binders')
    .select('id,name,flair')
    .eq('user_id', userId)
    .eq('category', GAME);
  const owned = (binders ?? []).filter((b: any) => b.flair !== 'wishlist');
  if (!owned.length) return out;
  const nameById: Record<string, string> = {};
  owned.forEach((b: any) => {
    nameById[b.id] = b.name || 'Binder';
  });
  const { data: rows } = await supabase
    .from('listings')
    .select('binder_id,card_code,quantity')
    .in(
      'binder_id',
      owned.map((b: any) => b.id),
    );
  (rows ?? []).forEach((r: any) => {
    const base = baseCode(r.card_code);
    const e = out[base] || (out[base] = { qty: 0, binders: [] });
    e.qty += r.quantity || 0;
    const nm = nameById[r.binder_id];
    if (nm && !e.binders.includes(nm)) e.binders.push(nm);
  });
  return out;
}
