import { describe, it, expect } from 'vitest';
import { arrangeObjects, createPlateObject, worldBounds } from '../src/ui/model';
import { boxMesh } from '../src/geometry/primitives';

const bed = { bedX: 220, bedY: 220, gap: 6 };

describe('arrangeObjects', () => {
  it('places several parts inside the bed without overlaps', () => {
    const parts = [[30, 30], [60, 20], [20, 60], [40, 40], [10, 10], [80, 25]].map(([w, d], i) => createPlateObject(boxMesh(w, d, 5, 0, 0, 0, `p${i}`)));
    const res = arrangeObjects(parts, bed);
    expect(res.unplaced).toEqual([]);
    const boxes = res.objects.map(worldBounds);
    for (const b of boxes) {
      expect(b.min[0]).toBeGreaterThanOrEqual(-110);
      expect(b.max[0]).toBeLessThanOrEqual(110);
      expect(b.min[1]).toBeGreaterThanOrEqual(-110);
      expect(b.max[1]).toBeLessThanOrEqual(110);
    }
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      const overlap = a.min[0] < b.max[0] + 6 - 1e-6 && a.max[0] > b.min[0] - 6 + 1e-6 && a.min[1] < b.max[1] + 6 - 1e-6 && a.max[1] > b.min[1] - 6 + 1e-6;
      expect(overlap).toBe(false);
    }
  });
  it('puts the largest part at the centre', () => {
    const parts = [createPlateObject(boxMesh(10, 10, 5)), createPlateObject(boxMesh(50, 50, 5))];
    const res = arrangeObjects(parts, bed);
    const big = res.objects[1];
    expect(big.transform.x).toBe(0);
    expect(big.transform.y).toBe(0);
  });
  it('rotates a part by 90° when that is the only way it fits', () => {
    const parts = [createPlateObject(boxMesh(200, 60, 5)), createPlateObject(boxMesh(60, 200, 5))];
    const res = arrangeObjects(parts, bed);
    expect(res.unplaced).toEqual([]);
    expect(res.objects[1].transform.rotZ).toBe(90);
    const b = worldBounds(res.objects[1]);
    expect(b.max[0] - b.min[0]).toBeCloseTo(200, 3);
  });
  it('reports parts that cannot fit', () => {
    const parts = [createPlateObject(boxMesh(250, 30, 5)), createPlateObject(boxMesh(30, 30, 5))];
    const res = arrangeObjects(parts, bed);
    expect(res.unplaced.length).toBe(1);
    expect(res.unplaced[0].id).toBe(parts[0].id);
    expect(res.objects.length).toBe(2);
  });
});
