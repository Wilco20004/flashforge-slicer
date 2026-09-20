import { normalize, simplify, toInt, type Polys, type Poly } from './polygons';

/** Compute layer heights: first layer, then uniform. Returns the top Z of each layer. */
export function layerHeights(modelMaxZ: number, layerHeight: number, firstLayerHeight: number): number[] {
  const zs: number[] = [];
  let z = firstLayerHeight;
  const eps = 1e-6;
  while (z <= modelMaxZ + eps) {
    zs.push(+z.toFixed(5));
    z += layerHeight;
  }
  // If the model top sits well above the last layer, add a final layer.
  if (zs.length === 0 || modelMaxZ - zs[zs.length - 1] > layerHeight * 0.5) {
    zs.push(+(zs.length ? zs[zs.length - 1] + layerHeight : firstLayerHeight).toFixed(5));
  }
  return zs;
}

interface Seg { x1: number; y1: number; x2: number; y2: number }

/**
 * Slice a triangle soup at each plane z (mm). Returns per-plane normalised polygons
 * (Clipper integer units), outers positive, holes negative.
 */
export function sliceMesh(
  positions: ArrayLike<number>,
  planeZs: number[],
  resolution = 0.012,
  onProgress?: (fraction: number) => void,
): Polys[] {
  const triCount = Math.floor(positions.length / 9);
  const L = planeZs.length;
  if (L === 0) return [];

  // Bucket triangles into planes they cross. planeZs is ascending.
  const counts = new Int32Array(L);
  const zmin = new Float32Array(triCount);
  const zmax = new Float32Array(triCount);
  const firstIdx = new Int32Array(triCount);
  const lastIdx = new Int32Array(triCount);
  for (let t = 0; t < triCount; t++) {
    const b = t * 9;
    const z0 = positions[b + 2], z1 = positions[b + 5], z2 = positions[b + 8];
    const lo = Math.min(z0, z1, z2), hi = Math.max(z0, z1, z2);
    zmin[t] = lo; zmax[t] = hi;
    // planes with lo < z < hi  (plane touching only a vertex/edge is handled by the crossing rule)
    let a = lowerBound(planeZs, lo); // first plane > lo
    if (a < L && planeZs[a] <= lo) a++;
    let bIdx = lowerBound(planeZs, hi) - 1; // last plane < hi
    while (bIdx >= 0 && planeZs[bIdx] >= hi) bIdx--;
    firstIdx[t] = a; lastIdx[t] = bIdx;
    for (let k = a; k <= bIdx; k++) counts[k]++;
  }
  const offsets = new Int32Array(L + 1);
  for (let k = 0; k < L; k++) offsets[k + 1] = offsets[k] + counts[k];
  const fill = new Int32Array(L);
  const buckets = new Int32Array(offsets[L]);
  for (let t = 0; t < triCount; t++) {
    for (let k = firstIdx[t]; k <= lastIdx[t]; k++) buckets[offsets[k] + fill[k]++] = t;
  }

  const result: Polys[] = new Array(L);
  for (let k = 0; k < L; k++) {
    const z = planeZs[k];
    const segs: Seg[] = [];
    for (let i = offsets[k]; i < offsets[k + 1]; i++) {
      const s = triangleSegment(positions, buckets[i] * 9, z);
      if (s) segs.push(s);
    }
    const loops = joinSegments(segs);
    let polys = normalize(loops);
    if (resolution > 0) polys = simplify(polys, resolution);
    result[k] = polys;
    if (onProgress && (k % 8 === 0 || k === L - 1)) onProgress((k + 1) / L);
  }
  return result;
}

function lowerBound(arr: number[], v: number): number {
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < v) lo = mid + 1; else hi = mid;
  }
  return lo;
}

/**
 * Intersect one triangle with plane z. Vertices with z < plane are "below".
 * Returns an oriented segment (interior on the left when the mesh normals point outward).
 * Points are computed with canonically ordered edge endpoints so shared edges yield identical floats.
 */
