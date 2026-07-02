
import {
  COLOR_ORDER,
  POKEMON_SUPERTYPES,
  POKEMON_TYPES,
  type SortMode,
} from '@/lib/binder-constants';
import { type CardInfo, type Listing } from './types';

export function applySortMode(
  listings: Listing[],
  cards: Record<string, CardInfo>,
  mode: SortMode,
): Listing[] {
  const cardOf = (l: Listing) => cards[l.card_code] || ({} as CardInfo);
  const out = listings.slice();
  if (mode === 'custom-3x3' || mode === 'custom-4x3') {
    // Nulls (new listings without a position) sort to the end, matching the
    // web app's `order(sort_order, nullsFirst: false)`. Among nulls the input
    // order is preserved (stable sort) so freshly-added cards stay together at
    // the end in insertion order — NOT regrouped by card_code, which for One
    // Piece's color-grouped numbering would look like an unwanted color sort.
    return out.sort((a, b) => (a.sort_order ?? Infinity) - (b.sort_order ?? Infinity));
  }
  if (mode === 'release') {
    return out.sort(
      (a, b) =>
        (cardOf(b).release_order ?? 0) - (cardOf(a).release_order ?? 0) ||
        String(a.card_code).localeCompare(b.card_code),
    );
  }
  if (mode === 'color') {
    const rank = (l: Listing) => {
      const i = COLOR_ORDER.indexOf(cardOf(l).color ?? '');
      return i < 0 ? 99 : i;
    };
    return out.sort(
      (a, b) =>
        rank(a) - rank(b) ||
        (cardOf(a).cost ?? 0) - (cardOf(b).cost ?? 0) ||
        String(a.card_code).localeCompare(b.card_code),
    );
  }
  if (mode === 'cost') {
    return out.sort(
      (a, b) =>
        (cardOf(a).cost ?? 99) - (cardOf(b).cost ?? 99) ||
        String(a.card_code).localeCompare(b.card_code),
    );
  }
  if (mode === 'ram') {
    return out.sort(
      (a, b) =>
        (cardOf(a).ram ?? 99) - (cardOf(b).ram ?? 99) ||
        String(a.card_code).localeCompare(b.card_code),
    );
  }
  if (mode === 'ptype') {
    const rank = (l: Listing) => {
      const t = (cardOf(l).types || [])[0];
      const i = POKEMON_TYPES.indexOf(t ?? '');
      return i < 0 ? 99 : i;
    };
    return out.sort(
      (a, b) =>
        rank(a) - rank(b) ||
        (cardOf(b).hp ?? 0) - (cardOf(a).hp ?? 0) ||
        String(a.card_code).localeCompare(b.card_code),
    );
  }
  if (mode === 'hp') {
    return out.sort(
      (a, b) =>
        (cardOf(b).hp ?? -1) - (cardOf(a).hp ?? -1) ||
        String(a.card_code).localeCompare(b.card_code),
    );
  }
  if (mode === 'supertype') {
    const rank = (l: Listing) => {
      const i = POKEMON_SUPERTYPES.indexOf(cardOf(l).supertype ?? '');
      return i < 0 ? 99 : i;
    };
    return out.sort(
      (a, b) => rank(a) - rank(b) || String(a.card_code).localeCompare(b.card_code),
    );
  }
  return out;
}
