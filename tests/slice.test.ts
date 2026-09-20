import { describe, it, expect } from 'vitest';
import { sliceMesh, layerHeights } from '../src/slicer/slice';
import { area, polyArea } from '../src/slicer/polygons';
import { boxMesh, tubeMesh } from './fixtures';
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
