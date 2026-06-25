import { supabase } from './supabase';

// ---------------------------------------------------------------------------
// Trade-binder add helpers (used by the card scanner).
//
// Mirrors the find/dedup/insert shape of lib/wishlist.addCardToWishlist, but a
// user can own MANY trade binders per game, so the caller picks the target
// (rather than auto-resolving a single one like wishlist does).
// ---------------------------------------------------------------------------

export type TradeBinder = { id: string; name: string };
export type BinderAddResult = 'added' | 'duplicate' | 'error';

export async function listTradeBinders(userId: string, game: string): Promise<TradeBinder[]> {
  const { data, error } = await supabase
    .from('binders')
    .select('id,name')
    .eq('user_id', userId)
    .eq('category', game)
    .eq('flair', 'trade')
    .order('created_at', { ascending: true });
  if (error) {
    console.warn('listTradeBinders', error.message);
    return [];
  }
  return (data ?? []) as TradeBinder[];
}

export async function createTradeBinder(
  userId: string,
  game: string,
  name = 'Trade Binder',
): Promise<TradeBinder | null> {
  const { data, error } = await supabase
    .from('binders')
    .insert({ user_id: userId, category: game, flair: 'trade', name })
    .select('id,name')
    .single();
  if (error || !data) {
    console.warn('createTradeBinder', error?.message);
    return null;
  }
  return data as TradeBinder;
}

export async function addCardToBinder(
  binderId: string,
  cardCode: string,
  quantity: number,
): Promise<BinderAddResult> {
  // Dedup on (binder, card) — same rule as the wishlist add. A repeat scan of a
  // card already in this binder reports 'duplicate'; bump the quantity in the
  // binder editor instead.
  const { count, error: countErr } = await supabase
    .from('listings')
    .select('id', { count: 'exact', head: true })
    .eq('binder_id', binderId)
    .eq('card_code', cardCode);
  if (countErr) {
    console.warn('addCardToBinder dup-check', countErr.message);
    return 'error';
  }
  if ((count ?? 0) > 0) return 'duplicate';

  const { error: insertErr } = await supabase
    .from('listings')
    .insert({
      binder_id: binderId,
      card_code: cardCode,
      quantity: Math.max(1, quantity),
      listing_type: 'trade',
    });
  if (insertErr) {
    console.warn('addCardToBinder insert', insertErr.message);
    return 'error';
  }
  return 'added';
}
