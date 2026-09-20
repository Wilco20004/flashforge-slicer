/**
 * The picture that goes on a spool label: a QR code and a colour patch.
 *
 * A LabelForge template has room for exactly one image, and the caller supplies
 * it, so both have to share one bitmap. Three things about how LabelForge and
 * brother_ql treat that bitmap drive everything here:
 *
 * 1. The image is resized to the template block's exact pixel size before it is
 *    pasted. Producing it at any other size runs it through a bicubic resample
 *    that smears the QR modules into grey. So the caller passes the block's own
 *    width and height and gets a bitmap of exactly that size.
 * 2. brother_ql reduces the finished label to one bit per pixel: it inverts,
 *    then keeps everything that started darker than luminance 179. So a colour
 *    does not print as a tone — it is all ink or none, and a navy and a black
 *    spool come out as the same solid block.
 * 3. So the art is rasterised here as pure black and white, and the colour patch
 *    is an ordered dither whose black fraction is the colour's darkness. Being
 *    one bit already, it passes the threshold untouched and prints as a tone.
 *    The hue itself is carried by the colour name and hex in the template's text.
 *
 * Rasterising in plain arrays (rather than drawing on a canvas and letting it
 * anti-alias) is also what makes the result testable without a DOM.
 */
import { encodeQr, qrDark, type QrEcc, type QrMatrix } from './qr';
import { luminance } from '../profiles/spools';

export interface SpoolArtOptions {
  /** Pixel size of the template's image block. */
  width: number;
  height: number;
  /** Text for the QR code; '' leaves it out. */
  qrText?: string;
  /** `#rrggbb` for the colour patch; '' leaves it out. */
  color?: string;
  ecc?: QrEcc;
}

export interface QrBox {
  x: number;
  y: number;
  /** Pixels per QR module. Below 3 a 300dpi label gets hard to scan. */
  moduleSize: number;
  /** Blank modules kept around the code; the spec asks for 4. */
  quietModules: number;
  matrix: QrMatrix;
}

export interface SwatchBox {
  x: number;
  y: number;
  width: number;
  height: number;
  border: number;
  /** 0 (white filament) to 1 (black filament) — the fraction of black pixels. */
  darkness: number;
}

export interface SpoolArt {
  width: number;
  height: number;
  qr: QrBox | null;
  swatch: SwatchBox | null;
  /** Why the result may not scan or read well, for the UI to pass on. */
  warning: string | null;
}

/** Ordered 4x4 Bayer matrix: the classic threshold map for one-bit tone. */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const BAYER_N = 4;

/**
 * Module size below which a 300dpi thermal label stops scanning reliably.
 * Measured by pushing the art through LabelForge's renderer and brother_ql's
 * conversion and reading it back: 3 px always decoded, 2 px decoded for some
 * block sizes and not others, 1 px never did.
 */
const MIN_COMFORTABLE_MODULE = 3;

/** Blank modules the QR spec asks for around a code. */
const QUIET_MODULES = 4;

/** Largest module size that fits `side` pixels, trying the widest quiet zone first. */
function fitQr(matrix: QrMatrix, side: number): { moduleSize: number; quietModules: number } | null {
  let best: { moduleSize: number; quietModules: number } | null = null;
  for (const quiet of [QUIET_MODULES, 3, 2, 1]) {
    const moduleSize = Math.floor(side / (matrix.size + 2 * quiet));
    if (moduleSize < 1) continue;
    // A wider quiet zone is only worth having if it costs no module size, so
    // the first candidate that ties the best is the one kept.
    if (!best || moduleSize > best.moduleSize) best = { moduleSize, quietModules: quiet };
  }
  return best;
}

