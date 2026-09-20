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

/** Simple grid arrangement of all objects around the bed centre. */
export function arrangeObjects(objects: PlateObject[], gap = 8): PlateObject[] {
  if (objects.length === 0) return objects;
  const sizes = objects.map((o) => {
    const b = worldBounds(o);
    return { w: b.max[0] - b.min[0], d: b.max[1] - b.min[1] };
  });
  const cols = Math.ceil(Math.sqrt(objects.length));
  const rows = Math.ceil(objects.length / cols);
  const colW: number[] = new Array(cols).fill(0);
  const rowD: number[] = new Array(rows).fill(0);
  sizes.forEach((s, i) => {
    colW[i % cols] = Math.max(colW[i % cols], s.w);
    rowD[Math.floor(i / cols)] = Math.max(rowD[Math.floor(i / cols)], s.d);
  });
  const totalW = colW.reduce((a, b) => a + b, 0) + gap * (cols - 1);
  const totalD = rowD.reduce((a, b) => a + b, 0) + gap * (rows - 1);
  let y = totalD / 2;
  const out = objects.map((o) => ({ ...o }));
  for (let r = 0; r < rows; r++) {
    let x = -totalW / 2;
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (i >= out.length) break;
      out[i].transform = { ...out[i].transform, x: x + colW[c] / 2, y: y - rowD[r] / 2 };
      x += colW[c] + gap;
    }
    y -= rowD[r] + gap;
  }
  return out;
}
