// Mirrors the constants used by the web app's binder-view.js so the
// mobile edit-mode UI offers the same filter/sort options.

export const OPTCG_COLORS = ['Red', 'Blue', 'Green', 'Purple', 'Black', 'Yellow'];
export const OPTCG_TYPES = ['LEADER', 'CHARACTER', 'EVENT', 'STAGE'];
export const OPTCG_ATTRIBUTES = ['Slash', 'Strike', 'Special', 'Wisdom', 'Ranged'];
export const OPTCG_RARITIES = ['L', 'C', 'UC', 'R', 'SR', 'SEC', 'P'];
export const OPTCG_COSTS = Array.from({ length: 11 }, (_, i) => i);

export const POKEMON_TYPES = [
  'Grass', 'Fire', 'Water', 'Lightning', 'Psychic', 'Fighting',
  'Darkness', 'Metal', 'Dragon', 'Colorless', 'Fairy',
];
export const POKEMON_SUPERTYPES = ['Pokémon', 'Trainer', 'Energy'];
export const POKEMON_SUBTYPES = [
  'Basic', 'Stage 1', 'Stage 2', 'V', 'VMAX', 'VSTAR', 'ex', 'EX', 'GX',
  'BREAK', 'Mega', 'LEGEND', 'Tag Team', 'Radiant', 'Item', 'Tool', 'Stadium', 'Supporter',
];
export const POKEMON_RARITIES = [
  'Common', 'Uncommon', 'Rare', 'Rare Holo', 'Rare Holo EX', 'Rare Holo GX',
  'Rare Holo V', 'Rare Holo VMAX', 'Rare Ultra', 'Rare Secret', 'Rare Rainbow',
  'Radiant Rare', 'Amazing Rare', 'Illustration Rare', 'Special Illustration Rare',
  'Hyper Rare', 'Double Rare', 'Promo',
];
export const POKEMON_HP_BUCKETS = [30, 60, 90, 120, 150, 180, 210, 240, 270, 300];

// Cyberpunk TCG: color + card_type, classifications (tags, the types[] column),
// RAM (deck-building stat), rarities. Mirrors web binder-view.js /
// scripts/import_cyberpunk_cards.py.
export const CYBERPUNK_COLORS = ['Red', 'Blue', 'Green', 'Yellow'];
export const CYBERPUNK_TYPES = ['Legend', 'Unit', 'Gear', 'Program'];
export const CYBERPUNK_RARITIES = ['Common', 'Uncommon', 'Rare', 'Epic'];
export const CYBERPUNK_RAM = [1, 2, 3, 4, 5, 6];
export const CYBERPUNK_COSTS = Array.from({ length: 9 }, (_, i) => i + 1); // 1..9
export const CYBERPUNK_TAGS = [
  '6th Street', 'Aldecado', 'Arasaka', 'Braindance', 'Corpo', 'Cyberware', 'Doll',
  'Drone', 'Extreme', 'Ganger', 'Maelstrom', 'Merc', 'Militech', 'Mox', 'Mystic',
  'NCPD', 'Netrunner', 'Nomad', 'Quickhack', 'Raffen Shiv', 'Ripperdoc', 'Rocker',
  'Samurai', 'Scavenger', 'Trauma Team', 'Tyger Claws', 'Valentino', 'Vehicle',
  'Voodoo Boys', 'Weapon', 'Zetatech',
];

export const COLOR_ORDER = ['Red', 'Blue', 'Green', 'Purple', 'Black', 'Yellow'];

// Mirrors the web CSS flair palette: trade blue, wishlist purple, flex tan,
// lgs green. Labels match FLAIR_LABELS in web's binder-view.js.
export const FLAIR_STYLES: Record<string, { label: string; color: string }> = {
  trade: { label: 'Trade', color: '#6a9bc9' },
  wishlist: { label: 'Wishlist', color: '#7ec96a' },
  flex: { label: 'Flex', color: '#ddb896' },
  lgs: { label: 'Local Game Store', color: '#5a9d7a' },
};

// Game tag pill palette — same shape/size, distinct from flair colors.
export const CATEGORY_STYLES: Record<string, { label: string; color: string }> = {
  optcg: { label: 'One Piece', color: '#c9956a' },
  pokemon: { label: 'Pokémon', color: '#e8b757' },
  cyberpunk: { label: 'Cyberpunk', color: '#5aa9bf' },
};

export const LISTING_TYPES = [
  { value: 'trade', label: 'Trade Only' },
  { value: 'sell', label: 'Sell Only' },
  { value: 'free', label: 'Free' },
  { value: 'combo', label: 'Trade or Sell' },
] as const;

export type ListingType = (typeof LISTING_TYPES)[number]['value'];

export type SortMode =
  | 'custom-4x3'
  | 'custom-3x3'
  | 'release'
  | 'color'
  | 'cost'
  | 'ram'
  | 'ptype'
  | 'hp'
  | 'supertype';

export const SORT_MODES_OPTCG: { value: SortMode; label: string }[] = [
  { value: 'custom-4x3', label: 'Custom (4×3)' },
  { value: 'custom-3x3', label: 'Custom (3×3)' },
  { value: 'release', label: 'Release order' },
  { value: 'color', label: 'Color' },
  { value: 'cost', label: 'Cost' },
];

export const SORT_MODES_POKEMON: { value: SortMode; label: string }[] = [
  { value: 'custom-4x3', label: 'Custom (4×3)' },
  { value: 'custom-3x3', label: 'Custom (3×3)' },
  { value: 'release', label: 'Release order' },
  { value: 'ptype', label: 'Element type' },
  { value: 'hp', label: 'HP' },
  { value: 'supertype', label: 'Supertype' },
];

export const SORT_MODES_CYBERPUNK: { value: SortMode; label: string }[] = [
  { value: 'custom-4x3', label: 'Custom (4×3)' },
  { value: 'custom-3x3', label: 'Custom (3×3)' },
  { value: 'release', label: 'Release order' },
  { value: 'color', label: 'Color' },
  { value: 'cost', label: 'Cost' },
  { value: 'ram', label: 'RAM' },
];

export const PAGE_SIZE = { '3x3': 9, '4x3': 12 } as const;
export type Layout = '3x3' | '4x3';
