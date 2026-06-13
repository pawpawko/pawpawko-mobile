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
      .select('card_code,name,color,cost,type,types,image_url,image_url_lg')
      .eq('game', GAME)
      .in('card_code', codes.slice(i, i + 100));
    (data ?? []).forEach((c: any) => {
      out[c.card_code] = c;
    });
  }
  return out;
}
