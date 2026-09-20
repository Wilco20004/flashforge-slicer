import { describe, it, expect } from 'vitest';
import { generateWalls, type WallBead } from '../src/slicer/walls';
import { medialChains } from '../src/slicer/medial';
import {
  pt, area, meanWidth, stroke, unionAll, intersection, difference, type Polys,
} from '../src/slicer/polygons';

const W = 0.42;
const rect = (L: number, T: number): Polys => [[pt(-L / 2, -T / 2), pt(L / 2, -T / 2), pt(L / 2, T / 2), pt(-L / 2, T / 2)]];
/** Square annulus: an `outer` square with a concentric hole leaving walls `t` thick. */
const ring = (outer: number, t: number): Polys => {
  const o = outer / 2, i = o - t;
  return [
    [pt(-o, -o), pt(o, -o), pt(o, o), pt(-o, o)],
    [pt(-i, -i), pt(-i, i), pt(i, i), pt(i, -i)],
  ];
};

const walls = (region: Polys, o: Partial<Parameters<typeof generateWalls>[1]> = {}) =>
  generateWalls(region, { loops: 2, outerWidth: W, innerWidth: W, variable: true, ...o });

/** Area the beads actually paint. */
const painted = (beads: WallBead[]): Polys =>
  unionAll(beads.map((b) => stroke([b.pts], b.width, b.closed)));

describe('meanWidth', () => {
  it('is exact for a rectangle, however short', () => {
    expect(meanWidth(rect(30, 1.7))).toBeCloseTo(1.7, 6);
    expect(meanWidth(rect(3, 1.7))).toBeCloseTo(1.7, 6);
    expect(meanWidth(rect(5, 5))).toBeCloseTo(5, 6);
  });
  it('is close for a ring, whose corners no rectangle accounts for', () => {
    expect(meanWidth(ring(20, 1.05))).toBeCloseTo(1.05, 1);
  });
  it('falls back to a disc where no rectangle fits', () => {
    // A regular 64-gon of radius 5 is a disc of diameter 10.
    const disc: Polys = [[]];
    for (let i = 0; i < 64; i++) disc[0].push(pt(5 * Math.cos((i / 64) * 2 * Math.PI), 5 * Math.sin((i / 64) * 2 * Math.PI)));
    expect(meanWidth(disc)).toBeCloseTo(10, 1);
  });
});