export function layoutSpoolArt(o: SpoolArtOptions): SpoolArt {
  const width = Math.max(1, Math.floor(o.width));
  const height = Math.max(1, Math.floor(o.height));
  const qrText = (o.qrText ?? '').trim();
  const color = (o.color ?? '').trim();
  const art: SpoolArt = { width, height, qr: null, swatch: null, warning: null };

  const gap = qrText && color ? Math.max(2, Math.round(Math.min(width, height) * 0.06)) : 0;
  // Landscape blocks put the code and the patch side by side, portrait ones
  // stack them; either way the code gets a square and the patch gets the rest.
  const horizontal = width >= height;
  // How much of the block the code may use. With no patch beside it, all of it.
  const region = color
    ? (horizontal ? { w: Math.max(0, Math.min(height, width - gap)), h: height }
                  : { w: width, h: Math.max(0, Math.min(width, height - gap)) })
    : { w: width, h: height };
  /** Pixels along the edge the patch starts after; 0 once there is no code. */
  let qrExtent = 0;

  if (qrText && region.w > 0 && region.h > 0) {
    const matrix = encodeQr(qrText, o.ecc ?? 'M');
    const side = Math.min(region.w, region.h);
    const fit = fitQr(matrix, side);
    if (!fit) {
      art.warning = `The QR code needs at least ${matrix.size + 2} px and the image block only offers ${side}. It has been left off.`;
    } else {
      const drawn = fit.moduleSize * (matrix.size + 2 * fit.quietModules);
      art.qr = {
        x: Math.floor((region.w - drawn) / 2),
        y: Math.floor((region.h - drawn) / 2),
        moduleSize: fit.moduleSize,
        quietModules: fit.quietModules,
        matrix,
      };
      qrExtent = horizontal ? region.w : region.h;
      if (fit.moduleSize < MIN_COMFORTABLE_MODULE) {
        art.warning = `Each QR module is only ${fit.moduleSize} px. Give the template's image block more room, or shorten the QR text, if it does not scan.`;
      }
    }
  }

  if (color) {
    // A squeezed quiet zone is made up on the side facing the patch, which is
    // the only side not already looking out onto blank label. Capped so the
    // patch keeps a quarter of the block rather than being squeezed away.
    let pad = gap;
    if (art.qr && qrExtent > 0) {
      const shortfall = Math.max(0, QUIET_MODULES - art.qr.quietModules) * art.qr.moduleSize;
      const span = horizontal ? width : height;
      pad = Math.min(Math.max(gap, shortfall), Math.max(gap, span - qrExtent - Math.round(span * 0.25)));
    }
    const offset = qrExtent > 0 ? qrExtent + pad : 0;
    const x = horizontal ? offset : 0;
    const y = horizontal ? 0 : offset;
    const w = horizontal ? width - offset : width;
    const h = horizontal ? height : height - offset;
    if (w > 0 && h > 0) {
      art.swatch = {
        x, y, width: w, height: h,
        border: Math.max(1, Math.round(Math.min(w, h) / 24)),
        darkness: 1 - luminance(color),
      };
    }
  }

  return art;
}

/**
 * One byte per pixel, 0 (black) or 255 (white), row-major. Nothing in between:
 * every pixel here has already survived the printer's threshold.
 */
export function rasterizeSpoolArt(art: SpoolArt): Uint8Array {
  const px = new Uint8Array(art.width * art.height).fill(255);
  const set = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= art.width || y >= art.height) return;
    px[y * art.width + x] = 0;
  };

  if (art.qr) {
    const { matrix, moduleSize, quietModules, x: ox, y: oy } = art.qr;
    for (let r = 0; r < matrix.size; r++) {
      for (let c = 0; c < matrix.size; c++) {
        if (!qrDark(matrix, r, c)) continue;
        const x0 = ox + (c + quietModules) * moduleSize;
        const y0 = oy + (r + quietModules) * moduleSize;
        for (let dy = 0; dy < moduleSize; dy++) for (let dx = 0; dx < moduleSize; dx++) set(x0 + dx, y0 + dy);
      }
    }
  }

  if (art.swatch) {
    const s = art.swatch;
    for (let y = 0; y < s.height; y++) {
      for (let x = 0; x < s.width; x++) {
        const edge = x < s.border || y < s.border || x >= s.width - s.border || y >= s.height - s.border;
        // +0.5 centres each of the 16 thresholds in its band, so darkness 0 is
        // an empty patch and darkness 1 a full one, with no off-by-one bias.
        const threshold = (BAYER[(y % BAYER_N) * BAYER_N + (x % BAYER_N)] + 0.5) / (BAYER_N * BAYER_N);
        if (edge || s.darkness > threshold) set(s.x + x, s.y + y);
      }
    }
  }

  return px;
}

/** Fraction of the swatch that came out black — what the dither actually achieved. */
export function swatchInk(art: SpoolArt, px: Uint8Array): number {
  const s = art.swatch;
  if (!s) return 0;
  let dark = 0;
  for (let y = s.border; y < s.height - s.border; y++) {
    for (let x = s.border; x < s.width - s.border; x++) {
      if (px[(s.y + y) * art.width + (s.x + x)] === 0) dark++;
    }
  }
  const inner = Math.max(1, (s.width - 2 * s.border) * (s.height - 2 * s.border));
  return dark / inner;
}

/** Bare base64 (no data: prefix) PNG of the art, which is what LabelForge wants. */
export function spoolArtPng(o: SpoolArtOptions): { base64: string; art: SpoolArt } {
  const art = layoutSpoolArt(o);
  const px = rasterizeSpoolArt(art);
  const canvas = document.createElement('canvas');
  canvas.width = art.width;
  canvas.height = art.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser would not give a 2D canvas to draw the label on');
  const img = ctx.createImageData(art.width, art.height);
  for (let i = 0; i < px.length; i++) {
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = px[i];
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return { base64: canvas.toDataURL('image/png').split(',')[1] ?? '', art };
}
