// Cyberpunk TCG deck helpers — the self-contained data layer for the mobile
// cyberpunk deck editor (mirrors the web js/decks.js cyberpunk module). The
// One Piece deck code in ./decks.ts is untouched; this is a separate module so
// adding another TCG never risks it. Backend rules live server-side
// (scripts/cyberpunk_decks_migration.sql): 3 Legends, 40-50 main deck, <=3
// copies, per-color RAM cap; deck_validity branches on game.

import { supabase } from './supabase';

export const CP_GAME = 'cyberpunk';

export type CpLegend = { card_code: string; owned: number };
export type CpCard = { card_code: string; quantity: number; owned: number };
export type CpCardInfo = {
  card_code: string;
  name: string | null;
  color: string | null;
  cost: number | null;
  ram: number | null;
  type: string | null;
  types: string[] | null;
  rarity: string | null;
  image_url: string | null;
};
// deck_validity returns the same shape as OPTCG plus legend_count for cyberpunk.
export type CpValidity = {
  valid: boolean;
  problems: string[];
  total_cards: number;
  owned_cards: number;
  missing_cards: number;
  owned_complete: boolean;
  legend_count?: number;
};

const CARD_COLS = 'card_code,name,color,cost,ram,type,types,rarity,image_url';

export async function loadCyberpunkDeck(deckId: string): Promise<{
  legends: CpLegend[];
  cards: CpCard[];
  info: Record<string, CpCardInfo>;
}> {
  const [{ data: legs }, { data: cards }] = await Promise.all([
    supabase.from('deck_legends').select('card_code,owned').eq('deck_id', deckId),
    supabase.from('deck_cards').select('card_code,quantity,owned').eq('deck_id', deckId),
  ]);
  const legends = (legs ?? []) as CpLegend[];
  const deckCards = (cards ?? []) as CpCard[];
  const codes = [...new Set([...legends.map((l) => l.card_code), ...deckCards.map((c) => c.card_code)])];
  const info: Record<string, CpCardInfo> = {};
  for (let i = 0; i < codes.length; i += 100) {
    const { data } = await supabase
      .from('cards')
      .select(CARD_COLS)
      .eq('game', CP_GAME)
      .in('card_code', codes.slice(i, i + 100));
    (data ?? []).forEach((c: any) => {
      info[c.card_code] = c;
    });
  }
  return { legends, cards: deckCards, info };
}

// Per-color RAM cap = sum of the RAM of the Legends sharing that color.
export function cyberpunkCaps(legends: CpLegend[], info: Record<string, CpCardInfo>): Record<string, number> {
  const caps: Record<string, number> = {};
  legends.forEach((l) => {
    const c = info[l.card_code];
    if (c?.color) caps[c.color] = (caps[c.color] ?? 0) + (c.ram ?? 0);
  });
  return caps;
}

export async function cyberpunkValidity(deckId: string): Promise<CpValidity | null> {
  const { data } = await supabase.rpc('deck_validity', { p_deck_id: deckId });
  return (data as CpValidity) ?? null;
}

export type CpSearchOpts = {
  legendOnly?: boolean;
  name?: string;
  color?: string;
  type?: string;
  cost?: string;
  tag?: string;
  ram?: string;
  rarity?: string;
};

export async function searchCyberpunkCards(opts: CpSearchOpts): Promise<CpCardInfo[]> {
  let q = supabase.from('cards').select(CARD_COLS).eq('game', CP_GAME);
  if (opts.legendOnly) q = q.eq('type', 'Legend');
  else if (opts.type) q = q.eq('type', opts.type);
  if (opts.color) q = q.eq('color', opts.color);
  if (opts.cost) q = q.eq('cost', parseInt(opts.cost, 10));
  if (opts.tag) q = q.contains('types', [opts.tag]);
  if (opts.ram) q = q.eq('ram', parseInt(opts.ram, 10));
  if (opts.rarity) q = q.eq('rarity', opts.rarity);
  if (opts.name) {
    const safe = opts.name.replace(/[%,]/g, '');
    q = q.or(`name.ilike.%${safe}%,card_code.ilike.%${safe}%`);
  }
  const { data } = await q.order('color').order('cost').limit(120);
  let rows = (data ?? []) as CpCardInfo[];
  if (opts.legendOnly) {
    // one entry per Legend name (printings share a name)
    const seen = new Set<string>();
    rows = rows.filter((c) => (c.name && seen.has(c.name) ? false : (seen.add(c.name ?? ''), true)));
  }
  return rows;
}

// Legend images for the deck-list tiles (codes are prefix-disjoint across
// games, so no game filter is needed).
export async function lookupCardImages(codes: string[]): Promise<Record<string, CpCardInfo>> {
  const out: Record<string, CpCardInfo> = {};
  for (let i = 0; i < codes.length; i += 100) {
    const { data } = await supabase.from('cards').select(CARD_COLS).in('card_code', codes.slice(i, i + 100));
    (data ?? []).forEach((c: any) => {
      out[c.card_code] = c;
    });
  }
  return out;
}

// Create a cyberpunk deck: one Legend seeds leader_card_code (NOT NULL + FK),
// all 3 go into deck_legends.
export async function createCyberpunkDeck(
  userId: string,
  legendCodes: string[],
): Promise<{ id?: string; error?: string }> {
  const { data, error } = await supabase
    .from('decks')
    .insert({ user_id: userId, game: CP_GAME, leader_card_code: legendCodes[0], name: 'Cyberpunk Deck' })
    .select('id')
    .single();
  if (error || !data) return { error: error?.message ?? 'Could not create deck.' };
  const id = data.id as string;
  for (const code of legendCodes) {
    const { error: e2 } = await supabase.from('deck_legends').insert({ deck_id: id, card_code: code });
    if (e2) return { id, error: e2.message };
  }
  return { id };
}

// Keep decks.leader_card_code pointed at a current Legend after edits (validity
// reads deck_legends; this only satisfies the NOT NULL column + FK).
export async function cpSyncLeader(deckId: string, currentLeader: string): Promise<string> {
  const { data } = await supabase.from('deck_legends').select('card_code').eq('deck_id', deckId).limit(1);
  const first = data?.[0]?.card_code as string | undefined;
  if (first && first !== currentLeader) {
    await supabase.from('decks').update({ leader_card_code: first }).eq('id', deckId);
    return first;
  }
  return currentLeader;
}
