import { supabase } from './supabase';

// ---------------------------------------------------------------------------
// Card-scan helpers (One Piece v1).
//
// On-device OCR (ML Kit) gives us a blob of text read off a card photo. The
// number printed on every One Piece card (bottom-left, e.g. "OP10-019") is
// exactly our `cards.card_code` base. Alt-art rows carry a `_pN` suffix in the
// DB but the card still PRINTS the base number, so a base-code lookup always
// resolves. Pokemon prints a collector number ("4/102") that does NOT map to
// our pokemontcg.io ids, so it's intentionally out of scope here.
// ---------------------------------------------------------------------------

export type ScannedCard = {
  card_code: string;
  name: string;
  image_url: string | null;
  type: string | null;
  color: string | null;
  cost: number | null;
};

// Characters OCR commonly confuses for a digit, mapped to the digit. Only
// applied INSIDE the numeric groups of a code (letters never appear there).
const DIGIT_FIX: Record<string, string> = {
  O: '0', Q: '0', D: '0', I: '1', L: '1', S: '5', B: '8', G: '6', Z: '2', T: '7',
};

const DIGITISH = '0-9OQDILSBGZT';

// Standard set code: 2-letter (OP/ST/EB) or 3-letter (PRB) prefix, a 2-digit
// set number, a dash, then a 3-digit card number. Dash/whitespace tolerant.
const STD_RE = new RegExp(`^(OP|ST|EB|PRB)-?([${DIGITISH}]{2})-([${DIGITISH}]{3})$`);
// Promo code: "P-001".
const PROMO_RE = new RegExp(`^P-?([${DIGITISH}]{3})$`);

function fixDigits(s: string): string {
  return s
    .split('')
    .map((c) => (/[0-9]/.test(c) ? c : DIGIT_FIX[c] ?? c))
    .join('');
}

/** Normalize a single token to a canonical card_code, or null if it isn't one. */
export function normalizeCode(raw: string): string | null {
  const s = raw.toUpperCase().replace(/\s+/g, '').replace(/[—–]/g, '-');
  const promo = s.match(PROMO_RE);
  if (promo) return `P-${fixDigits(promo[1])}`;
  const std = s.match(STD_RE);
  if (std) return `${std[1]}${fixDigits(std[2])}-${fixDigits(std[3])}`;
  return null;
}

/** Pull every plausible card_code out of an OCR text blob, in read order. */
export function extractCardCodes(ocrText: string): string[] {
  // Keep dashes so "OP10-019" stays one token; split on everything else.
  const tokens = ocrText.split(/[^A-Za-z0-9-]+/);
  const out: string[] = [];
  for (const t of tokens) {
    const code = normalizeCode(t);
    if (code && !out.includes(code)) out.push(code);
  }
  return out;
}

async function lookupCard(code: string): Promise<ScannedCard | null> {
  const { data, error } = await supabase
    .from('cards')
    .select('card_code,name,image_url,type,color,cost')
    .eq('game', 'optcg')
    .eq('card_code', code)
    .maybeSingle();
  if (error) {
    console.warn('cardScan lookup', error.message);
    return null;
  }
  return (data as ScannedCard) ?? null;
}

export type ScanOutcome = {
  card: ScannedCard | null;
  /** Candidate codes we extracted (for "couldn't find X" messaging). */
  codes: string[];
};

/** Extract codes from OCR text and return the first one that matches a card. */
export async function scanForCard(ocrText: string): Promise<ScanOutcome> {
  const codes = extractCardCodes(ocrText);
  for (const code of codes) {
    const card = await lookupCard(code);
    if (card) return { card, codes };
  }
  return { card: null, codes };
}
