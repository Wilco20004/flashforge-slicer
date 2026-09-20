import type { TriangleMesh } from './mesh';

/** Parse a binary or ASCII STL file. */
export function parseSTL(buffer: ArrayBuffer, name = 'model.stl'): TriangleMesh {
  if (isBinarySTL(buffer)) return parseBinarySTL(buffer, name);
  return parseAsciiSTL(new TextDecoder().decode(buffer), name);
}

function isBinarySTL(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < 84) return false;
  const view = new DataView(buffer);
  const faceCount = view.getUint32(80, true);
  const expected = 84 + faceCount * 50;
  if (expected === buffer.byteLength) return true;
  // Some exporters append junk; fall back to sniffing for "solid".
  const head = new TextDecoder().decode(new Uint8Array(buffer, 0, Math.min(6, buffer.byteLength)));
  if (head.trim().toLowerCase().startsWith('solid')) {
    // ASCII files start with "solid", but so can some binary headers. Check for "facet" text.
    const sample = new TextDecoder().decode(new Uint8Array(buffer, 0, Math.min(1024, buffer.byteLength)));
    return !/facet\s+normal/i.test(sample);
  }
  return true;
}

function parseBinarySTL(buffer: ArrayBuffer, name: string): TriangleMesh {
  const view = new DataView(buffer);
  const faceCount = Math.min(view.getUint32(80, true), Math.floor((buffer.byteLength - 84) / 50));
  const positions = new Float32Array(faceCount * 9);
  let off = 84;
  let p = 0;
  for (let f = 0; f < faceCount; f++) {
    off += 12; // normal
    for (let v = 0; v < 3; v++) {
      positions[p++] = view.getFloat32(off, true);
      positions[p++] = view.getFloat32(off + 4, true);
      positions[p++] = view.getFloat32(off + 8, true);
      off += 12;
    }
    off += 2; // attribute byte count
  }
  return { positions, name };
}

function parseAsciiSTL(text: string, name: string): TriangleMesh {
  const re = /vertex\s+([-+]?[\d.eE+-]+)\s+([-+]?[\d.eE+-]+)\s+([-+]?[\d.eE+-]+)/g;
  const values: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    values.push(parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]));
  }
  const tri = Math.floor(values.length / 9);
  return { positions: new Float32Array(values.slice(0, tri * 9)), name };
}

/** Serialize to binary STL (used for tests and optional export). */
export function toBinarySTL(mesh: TriangleMesh): ArrayBuffer {
  const n = mesh.positions.length / 9;
  const buf = new ArrayBuffer(84 + n * 50);
  const view = new DataView(buf);
  view.setUint32(80, n, true);
  let off = 84;
  for (let i = 0; i < n; i++) {
    const p = mesh.positions;
    const b = i * 9;
    const ux = p[b + 3] - p[b], uy = p[b + 4] - p[b + 1], uz = p[b + 5] - p[b + 2];
    const vx = p[b + 6] - p[b], vy = p[b + 7] - p[b + 1], vz = p[b + 8] - p[b + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    view.setFloat32(off, nx, true); view.setFloat32(off + 4, ny, true); view.setFloat32(off + 8, nz, true);
    off += 12;
    for (let k = 0; k < 9; k++) { view.setFloat32(off, p[b + k], true); off += 4; }
    view.setUint16(off, 0, true); off += 2;
  }
  return buf;
}
