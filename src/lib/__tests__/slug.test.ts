import { binderShareUrl, makeBinderSlug, suffixFromSlug } from '../slug';

const ID = '6a3f9c2e-1b4d-4f8a-9c0d-123456789abc'; // suffix: 6a3f9c2e

describe('makeBinderSlug', () => {
  it('composes owner-name-suffix from display name, binder name, and uuid', () => {
    expect(makeBinderSlug('Jessi', 'My Binder', ID)).toBe('jessi-my-binder-6a3f9c2e');
  });

  it('takes the first 8 hex chars of the uuid (dashes stripped, lowercased)', () => {
    expect(makeBinderSlug('a', 'b', '6A3F-9C2E-1B4D')).toBe('a-b-6a3f9c2e');
  });

  // kebab() is internal; its edge cases are pinned through the slug output.
  describe('kebab behavior (via slug prefix)', () => {
    it('strips diacritics', () => {
      expect(makeBinderSlug('Café Zoë', 'Pokémon', ID)).toBe('cafe-zoe-pokemon-6a3f9c2e');
    });

    it('collapses runs of symbols/whitespace into single dashes', () => {
      expect(makeBinderSlug("Pawpaw's  #1!", 'trade -- binder', ID)).toBe(
        'pawpaw-s-1-trade-binder-6a3f9c2e',
      );
    });

    it('trims leading and trailing dashes', () => {
      expect(makeBinderSlug('--hello--', '!!binder!!', ID)).toBe('hello-binder-6a3f9c2e');
    });

    it('caps each part at 40 characters', () => {
      const fifty = 'a'.repeat(50);
      expect(makeBinderSlug(fifty, fifty, ID)).toBe(`${'a'.repeat(40)}-${'a'.repeat(40)}-6a3f9c2e`);
    });
  });

  describe('fallbacks', () => {
    it('falls back to "someone" and "binder" for null inputs', () => {
      expect(makeBinderSlug(null, null, ID)).toBe('someone-binder-6a3f9c2e');
    });

    it('falls back when kebab reduces a name to nothing', () => {
      expect(makeBinderSlug('!!!', '???', ID)).toBe('someone-binder-6a3f9c2e');
    });

    it('falls back for empty strings', () => {
      expect(makeBinderSlug('', '', ID)).toBe('someone-binder-6a3f9c2e');
    });
  });
});

describe('binderShareUrl', () => {
  it('points at the web binders route with the pretty slug', () => {
    expect(binderShareUrl('Jessi', 'My Binder', ID)).toBe(
      'https://pawpawko.com/binders/jessi-my-binder-6a3f9c2e',
    );
  });
});

describe('suffixFromSlug', () => {
  it('extracts the trailing 8-char hex suffix from a plain slug', () => {
    expect(suffixFromSlug('jessi-my-binder-6a3f9c2e')).toBe('6a3f9c2e');
  });

  it('extracts the suffix from a slug embedded in a URL', () => {
    expect(suffixFromSlug('https://pawpawko.com/binders/jessi-my-binder-6a3f9c2e')).toBe('6a3f9c2e');
  });

  it('handles trailing slash and query string after the suffix', () => {
    expect(suffixFromSlug('https://pawpawko.com/binders/x-y-6a3f9c2e/')).toBe('6a3f9c2e');
    expect(suffixFromSlug('https://pawpawko.com/binders/x-y-6a3f9c2e?ref=qr')).toBe('6a3f9c2e');
  });

  it('lowercases an uppercase hex suffix', () => {
    expect(suffixFromSlug('jessi-my-binder-6A3F9C2E')).toBe('6a3f9c2e');
  });

  it('returns null for garbage input', () => {
    expect(suffixFromSlug('hello world')).toBeNull();
    expect(suffixFromSlug('')).toBeNull();
    expect(suffixFromSlug('short-1a2b')).toBeNull();
    // 8 hex chars followed by more slug text is not a valid suffix position.
    expect(suffixFromSlug('deadbeef-not-at-end')).toBeNull();
  });
});
