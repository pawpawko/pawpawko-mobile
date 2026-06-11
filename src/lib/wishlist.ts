import { supabase } from './supabase';

export type WishlistResult =
  | 'added'
  | 'created-and-added'
  | 'duplicate'
  | 'error';

export async function addCardToWishlist(
  cardCode: string,
  game: string,
  userId: string,
): Promise<WishlistResult> {
  const { data: existingBinder, error: findErr } = await supabase
    .from('binders')
    .select('id')
    .eq('user_id', userId)
    .eq('category', game)
    .eq('flair', 'wishlist')
    .maybeSingle();
  if (findErr) {
    console.warn('wishlist find', findErr.message);
    return 'error';
  }

  let binderId = existingBinder?.id as string | undefined;
  let created = false;

  if (!binderId) {
    const { data: newBinder, error: createErr } = await supabase
      .from('binders')
      .insert({ user_id: userId, category: game, flair: 'wishlist', name: 'Wishlist' })
      .select('id')
      .single();
    if (createErr || !newBinder) {
      console.warn('wishlist create', createErr?.message);
      return 'error';
    }
    binderId = newBinder.id as string;
    created = true;
  }

  const { count, error: countErr } = await supabase
    .from('listings')
    .select('id', { count: 'exact', head: true })
    .eq('binder_id', binderId)
    .eq('card_code', cardCode);
  if (countErr) {
    console.warn('wishlist dup-check', countErr.message);
    return 'error';
  }
  if ((count ?? 0) > 0) return 'duplicate';

  const { error: insertErr } = await supabase
    .from('listings')
    .insert({ binder_id: binderId, card_code: cardCode, quantity: 1, listing_type: 'trade' });
  if (insertErr) {
    console.warn('wishlist insert', insertErr.message);
    return 'error';
  }

  return created ? 'created-and-added' : 'added';
}
