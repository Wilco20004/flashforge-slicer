import { describe, it, expect } from 'vitest';
import { layoutSpoolArt, rasterizeSpoolArt, swatchInk, type SpoolArt } from '../src/label/spoolArt';

const QR = 'http://192.168.1.4:8099/#spool=K7M2QX';

const render = (o: Parameters<typeof layoutSpoolArt>[0]) => {
  const art = layoutSpoolArt(o);
  return { art, px: rasterizeSpoolArt(art) };
};

/** Every pixel of the QR's own quiet zone, on all four sides. */
function quietZoneIsClear(art: SpoolArt, px: Uint8Array): boolean {
  const q = art.qr!;
  const band = q.quietModules * q.moduleSize;
  const side = q.matrix.size * q.moduleSize + 2 * band;
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const inside = x >= band && y >= band && x < side - band && y < side - band;
      if (inside) continue;
      if (px[(q.y + y) * art.width + (q.x + x)] === 0) return false;
    }
  }
  return true;
}

describe('the bitmap LabelForge is handed', () => {
  it('is exactly the size of the template\'s image block', () => {
    // Anything else gets bicubically resampled on the way in, which turns the
    // QR modules to mush before the printer's threshold sees them.
    const { art, px } = render({ width: 240, height: 96, qrText: QR, color: '#1a1a1a' });
    expect(art.width).toBe(240);
    expect(art.height).toBe(96);
    expect(px.length).toBe(240 * 96);
  });

  it('is pure black and white, with nothing the printer would throw away', () => {
    const { px } = render({ width: 240, height: 96, qrText: QR, color: '#8a5cc4' });
    // brother_ql keeps a pixel only below about 76/255; a grey would vanish.
    expect([...new Set(px)].sort()).toEqual([0, 255]);
  });

  it('floors the QR to whole pixels per module', () => {
    const { art } = render({ width: 240, height: 96, qrText: QR, color: '#1a1a1a' });
    expect(Number.isInteger(art.qr!.moduleSize)).toBe(true);
    expect(art.qr!.moduleSize).toBeGreaterThanOrEqual(1);
  });

  it('keeps the quiet zone genuinely blank', () => {
    const { art, px } = render({ width: 240, height: 96, qrText: QR, color: '#1a1a1a' });
    expect(art.qr!.quietModules).toBeGreaterThanOrEqual(1);
    expect(quietZoneIsClear(art, px)).toBe(true);
  });

  it('keeps the code and the patch from overlapping', () => {
    const { art } = render({ width: 240, height: 96, qrText: QR, color: '#1a1a1a' });
    const q = art.qr!, s = art.swatch!;
    const qrRight = q.x + q.moduleSize * (q.matrix.size + 2 * q.quietModules);
    expect(s.x).toBeGreaterThanOrEqual(qrRight);
  });

  it('leaves four modules of white between the code and the patch', () => {
    // The other three sides of the code look out onto blank label, so this is
    // the only edge where a squeezed quiet zone has to be made up.
    const { art } = render({ width: 240, height: 96, qrText: QR, color: '#000000' });
    const q = art.qr!;
    expect(q.quietModules).toBeLessThan(4); // this block does squeeze it
    const lastDarkColumn = q.x + q.moduleSize * (q.matrix.size + q.quietModules);
    expect(art.swatch!.x - lastDarkColumn).toBeGreaterThanOrEqual(4 * q.moduleSize);
  });

  it('does not squeeze the patch away to buy that white', () => {
    const { art } = render({ width: 240, height: 96, qrText: QR, color: '#000000' });
    expect(art.swatch!.width).toBeGreaterThanOrEqual(240 * 0.25);
  });
});

