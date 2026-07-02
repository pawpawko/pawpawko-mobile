import { extractCardCodes, normalizeCode } from '../cardScan';

// cardScan.ts imports './supabase' at module top level (which pulls in
// react-native-url-polyfill + AsyncStorage), so the client module is mocked
// out (jest.mock is hoisted above the import). Only the pure
// extraction/normalization logic is exercised here; lookupCard/scanForCard
// (network) are intentionally not tested.
jest.mock('../supabase', () => ({ supabase: {} }));

describe('normalizeCode', () => {
  it('accepts standard set codes for every prefix', () => {
    expect(normalizeCode('OP10-019')).toBe('OP10-019');
    expect(normalizeCode('ST01-001')).toBe('ST01-001');
    expect(normalizeCode('EB01-061')).toBe('EB01-061');
    expect(normalizeCode('PRB01-002')).toBe('PRB01-002');
  });

  it('accepts promo codes', () => {
    expect(normalizeCode('P-001')).toBe('P-001');
    expect(normalizeCode('P001')).toBe('P-001');
  });

  it('is case, whitespace, and dash-variant tolerant', () => {
    expect(normalizeCode('op10-019')).toBe('OP10-019');
    expect(normalizeCode('OP 10 - 019')).toBe('OP10-019');
    expect(normalizeCode('OP10—019')).toBe('OP10-019'); // em dash
    expect(normalizeCode('OP10–019')).toBe('OP10-019'); // en dash
  });

  it('requires the dash before the 3-digit card number', () => {
    // The dash after the letter prefix is optional; this one is not.
    expect(normalizeCode('OP10019')).toBeNull();
  });

  it('fixes OCR digit confusions inside numeric groups', () => {
    expect(normalizeCode('OPIO-OI9')).toBe('OP10-019'); // I->1, O->0
    expect(normalizeCode('OP1O-0S9')).toBe('OP10-059'); // O->0, S->5
    expect(normalizeCode('ST0L-0B8')).toBe('ST01-088'); // L->1, B->8
    expect(normalizeCode('EB0I-0G2')).toBe('EB01-062'); // I->1, G->6
    expect(normalizeCode('P-0Z1')).toBe('P-021'); // Z->2
    expect(normalizeCode('OP1D-T01')).toBe('OP10-701'); // D->0, T->7
    expect(normalizeCode('OPQ1-QQ1')).toBe('OP01-001'); // Q->0
  });

  it('never rewrites the letter prefix', () => {
    // "0P10-019" has a zero where the O of OP should be; prefix must be exact.
    expect(normalizeCode('0P10-019')).toBeNull();
  });

  it('rejects non-codes', () => {
    expect(normalizeCode('')).toBeNull();
    expect(normalizeCode('Monkey D. Luffy')).toBeNull();
    expect(normalizeCode('XX10-019')).toBeNull(); // unknown prefix
    expect(normalizeCode('OP1-019')).toBeNull(); // set number must be 2 digits
    expect(normalizeCode('OP10-19')).toBeNull(); // card number must be 3 digits
    expect(normalizeCode('OP10-0195')).toBeNull(); // too long
    expect(normalizeCode('4/102')).toBeNull(); // Pokemon collector number: out of scope
  });
});

describe('extractCardCodes', () => {
  it('pulls every plausible code out of an OCR blob in read order', () => {
    const blob = 'CHARACTER 5000 POWER\nOP10-019 (C)\nMonkey D. Luffy\nST01-001';
    expect(extractCardCodes(blob)).toEqual(['OP10-019', 'ST01-001']);
  });

  it('keeps dashed codes as one token across punctuation splits', () => {
    expect(extractCardCodes('foo,OP10-019;bar')).toEqual(['OP10-019']);
  });

  it('normalizes OCR digit confusions during extraction', () => {
    expect(extractCardCodes('OPIO-OI9')).toEqual(['OP10-019']);
  });

  it('deduplicates repeated codes', () => {
    expect(extractCardCodes('OP10-019 op10-019 OP10-019')).toEqual(['OP10-019']);
  });

  it('returns an empty array when nothing matches', () => {
    expect(extractCardCodes('')).toEqual([]);
    expect(extractCardCodes('Just some flavor text 5000 POWER')).toEqual([]);
  });
});
