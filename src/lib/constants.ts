export type City = { value: string; label: string };

export const CITIES: City[] = [
  { value: 'nyc', label: 'New York City' },
  { value: 'la', label: 'Los Angeles' },
  { value: 'sf', label: 'San Francisco' },
  { value: 'houston', label: 'Houston' },
  { value: 'dallas', label: 'Dallas' },
];

export const BOROUGHS_BY_CITY: Record<string, string[]> = {
  nyc: ['Manhattan', 'Brooklyn', 'Queens', 'The Bronx', 'Staten Island'],
  la: ['Downtown', 'Hollywood', 'Santa Monica', 'Venice', 'Pasadena', 'Long Beach', 'Koreatown', 'Silver Lake'],
  sf: ['Downtown / Union Square', 'SoMa', 'Mission', 'Castro', 'North Beach', 'Marina', 'Sunset', 'Richmond'],
  houston: ['Downtown', 'Midtown', 'Montrose', 'The Heights', 'Galleria', 'Rice Village', 'Museum District'],
  dallas: ['Downtown', 'Uptown', 'Deep Ellum', 'Bishop Arts', 'Knox-Henderson', 'Lakewood', 'Oak Lawn'],
};

export const BINDER_CATEGORIES = [
  { value: 'optcg', label: 'OPTCG' },
  { value: 'pokemon', label: 'Pokémon' },
] as const;

export type BinderCategory = (typeof BINDER_CATEGORIES)[number]['value'];

export const LISTING_TYPES = [
  { value: 'trade', label: 'Trade Only' },
  { value: 'sell', label: 'Sell Only' },
  { value: 'free', label: 'Free' },
  { value: 'combo', label: 'Trade or Sell' },
] as const;

export type ListingType = (typeof LISTING_TYPES)[number]['value'];

export const BINDER_FLAIRS = [
  { value: 'trade', label: 'Trade' },
  { value: 'wishlist', label: 'Wishlist' },
] as const;

export type BinderFlair = (typeof BINDER_FLAIRS)[number]['value'];
