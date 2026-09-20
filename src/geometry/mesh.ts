/** A triangle soup: 9 floats per triangle (x,y,z for three vertices). */
export interface TriangleMesh {
  /** Flat vertex positions, length = triangleCount * 9. */
  positions: Float32Array;
  name: string;
}

export interface Box3 {
  min: [number, number, number];
  max: [number, number, number];
}

export function triangleCount(mesh: TriangleMesh): number {
  return mesh.positions.length / 9;
}

export function computeBounds(positions: ArrayLike<number>): Box3 {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    if (x < min[0]) min[0] = x;
    if (y < min[1]) min[1] = y;
    if (z < min[2]) min[2] = z;
    if (x > max[0]) max[0] = x;
    if (y > max[1]) max[1] = y;
    if (z > max[2]) max[2] = z;
  }
  if (!isFinite(min[0])) return { min: [0, 0, 0], max: [0, 0, 0] };
  return { min, max };
}

/** Column-major 4x4 matrix (same layout as three.js Matrix4.elements). */
export type Mat4 = ArrayLike<number>;

export function transformPositions(positions: Float32Array, m: Mat4): Float32Array {
  const out = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    out[i] = m[0] * x + m[4] * y + m[8] * z + m[12];
    out[i + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
    out[i + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
  }
  return out;
}

/** Build a triangle soup from indexed vertices. */
export function fromIndexed(vertices: ArrayLike<number>, indices: ArrayLike<number>, name = 'mesh'): TriangleMesh {
  const positions = new Float32Array(indices.length * 3);
  for (let i = 0; i < indices.length; i++) {
    const vi = indices[i] * 3;
    positions[i * 3] = vertices[vi];
    positions[i * 3 + 1] = vertices[vi + 1];
    positions[i * 3 + 2] = vertices[vi + 2];
  }
  return { positions, name };
}

export function mergeMeshes(meshes: TriangleMesh[]): TriangleMesh {
  let total = 0;
  for (const m of meshes) total += m.positions.length;
  const positions = new Float32Array(total);
  let off = 0;
  for (const m of meshes) {
    positions.set(m.positions, off);
    off += m.positions.length;
  }
  return { positions, name: meshes.map((m) => m.name).join('+') };
}

/** Signed volume via divergence theorem (mm^3). Positive for outward-facing normals. */
export function signedVolume(positions: ArrayLike<number>): number {
  let v = 0;
  for (let i = 0; i < positions.length; i += 9) {
    const ax = positions[i], ay = positions[i + 1], az = positions[i + 2];
    const bx = positions[i + 3], by = positions[i + 4], bz = positions[i + 5];
    const cx = positions[i + 6], cy = positions[i + 7], cz = positions[i + 8];
    v += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }
  return v / 6;
}
