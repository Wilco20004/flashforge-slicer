import * as THREE from 'three';
import type { TriangleMesh } from '../geometry/mesh';
import { computeBounds, transformPositions } from '../geometry/mesh';

export interface Transform {
  x: number; // bed position of the model's XY centre (mm, centre-origin bed)
  y: number;
  rotX: number; // degrees
  rotY: number;
  rotZ: number;
  scale: number; // uniform, percent
}

export interface PlateObject {
  id: string;
  name: string;
  mesh: TriangleMesh;
  transform: Transform;
  /** Bounds of the raw mesh (before transform). */
  rawBounds: ReturnType<typeof computeBounds>;
  /** Cached three.js geometry for display. */
  geometry: THREE.BufferGeometry;
}

export const defaultTransform = (): Transform => ({ x: 0, y: 0, rotX: 0, rotY: 0, rotZ: 0, scale: 100 });

let counter = 0;
export function createPlateObject(mesh: TriangleMesh): PlateObject {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
  geometry.computeVertexNormals();
  const rawBounds = computeBounds(mesh.positions);
  return {
    id: `obj-${++counter}-${Date.now().toString(36)}`,
    name: mesh.name.replace(/\.(stl|3mf|obj)$/i, ''),
    mesh,
    transform: defaultTransform(),
    rawBounds,
    geometry,
  };
}

/** Rotation * scale about the raw mesh's XY centre; no translation. */
function rotScaleMatrix(o: PlateObject): THREE.Matrix4 {
  const t = o.transform;
  const s = t.scale / 100;
  const cx = (o.rawBounds.min[0] + o.rawBounds.max[0]) / 2;
  const cy = (o.rawBounds.min[1] + o.rawBounds.max[1]) / 2;
  const cz = o.rawBounds.min[2];
  const m = new THREE.Matrix4();
  const rot = new THREE.Matrix4().makeRotationFromEuler(
    new THREE.Euler(THREE.MathUtils.degToRad(t.rotX), THREE.MathUtils.degToRad(t.rotY), THREE.MathUtils.degToRad(t.rotZ), 'XYZ'),
  );
  m.multiply(rot);
  m.multiply(new THREE.Matrix4().makeScale(s, s, s));
  m.multiply(new THREE.Matrix4().makeTranslation(-cx, -cy, -cz));
  return m;
}

/**
 * World matrix: rotate/scale about the mesh centre, drop onto the bed (min z = 0),
 * then place the XY centre at (transform.x, transform.y).
 */
export function worldMatrix(o: PlateObject): THREE.Matrix4 {
  const rs = rotScaleMatrix(o);
  const p = o.mesh.positions;
  const e = rs.elements;
  let minZ = Infinity, minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i], y = p[i + 1], z = p[i + 2];
    const wx = e[0] * x + e[4] * y + e[8] * z + e[12];
    const wy = e[1] * x + e[5] * y + e[9] * z + e[13];
    const wz = e[2] * x + e[6] * y + e[10] * z + e[14];
    if (wz < minZ) minZ = wz;
    if (wx < minX) minX = wx; if (wx > maxX) maxX = wx;
    if (wy < minY) minY = wy; if (wy > maxY) maxY = wy;
  }
  if (!isFinite(minZ)) minZ = 0;
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const t = new THREE.Matrix4().makeTranslation(o.transform.x - cx, o.transform.y - cy, -minZ);
  return t.multiply(rs);
}

export function worldPositions(o: PlateObject): Float32Array {
  return transformPositions(o.mesh.positions, worldMatrix(o).elements);
}

export function worldBounds(o: PlateObject) {
  return computeBounds(worldPositions(o));
}

export interface ArrangeOptions {
  bedX: number;
  bedY: number;
  /** Minimum clearance between parts and to the bed edge (mm). */
  gap?: number;
  /** Try a 90° rotation when a part does not fit as-is. */
  allowRotate?: boolean;
}

export interface ArrangeResult {
  objects: PlateObject[];
  /** Objects that could not be placed inside the bed. */
  unplaced: PlateObject[];
}

interface Rect { x0: number; y0: number; x1: number; y1: number }

/**
 * Arrange all objects on the bed: largest footprint first, each placed at the free
 * spot nearest the bed centre (grid search), keeping `gap` to other parts and to the
 * edge. Parts that do not fit are left where they are and reported in `unplaced`.
 */
export function arrangeObjects(objects: PlateObject[], opts: ArrangeOptions): ArrangeResult {
  const gap = opts.gap ?? 6;
  const hx = opts.bedX / 2, hy = opts.bedY / 2;
  const footprints = objects.map((o) => {
    const b = worldBounds(o);
    return { o, w: b.max[0] - b.min[0], d: b.max[1] - b.min[1] };
  });
  footprints.sort((a, b) => b.w * b.d - a.w * a.d);
  const placed: Rect[] = [];
  const out = new Map<string, PlateObject>();
  const unplaced: PlateObject[] = [];
  const step = 2; // mm grid for candidate centres

  const fits = (cx: number, cy: number, w: number, d: number): boolean => {
    const r: Rect = { x0: cx - w / 2, y0: cy - d / 2, x1: cx + w / 2, y1: cy + d / 2 };
    if (r.x0 < -hx + gap / 2 || r.x1 > hx - gap / 2 || r.y0 < -hy + gap / 2 || r.y1 > hy - gap / 2) return false;
    for (const p of placed) {
      if (r.x0 < p.x1 + gap && r.x1 > p.x0 - gap && r.y0 < p.y1 + gap && r.y1 > p.y0 - gap) return false;
    }
    return true;
  };
  const search = (w: number, d: number): [number, number] | null => {
    // candidates ordered by distance from the centre
    const maxR = Math.hypot(hx, hy);
    for (let ring = 0; ring <= maxR; ring += step) {
      const cands: [number, number][] = [];
      if (ring === 0) cands.push([0, 0]);
      else {
        const n = Math.max(8, Math.round((2 * Math.PI * ring) / step));
        for (let k = 0; k < n; k++) {
          const a = (k / n) * Math.PI * 2;
          cands.push([Math.round((ring * Math.cos(a)) / step) * step, Math.round((ring * Math.sin(a)) / step) * step]);
        }
      }
      for (const [cx, cy] of cands) if (fits(cx, cy, w, d)) return [cx, cy];
    }
    return null;
  };

  for (const f of footprints) {
    let pos = search(f.w, f.d);
    let rotated = false;
    if (!pos && opts.allowRotate !== false && Math.abs(f.w - f.d) > 0.5) {
      pos = search(f.d, f.w);
      rotated = Boolean(pos);
    }
    if (!pos) { unplaced.push(f.o); out.set(f.o.id, f.o); continue; }
    const w = rotated ? f.d : f.w, d = rotated ? f.w : f.d;
    placed.push({ x0: pos[0] - w / 2, y0: pos[1] - d / 2, x1: pos[0] + w / 2, y1: pos[1] + d / 2 });
    out.set(f.o.id, {
      ...f.o,
      transform: { ...f.o.transform, x: pos[0], y: pos[1], rotZ: rotated ? (f.o.transform.rotZ + 90) % 360 : f.o.transform.rotZ },
    });
  }
  return { objects: objects.map((o) => out.get(o.id)!), unplaced };
}
