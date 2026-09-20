/**
 * QR codes for spool labels.
 *
 * qrcode-generator does the encoding. This wraps it in the shape the label art
 * needs: a plain boolean matrix, so the art can pick its own module size (a
 * thermal printer needs whole pixels per module) and so the encoder can be
 * tested without a canvas.
 */
import qrcode from 'qrcode-generator';

/**
 * The library's own stringToBytes keeps the low byte of each UTF-16 unit, which
 * turns any non-ASCII character into a different one and destroys anything
 * outside the BMP. Every code made here is encoded as UTF-8 instead, so a
 * payload carrying an accented colour name scans back as what was printed.
 */
qrcode.stringToBytes = (s: string) => Array.from(new TextEncoder().encode(s));

export type QrEcc = 'L' | 'M' | 'Q' | 'H';

export interface QrMatrix {
  /** Side in modules, excluding the quiet zone. */
  size: number;
  /** Row-major, `size * size` entries; true is a dark module. */
  modules: boolean[];
}

/**
 * @param ecc Error correction level. 'M' (~15% recoverable) is the usual
 *   choice; a label that will get dirty or scuffed is worth 'Q'.
 */
export function encodeQr(text: string, ecc: QrEcc = 'M'): QrMatrix {
  if (!text) throw new Error('Nothing to encode in the QR code');
  const qr = qrcode(0, ecc); // 0: smallest version the data fits in
  qr.addData(text, 'Byte');
  qr.make();
  const size = qr.getModuleCount();
  const modules = new Array<boolean>(size * size);
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) modules[r * size + c] = qr.isDark(r, c);
  }
  return { size, modules };
}

export function qrDark(m: QrMatrix, row: number, col: number): boolean {
  if (row < 0 || col < 0 || row >= m.size || col >= m.size) return false;
  return m.modules[row * m.size + col];
}
