import { describe, it, expect } from 'vitest';
import { sliceMesh, layerHeights } from '../src/slicer/slice';
import { area, polyArea, simplify, pt, toMm } from '../src/slicer/polygons';
import { boxMesh, tubeMesh, slabMesh } from './fixtures';
import { parseSTL, toBinarySTL } from '../src/geometry/stl';
import { signedVolume } from '../src/geometry/mesh';

describe('layerHeights', () => {
  it('starts with the first layer height and steps uniformly', () => {
    const zs = layerHeights(1.0, 0.2, 0.3);
    expect(zs[0]).toBeCloseTo(0.3);
    expect(zs[1]).toBeCloseTo(0.5);
    // anything thinner than half a layer at the very top is dropped
    expect(zs[zs.length - 1]).toBeGreaterThanOrEqual(1.0 - 0.2 - 1e-6);
    expect(zs[zs.length - 1]).toBeLessThanOrEqual(1.0 + 1e-6);
  });
  it('gives 50 layers for a 10mm tall model at 0.2', () => {
    expect(layerHeights(10, 0.2, 0.2).length).toBe(50);
  });
});

describe('sliceMesh', () => {
  it('slices a 20mm cube into 20x20 squares', () => {
    const cube = boxMesh(20, 20, 10);
    expect(signedVolume(cube.positions)).toBeCloseTo(4000, 3);
    const layers = sliceMesh(cube.positions, [0.1, 5, 9.9]);
    expect(layers.length).toBe(3);
    for (const l of layers) {
      expect(l.length).toBe(1);
      expect(area(l)).toBeCloseTo(400, 3);
      expect(l[0].length).toBe(4);
    }
  });
  it('joins contours whose vertices share an x within half a millimetre', () => {
    // The face quads are split on a diagonal, so a thin slab's outline has an
    // extra vertex partway along each long edge and three vertices sharing each
    // end's x. Packing those into one vertex key has to keep both coordinates:
    // losing the low half merges them and the loop closes across the corner.
    for (const t of [0.3, 0.45, 0.8]) {
      const [layer] = sliceMesh(slabMesh(30, t, 6).positions, [2.5], 0);
      expect(layer.length).toBe(1);
      expect(area(layer)).toBeCloseTo(30 * t, 3);
    }
  });
  it('returns nothing outside the model', () => {
    const cube = boxMesh(20, 20, 10);
    const layers = sliceMesh(cube.positions, [-1, 10.5]);
    expect(layers[0].length).toBe(0);
    expect(layers[1].length).toBe(0);
  });
  it('produces an outer contour and a hole for a tube', () => {
    const tube = tubeMesh(20, 10, 5);
    const [layer] = sliceMesh(tube.positions, [2.5]);
    expect(layer.length).toBe(2);
    const areas = layer.map(polyArea).sort((a, b) => a - b);
    expect(areas[0]).toBeCloseTo(-100, 3); // hole, negative
    expect(areas[1]).toBeCloseTo(400, 3);
    expect(area(layer)).toBeCloseTo(300, 3);
  });
  it('round-trips through binary STL', () => {
    const cube = boxMesh(5, 6, 7, 1, 2, 0);
    const parsed = parseSTL(toBinarySTL(cube));
    expect(parsed.positions.length).toBe(cube.positions.length);
    expect(Array.from(parsed.positions)).toEqual(Array.from(cube.positions));
  });
  it('parses ASCII STL', () => {
    const text = `solid t\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid t`;
    const m = parseSTL(new TextEncoder().encode(text).buffer);
    expect(m.positions.length).toBe(9);
    expect(m.positions[3]).toBe(1);
  });
});

describe('simplify', () => {
  const circle = (r: number, n: number) => {
    const p = [];
    for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; p.push(pt(r * Math.cos(a), r * Math.sin(a))); }
    return p;
  };
  it('never deviates more than the tolerance from the original outline', () => {
    const orig = circle(20, 1024);
    const [simp] = simplify([orig], 0.012);
    expect(simp.length).toBeLessThan(orig.length);
    expect(simp.length).toBeGreaterThan(60);
    // every original vertex lies within tolerance of the simplified polygon
    let worst = 0;
    for (const q of orig) {
      let best = Infinity;
      for (let i = 0; i < simp.length; i++) {
        const a = simp[i], b = simp[(i + 1) % simp.length];
        const dx = b.X - a.X, dy = b.Y - a.Y, l2 = dx * dx + dy * dy;
        const t = Math.max(0, Math.min(1, ((q.X - a.X) * dx + (q.Y - a.Y) * dy) / l2));
        best = Math.min(best, Math.hypot(a.X + t * dx - q.X, a.Y + t * dy - q.Y));
      }
      worst = Math.max(worst, best);
    }
    expect(toMm(worst)).toBeLessThanOrEqual(0.012 + 1e-3);
  });
  it('keeps the corners of a rectangle', () => {
    const rect = [pt(0, 0), pt(5, 0), pt(10, 0), pt(10, 10), pt(0, 10), pt(0, 5)];
    const [simp] = simplify([rect], 0.05);
    expect(simp.length).toBe(4);
    expect(Math.abs(polyArea(simp))).toBeCloseTo(100, 3);
  });
});
