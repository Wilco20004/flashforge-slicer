import type { TriangleMesh } from './mesh';

/** Parse a Wavefront OBJ (positions only; polygons are fan-triangulated). */
export function parseOBJ(text: string, name = 'model.obj'): TriangleMesh {
  const verts: number[] = [];
  const out: number[] = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (line.startsWith('v ')) {
      const parts = line.trim().split(/\s+/);
      verts.push(parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3]));
    } else if (line.startsWith('f ')) {
      const parts = line.trim().split(/\s+/).slice(1);
      const idx = parts.map((p) => {
        const i = parseInt(p.split('/')[0], 10);
        return i < 0 ? verts.length / 3 + i : i - 1;
      });
      for (let i = 1; i + 1 < idx.length; i++) {
        for (const k of [idx[0], idx[i], idx[i + 1]]) {
          out.push(verts[k * 3], verts[k * 3 + 1], verts[k * 3 + 2]);
        }
      }
    }
  }
  return { positions: new Float32Array(out), name };
}
