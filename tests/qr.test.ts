import { describe, it, expect } from 'vitest';
import { encodeQr, qrDark, type QrMatrix } from '../src/label/qr';

/** The 7x7 finder pattern: dark ring, light ring, solid 3x3 core. */
function isFinder(m: QrMatrix, row: number, col: number): boolean {
  for (let r = 0; r < 7; r++) {
    for (let c = 0; c < 7; c++) {
      const ring = r === 0 || r === 6 || c === 0 || c === 6;
      const core = r >= 2 && r <= 4 && c >= 2 && c <= 4;
      if (qrDark(m, row + r, col + c) !== (ring || core)) return false;
    }
  }
  return true;
}

describe('encodeQr', () => {
  it('produces a square of the version size', () => {
    const m = encodeQr('K7M2QX');
    // Version 1 is 21 modules; every version adds 4.
    expect(m.size).toBe(21);
    expect(m.modules.length).toBe(21 * 21);
    expect(m.modules.every((v) => typeof v === 'boolean')).toBe(true);
  });

  it('places the three finder patterns the right way round', () => {
    const m = encodeQr('http://192.168.1.4:8099/#spool=K7M2QX');
    expect(isFinder(m, 0, 0)).toBe(true);
    expect(isFinder(m, 0, m.size - 7)).toBe(true);
    expect(isFinder(m, m.size - 7, 0)).toBe(true);
    // The fourth corner is data, never a finder — this is what catches a
    // transposed or flipped matrix, which would still look plausible.
    expect(isFinder(m, m.size - 7, m.size - 7)).toBe(false);
  });

  it('runs the timing patterns along row and column 6', () => {
    const m = encodeQr('timing');
    for (let i = 8; i < m.size - 8; i++) {
      expect(qrDark(m, 6, i)).toBe(i % 2 === 0);
      expect(qrDark(m, i, 6)).toBe(i % 2 === 0);
    }
  });

  it('always sets the dark module below the top-left finder', () => {
    expect(qrDark(encodeQr('dark module'), encodeQr('dark module').size - 8, 8)).toBe(true);
  });

  it('grows to a bigger version as the payload grows', () => {
    const small = encodeQr('a'.repeat(10)).size;
    const large = encodeQr('a'.repeat(200)).size;
    expect(large).toBeGreaterThan(small);
    expect((large - 21) % 4).toBe(0);
  });

  it('encodes as UTF-8, not one byte per UTF-16 unit', () => {
    // The library's own stringToBytes keeps the low byte of each unit, so these
    // ten characters would be ten bytes and fit version 1 (14 data bytes at
    // level M). As UTF-8 they are twenty bytes and need version 2.
    expect(encodeQr('é'.repeat(10)).size).toBe(25);
    // ...and the encoder must actually accept them rather than mangling them.
    expect(encodeQr('Grün · 220 °C').size).toBeGreaterThanOrEqual(21);
  });

  it('raises the version when more error correction is asked for', () => {
    const text = 'a'.repeat(100);
    expect(encodeQr(text, 'H').size).toBeGreaterThan(encodeQr(text, 'L').size);
  });

  it('refuses an empty payload rather than printing a meaningless code', () => {
    expect(() => encodeQr('')).toThrow(/nothing to encode/i);
  });

  it('reads outside the matrix as light', () => {
    const m = encodeQr('bounds');
    expect(qrDark(m, -1, 0)).toBe(false);
    expect(qrDark(m, 0, m.size)).toBe(false);
  });
});