describe('layout', () => {
  it('puts the patch beside the code on a wide block', () => {
    const art = layoutSpoolArt({ width: 240, height: 96, qrText: QR, color: '#1a1a1a' });
    expect(art.swatch!.x).toBeGreaterThan(0);
    expect(art.swatch!.y).toBe(0);
    expect(art.swatch!.height).toBe(96);
  });

  it('stacks them on a tall block', () => {
    const art = layoutSpoolArt({ width: 96, height: 240, qrText: QR, color: '#1a1a1a' });
    expect(art.swatch!.x).toBe(0);
    expect(art.swatch!.y).toBeGreaterThan(0);
    expect(art.swatch!.width).toBe(96);
  });

  it('centres the code across the whole block when there is no colour', () => {
    const art = layoutSpoolArt({ width: 240, height: 96, qrText: QR });
    expect(art.swatch).toBeNull();
    const drawn = art.qr!.moduleSize * (art.qr!.matrix.size + 2 * art.qr!.quietModules);
    expect(art.qr!.x).toBe(Math.floor((240 - drawn) / 2));
    expect(art.qr!.y).toBe(Math.floor((96 - drawn) / 2));
  });

  it('gives the whole block to the patch when there is no QR text', () => {
    const art = layoutSpoolArt({ width: 240, height: 96, color: '#1a1a1a' });
    expect(art.qr).toBeNull();
    expect(art.swatch).toMatchObject({ x: 0, y: 0, width: 240, height: 96 });
  });

  it('draws nothing at all when asked for neither', () => {
    const art = layoutSpoolArt({ width: 240, height: 96 });
    expect(art.qr).toBeNull();
    expect(art.swatch).toBeNull();
    expect(rasterizeSpoolArt(art).every((v) => v === 255)).toBe(true);
  });
});

describe('when the image block is too small', () => {
  it('warns while the code is still just about printable', () => {
    const art = layoutSpoolArt({ width: 60, height: 60, qrText: QR });
    expect(art.qr).not.toBeNull();
    expect(art.qr!.moduleSize).toBeLessThan(3);
    expect(art.warning).toMatch(/module is only \d+ px/);
  });

  it('leaves the code off entirely rather than emitting an unreadable smear', () => {
    const art = layoutSpoolArt({ width: 12, height: 12, qrText: QR, color: '#1a1a1a' });
    expect(art.qr).toBeNull();
    expect(art.warning).toMatch(/left off/);
    // The patch still gets the block, so the label is not simply blank.
    expect(art.swatch).not.toBeNull();
  });

  it('says nothing when the block is comfortable', () => {
    expect(layoutSpoolArt({ width: 300, height: 150, qrText: QR, color: '#1a1a1a' }).warning).toBeNull();
  });
});

describe('the colour patch', () => {
  const patch = (color: string) => {
    const { art, px } = render({ width: 64, height: 64, color });
    return swatchInk(art, px);
  };

  it('inks roughly in proportion to how dark the filament is', () => {
    expect(patch('#000000')).toBeCloseTo(1, 2);
    expect(patch('#ffffff')).toBeCloseTo(0, 2);
    // Mid grey: half the pixels, which is what makes it readable as a tone
    // rather than disappearing at the printer's threshold.
    expect(patch('#808080')).toBeGreaterThan(0.4);
    expect(patch('#808080')).toBeLessThan(0.6);
  });

  it('is monotonic, so two spools of different lightness look different', () => {
    const steps = ['#ffffff', '#cccccc', '#808080', '#404040', '#000000'].map(patch);
    for (let i = 1; i < steps.length; i++) expect(steps[i]).toBeGreaterThan(steps[i - 1]);
  });

  it('keeps a border so a white filament still shows where the patch is', () => {
    const { art, px } = render({ width: 64, height: 64, color: '#ffffff' });
    const s = art.swatch!;
    expect(s.border).toBeGreaterThanOrEqual(1);
    expect(px[s.y * art.width + s.x]).toBe(0);
    expect(px[(s.y + s.height - 1) * art.width + (s.x + s.width - 1)]).toBe(0);
    // ...and nothing inside it, since white filament has no tone to show.
    expect(swatchInk(art, px)).toBe(0);
  });

  it('is deterministic, so reprinting a spool gives the same label', () => {
    const a = render({ width: 240, height: 96, qrText: QR, color: '#2f6fb2' });
    const b = render({ width: 240, height: 96, qrText: QR, color: '#2f6fb2' });
    expect(Array.from(a.px)).toEqual(Array.from(b.px));
  });
});
