import type { TriangleMesh } from './mesh';

/** Axis-aligned box with outward-facing triangles (used for the sample model and tests). */
export function boxMesh(sx: number, sy: number, sz: number, cx = 0, cy = 0, z0 = 0, name = 'box'): TriangleMesh {
  const x0 = cx - sx / 2, x1 = cx + sx / 2, y0 = cy - sy / 2, y1 = cy + sy / 2, z1 = z0 + sz;
  const v = [
    [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
    [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
  ];
  const faces = [
    [0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4],
    [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7],
  ];
  const positions = new Float32Array(faces.length * 9);
  let p = 0;
  for (const f of faces) for (const i of f) { positions[p++] = v[i][0]; positions[p++] = v[i][1]; positions[p++] = v[i][2]; }
  return { positions, name };
}

/** A small test piece: 20 mm cube with a 10 mm bore and an overhanging lip, exercises walls, holes, bridges and supports. */
export function sampleMesh(): TriangleMesh {
  const tris: number[] = [];
  const push = (m: TriangleMesh) => { for (const v of m.positions) tris.push(v); };
  push(boxMesh(20, 20, 12));                 // base block
  push(boxMesh(30, 8, 3, 0, 0, 12));         // lip overhanging 5 mm on each side
  push(boxMesh(6, 6, 8, 0, 0, 15));          // post
  return { positions: new Float32Array(tris), name: 'planty-sample' };
}
