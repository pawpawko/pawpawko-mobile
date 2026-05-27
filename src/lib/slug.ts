// Pretty share-link slug. Format: <owner>-<binder-name>-<first-8-hex-of-uuid>
// The 8-char hex suffix is the disambiguator; the prefix is cosmetic.

function kebab(s: string): string {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

export function makeBinderSlug(displayName: string | null, binderName: string | null, id: string): string {
  const owner = kebab(displayName ?? 'someone') || 'someone';
  const name = kebab(binderName ?? 'binder') || 'binder';
  const suffix = id.replace(/-/g, '').slice(0, 8).toLowerCase();
  return `${owner}-${name}-${suffix}`;
}

// Pretty share URL pointing at the web binder page (Netlify rewrite handles it).
export function binderShareUrl(displayName: string | null, binderName: string | null, id: string): string {
  return `https://pawpawko.com/binders/${makeBinderSlug(displayName, binderName, id)}`;
}

// Extract the trailing 8-char hex suffix from a pretty slug. Used by the QR
// scanner to short-circuit a full RPC round-trip when the URL is a slug.
export function suffixFromSlug(slug: string): string | null {
  const m = slug.match(/[0-9a-f]{8}(?:[\/?#]|$)/i);
  return m ? m[0].slice(0, 8).toLowerCase() : null;
}
