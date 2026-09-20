import type { TriangleMesh } from '../src/geometry/mesh';

export { boxMesh } from '../src/geometry/primitives';

/** Box with a rectangular through-hole along Z (a square tube). */
export function tubeMesh(outer: number, inner: number, h: number): TriangleMesh {
  const o = outer / 2, i = inner / 2;
  const tris: number[] = [];
  const quad = (a: number[], b: number[], c: number[], d: number[]) => tris.push(...a, ...b, ...c, ...a, ...c, ...d);
  // outer walls (outward)
  quad([-o, -o, 0], [o, -o, 0], [o, -o, h], [-o, -o, h]);
  quad([o, -o, 0], [o, o, 0], [o, o, h], [o, -o, h]);
  quad([o, o, 0], [-o, o, 0], [-o, o, h], [o, o, h]);
  quad([-o, o, 0], [-o, -o, 0], [-o, -o, h], [-o, o, h]);
  // inner walls (facing inward = reversed)
  quad([-i, -i, h], [i, -i, h], [i, -i, 0], [-i, -i, 0]);
  quad([i, -i, h], [i, i, h], [i, i, 0], [i, -i, 0]);
  quad([i, i, h], [-i, i, h], [-i, i, 0], [i, i, 0]);
  quad([-i, i, h], [-i, -i, h], [-i, -i, 0], [-i, i, 0]);
  // top ring (facing +z)
  quad([-o, -o, h], [o, -o, h], [i, -i, h], [-i, -i, h]);
  quad([o, -o, h], [o, o, h], [i, i, h], [i, -i, h]);
  quad([o, o, h], [-o, o, h], [-i, i, h], [i, i, h]);
  quad([-o, o, h], [-o, -o, h], [-i, -i, h], [-i, i, h]);
  // bottom ring (facing -z)
  quad([-i, -i, 0], [i, -i, 0], [o, -o, 0], [-o, -o, 0]);
  quad([i, -i, 0], [i, i, 0], [o, o, 0], [o, -o, 0]);
  quad([i, i, 0], [-i, i, 0], [-o, o, 0], [o, o, 0]);
  quad([-i, i, 0], [-i, -i, 0], [-o, -o, 0], [-o, o, 0]);
  return { positions: new Float32Array(tris), name: 'tube' };
}