function triangleSegment(p: ArrayLike<number>, b: number, z: number): Seg | null {
  const ax = p[b], ay = p[b + 1], az = p[b + 2];
  const bx = p[b + 3], by = p[b + 4], bz = p[b + 5];
  const cx = p[b + 6], cy = p[b + 7], cz = p[b + 8];
  const aBelow = az < z, bBelow = bz < z, cBelow = cz < z;
  if (aBelow === bBelow && bBelow === cBelow) return null;

  // Find the single vertex on one side.
  let sx: number, sy: number, sz: number, ux: number, uy: number, uz: number, vx: number, vy: number, vz: number;
  let flip: boolean; // true if the lone vertex is below
  if (aBelow !== bBelow && aBelow !== cBelow) { sx = ax; sy = ay; sz = az; ux = bx; uy = by; uz = bz; vx = cx; vy = cy; vz = cz; flip = aBelow; }
  else if (bBelow !== aBelow && bBelow !== cBelow) { sx = bx; sy = by; sz = bz; ux = cx; uy = cy; uz = cz; vx = ax; vy = ay; vz = az; flip = bBelow; }
  else { sx = cx; sy = cy; sz = cz; ux = ax; uy = ay; uz = az; vx = bx; vy = by; vz = bz; flip = cBelow; }

  // Edges s-u and s-v cross the plane (s is alone). Triangle order s,u,v is a cyclic rotation of a,b,c.
  const p1 = edgePoint(sx, sy, sz, ux, uy, uz, z);
  const p2 = edgePoint(sx, sy, sz, vx, vy, vz, z);
  // For CCW (outward) triangles, when the lone vertex is above, going s->u then s->v
  // traverses the contour with interior on the left as p2 -> p1; otherwise p1 -> p2.
  return flip ? { x1: p1[0], y1: p1[1], x2: p2[0], y2: p2[1] } : { x1: p2[0], y1: p2[1], x2: p1[0], y2: p1[1] };
}

function edgePoint(ax: number, ay: number, az: number, bx: number, by: number, bz: number, z: number): [number, number] {
  // Canonical ordering so that both triangles sharing this edge compute the same point.
  if (az > bz || (az === bz && (ax > bx || (ax === bx && ay > by)))) {
    const tx = ax, ty = ay, tz = az; ax = bx; ay = by; az = bz; bx = tx; by = ty; bz = tz;
  }
  const t = (z - az) / (bz - az);
  return [ax + (bx - ax) * t, ay + (by - ay) * t];
}

const KEY_SCALE = 1000; // 1 µm

function key(x: number, y: number): number {
  // Pack quantised coordinates into one number (safe for |coord| < ~1e6 mm).
  const qx = Math.round(x * KEY_SCALE) + 2 ** 30;
  const qy = Math.round(y * KEY_SCALE) + 2 ** 30;
  return qx * 2 ** 31 + qy;
}

/** Join oriented segments into closed loops (Clipper integer coordinates). */
export function joinSegments(segs: Seg[]): Polys {
  const n = segs.length;
  if (n === 0) return [];
  const byStart = new Map<number, number[]>();
  const byEnd = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const s = segs[i];
    push(byStart, key(s.x1, s.y1), i);
    push(byEnd, key(s.x2, s.y2), i);
  }
  const used = new Uint8Array(n);
  const loops: Polys = [];
  const take = (map: Map<number, number[]>, k: number): number => {
    const arr = map.get(k);
    if (!arr) return -1;
    while (arr.length) {
      const idx = arr.pop()!;
      if (!used[idx]) return idx;
    }
    return -1;
  };

  for (let i = 0; i < n; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const s = segs[i];
    const pts: number[] = [s.x1, s.y1, s.x2, s.y2];
    let cx = s.x2, cy = s.y2;
    const startKey = key(s.x1, s.y1);
    let closed = false;
    for (let guard = 0; guard < n; guard++) {
      const k = key(cx, cy);
      if (k === startKey) { closed = true; break; }
      let next = take(byStart, k);
      let reversed = false;
      if (next < 0) { next = take(byEnd, k); reversed = true; }
      if (next < 0) break;
      used[next] = 1;
      const ns = segs[next];
      const nx = reversed ? ns.x1 : ns.x2;
      const ny = reversed ? ns.y1 : ns.y2;
      pts.push(nx, ny);
      cx = nx; cy = ny;
    }
    // Drop the duplicated closing point.
    if (closed) { pts.length -= 2; }
    else {
      // Tolerate tiny gaps from non-manifold input.
      const gap = Math.hypot(pts[0] - cx, pts[1] - cy);
      if (gap > 0.2 || pts.length < 6) continue;
    }
    if (pts.length < 6) continue;
    const poly: Poly = [];
    for (let j = 0; j < pts.length; j += 2) poly.push({ X: toInt(pts[j]), Y: toInt(pts[j + 1]) });
    loops.push(poly);
  }
  return loops;
}

function push(map: Map<number, number[]>, k: number, v: number) {
  const arr = map.get(k);
  if (arr) arr.push(v); else map.set(k, [v]);
}
