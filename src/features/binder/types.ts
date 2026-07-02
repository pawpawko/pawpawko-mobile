export type Flair = 'trade' | 'wishlist';

export type Listing = {
  id: string;
  card_code: string;
  quantity: number;
  listing_type: string;
  sort_order: number | null;
  deck_id?: string | null; // set on deck-synced wishlist rows (owner read only)
};

export type CardInfo = {
  card_code: string;
  name: string | null;
  image_url: string | null;
  image_url_lg: string | null;
  // Sort-mode columns (optional — only fetched when present).
  color?: string | null;
  cost?: number | null;
  types?: string[] | null;
  supertype?: string | null;
  hp?: number | null;
  ram?: number | null; // Cyberpunk deck-building stat
  type?: string | null; // Cyberpunk Legend/Unit/Gear/Program
  rarity?: string | null;
  release_order?: number | null;
};