describe('generateWalls', () => {
  it('leaves a thick part on nominal widths with a core for infill', () => {
    const r = rect(30, 10);
    const w = walls(r);
    expect(w.beads.length).toBe(2);
    for (const b of w.beads) expect(b.width).toBeCloseTo(W, 6);
    expect(w.beads.map((b) => b.loop)).toEqual([0, 1]);
    // Two loops take 2*W off each side, leaving the core.
    expect(meanWidth(w.inner)).toBeCloseTo(10 - 4 * W, 1);
  });

  it('prints a feature thinner than one line, which fixed widths drop entirely', () => {
    const r = rect(30, 0.3);
    expect(walls(r, { variable: false }).beads.length).toBe(0);
    const w = walls(r);
    expect(w.beads.length).toBe(1);
    expect(w.beads[0].closed).toBe(false);
    expect(w.beads[0].width).toBeCloseTo(0.3, 2);
  });

  it('divides a feature evenly instead of leaving a sliver', () => {
    // 1.0mm is just under two and a half lines: two beads of 0.5 fill it exactly.
    const w = walls(rect(30, 1.0));
    expect(w.beads.length).toBe(1);
    expect(w.beads[0].closed).toBe(true);
    expect(w.beads[0].width).toBeCloseTo(0.5, 2);
    expect(w.inner.length).toBe(0);
  });

  it('puts the odd bead of an odd count down the centre', () => {
    // 1.05mm is two and a half lines, which rounds to three beads of 0.35: a
    // loop for the outer two and a single pass along the middle.
    const w = walls(rect(30, 1.05));
    expect(w.beads.map((b) => b.closed)).toEqual([true, false]);
    for (const b of w.beads) expect(b.width).toBeCloseTo(0.35, 2);
    const mid = w.beads[1].pts.map((p) => Math.abs(p.Y) / 1000);
    expect(Math.max(...mid)).toBeLessThan(0.05);
  });

  it('caps the bead count at the wall loops allowed', () => {
    // 2.0mm would like five beads; two loops can only give four, of 0.5 each.
    const w = walls(rect(30, 2.0));
    expect(w.beads.every((b) => b.closed)).toBe(true);
    for (const b of w.beads) expect(b.width).toBeCloseTo(0.5, 2);
    expect(w.beads.length).toBe(2);
  });

  it('never widens a bead past one and a half lines', () => {
    for (const t of [0.3, 0.5, 0.7, 0.9, 1.1, 1.3, 1.5, 1.7, 1.9, 2.1, 2.3]) {
      for (const b of walls(rect(30, t)).beads) {
        expect(b.width).toBeGreaterThan(W * 0.45);
        expect(b.width).toBeLessThanOrEqual(W * 1.5);
      }
    }
  });

  it('fills a thin feature without spilling outside it', () => {
    for (const t of [0.3, 0.6, 0.85, 1.05, 1.3, 1.7, 2.0]) {
      const r = rect(30, t);
      const p = painted(walls(r).beads);
      const total = area(r);
      const covered = area(intersection(p, r));
      const spill = area(difference(p, r));
      expect(1 - covered / total).toBeLessThan(0.05); // under 5% void
      expect(spill / total).toBeLessThan(0.03);       // under 3% outside the part
    }
  });

  it('lays down the right amount on a slab that is an awkward multiple of a line', () => {
    // Material laid over the part's own cross-section: 1.0 is exactly right.
    // Fixed widths miss in both directions - 1.3mm takes four 0.42 beads where
    // three fit, 2.0mm takes four and leaves a third of a line unfilled.
    const laidOver = (t: number, variable: boolean) => {
      const r = rect(30, t);
      const beads = walls(r, { variable }).beads;
      return beads.reduce((s, b) => s + chain(b) * b.width, 0) / area(r);
    };
    for (const t of [1.3, 2.0]) {
      expect(Math.abs(laidOver(t, true) - 1)).toBeLessThan(0.1);
      expect(Math.abs(laidOver(t, false) - 1)).toBeGreaterThan(0.15);
    }
  });

  it('follows a ring all the way round', () => {
    const w = walls(ring(20, 1.0));
    // A 1.0mm ring wall is two beads: one loop, an outer and an inner contour.
    expect(w.beads.length).toBe(2);
    for (const b of w.beads) {
      expect(b.closed).toBe(true);
      expect(b.width).toBeCloseTo(0.5, 1);
    }
  });

  it('measures a part that is thick at one end and thin at the other separately', () => {
    // A staircase: 3mm for half its length, 0.8mm for the other half.
    const step: Polys = [[
      pt(-15, -1.5), pt(0, -1.5), pt(0, -0.4), pt(15, -0.4),
      pt(15, 0.4), pt(0, 0.4), pt(0, 1.5), pt(-15, 1.5),
    ]];
    const w = walls(step);
    const p = painted(w.beads);
    expect(area(difference(p, step)) / area(step)).toBeLessThan(0.05);
    // The thin half cannot hold a nominal loop and a core, so it gets its own
    // narrower beads rather than the thick half's.
    const widths = new Set(w.beads.map((b) => +b.width.toFixed(2)));
    expect(widths.size).toBeGreaterThan(1);
  });

  it('keeps fixed widths when the option is off', () => {
    for (const t of [1.05, 1.3, 2.0, 5.0]) {
      for (const b of walls(rect(30, t), { variable: false }).beads) expect(b.width).toBeCloseTo(W, 6);
    }
  });

  it('honours the loop count', () => {
    expect(walls(rect(30, 10), { loops: 0 }).beads.length).toBe(0);
    expect(walls(rect(30, 10), { loops: 1 }).beads.length).toBe(1);
    expect(walls(rect(30, 10), { loops: 4 }).beads.length).toBe(4);
  });

  it('uses the outer width for the first loop only', () => {
    const w = walls(rect(30, 10), { outerWidth: 0.5, innerWidth: 0.42 });
    expect(w.beads[0].width).toBeCloseTo(0.5, 6);
    expect(w.beads[1].width).toBeCloseTo(0.42, 6);
  });
});

describe('medialChains', () => {
  it('runs down the middle of a slab, not along one side', () => {
    const chains = medialChains(rect(30, 0.6), 0.6);
    expect(chains.length).toBe(1);
    const ys = chains[0].pts.map((p) => p.Y / 1000);
    // The centre is y = 0; one side would sit at ±0.3.
    expect(Math.max(...ys.map(Math.abs))).toBeLessThan(0.05);
  });
  it('traces a ring as a closed loop', () => {
    const chains = medialChains(ring(20, 0.5), 0.5);
    expect(chains.length).toBe(1);
    expect(chains[0].closed).toBe(true);
  });
  it('gives nothing for an empty region', () => {
    expect(medialChains([], 0.5)).toEqual([]);
  });
});

function chain(b: WallBead): number {
  let len = 0;
  for (let i = 1; i < b.pts.length; i++) len += Math.hypot(b.pts[i].X - b.pts[i - 1].X, b.pts[i].Y - b.pts[i - 1].Y);
  if (b.closed && b.pts.length > 2) {
    len += Math.hypot(b.pts[0].X - b.pts[b.pts.length - 1].X, b.pts[0].Y - b.pts[b.pts.length - 1].Y);
  }
  return len / 1000;
}
