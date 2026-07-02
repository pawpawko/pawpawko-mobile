import { CATEGORY_STYLES, FLAIR_STYLES, LISTING_TYPES } from '../binder-constants';

describe('LISTING_TYPES', () => {
  it('has exactly the four listing type values', () => {
    expect(LISTING_TYPES.map((t) => t.value)).toEqual(['trade', 'sell', 'free', 'combo']);
  });

  it('has a non-empty label for every listing type', () => {
    for (const t of LISTING_TYPES) {
      expect(typeof t.label).toBe('string');
      expect(t.label.length).toBeGreaterThan(0);
    }
  });
});

describe('FLAIR_STYLES', () => {
  it('has exactly the expected flair keys', () => {
    expect(Object.keys(FLAIR_STYLES).sort()).toEqual(['flex', 'lgs', 'trade', 'wishlist']);
  });

  it('has a label and a hex color for every flair', () => {
    for (const style of Object.values(FLAIR_STYLES)) {
      expect(style.label.length).toBeGreaterThan(0);
      expect(style.color).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

describe('CATEGORY_STYLES', () => {
  it('has exactly the expected game keys', () => {
    expect(Object.keys(CATEGORY_STYLES).sort()).toEqual(['optcg', 'pokemon']);
  });

  it('has a label and a hex color for every game', () => {
    for (const style of Object.values(CATEGORY_STYLES)) {
      expect(style.label.length).toBeGreaterThan(0);
      expect(style.color).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});
