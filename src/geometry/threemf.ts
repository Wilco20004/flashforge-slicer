import { unzipSync, strFromU8 } from 'fflate';
import type { TriangleMesh } from './mesh';
import { transformPositions } from './mesh';

/**
 * Parse a 3MF package into one triangle mesh per build item.
 * Requires DOMParser (main thread). Handles <mesh> objects and <components>.
 */
export function parse3MF(buffer: ArrayBuffer, name = 'model.3mf'): TriangleMesh[] {
  const files = unzipSync(new Uint8Array(buffer));
  let modelPath = Object.keys(files).find((f) => /^3D\/.*\.model$/i.test(f));
  // Follow _rels/.rels if present.
  const rels = files['_rels/.rels'];
  if (rels) {
    const relXml = new DOMParser().parseFromString(strFromU8(rels), 'application/xml');
    const rel = Array.from(relXml.getElementsByTagName('Relationship')).find((r) =>
      (r.getAttribute('Type') || '').includes('3dmodel'),
    );
    const target = rel?.getAttribute('Target');
    if (target) {
      const p = target.replace(/^\//, '');
      if (files[p]) modelPath = p;
    }
  }
  if (!modelPath) throw new Error('3MF: no 3D model part found');

  const xml = new DOMParser().parseFromString(strFromU8(files[modelPath]), 'application/xml');
  const modelEl = xml.getElementsByTagName('model')[0];
  const unit = (modelEl?.getAttribute('unit') || 'millimeter').toLowerCase();
  const unitScale = unitToMm(unit);

  const objects = new Map<string, Element>();
  for (const obj of Array.from(xml.getElementsByTagName('object'))) {
    const id = obj.getAttribute('id');
    if (id) objects.set(id, obj);
  }
  // Objects may live in other model files (production extension); load them too.
  for (const [path, data] of Object.entries(files)) {
    if (path === modelPath || !/^3D\/.*\.model$/i.test(path)) continue;
    const doc = new DOMParser().parseFromString(strFromU8(data), 'application/xml');
    for (const obj of Array.from(doc.getElementsByTagName('object'))) {
      const id = obj.getAttribute('id');
      if (id && !objects.has(id)) objects.set(id, obj);
    }
  }

  const meshCache = new Map<string, Float32Array>();
  const resolve = (id: string, depth = 0): Float32Array => {
    if (depth > 16) return new Float32Array(0);
    const cached = meshCache.get(id);
    if (cached) return cached;
    const obj = objects.get(id);
    if (!obj) return new Float32Array(0);
    let result: Float32Array;
    const meshEl = obj.getElementsByTagName('mesh')[0];
    if (meshEl) {
      result = parseMeshElement(meshEl);
    } else {
      const parts: Float32Array[] = [];
      for (const comp of Array.from(obj.getElementsByTagName('component'))) {
        const cid = comp.getAttribute('objectid');
        if (!cid) continue;
        let p = resolve(cid, depth + 1);
        const t = comp.getAttribute('transform');
        if (t) p = transformPositions(p, parseTransform(t));
        parts.push(p);
      }
      result = concat(parts);
    }
    meshCache.set(id, result);
    return result;
  };

  const out: TriangleMesh[] = [];
  const items = Array.from(xml.getElementsByTagName('item'));
  const baseName = name.replace(/\.3mf$/i, '');
  items.forEach((item, i) => {
    const id = item.getAttribute('objectid');
    if (!id) return;
    let p = resolve(id);
    const t = item.getAttribute('transform');
    if (t) p = transformPositions(p, parseTransform(t));
    if (unitScale !== 1) for (let k = 0; k < p.length; k++) p[k] *= unitScale;
    if (p.length === 0) return;
    const objName = objects.get(id)?.getAttribute('name');
    out.push({ positions: p, name: objName || (items.length > 1 ? `${baseName}_${i + 1}` : baseName) });
  });
  if (out.length === 0) {
    // No build items: fall back to every mesh object.
    for (const [id, obj] of objects) {
      if (obj.getElementsByTagName('mesh')[0]) {
        const p = resolve(id);
        if (p.length) out.push({ positions: p, name: obj.getAttribute('name') || `${baseName}_${id}` });
      }
    }
  }
  return out;
}

function parseMeshElement(meshEl: Element): Float32Array {
  const verts: number[] = [];
  const vEl = meshEl.getElementsByTagName('vertices')[0];
  if (vEl) {
    for (const v of Array.from(vEl.getElementsByTagName('vertex'))) {
      verts.push(+v.getAttribute('x')!, +v.getAttribute('y')!, +v.getAttribute('z')!);
    }
  }
  const tEl = meshEl.getElementsByTagName('triangles')[0];
  const tris = tEl ? Array.from(tEl.getElementsByTagName('triangle')) : [];
  const out = new Float32Array(tris.length * 9);
  let p = 0;
  for (const t of tris) {
    for (const key of ['v1', 'v2', 'v3']) {
      const idx = +t.getAttribute(key)! * 3;
      out[p++] = verts[idx];
      out[p++] = verts[idx + 1];
      out[p++] = verts[idx + 2];
    }
  }
  return out;
}

/** 3MF transform: 12 numbers, row-major 4x3 (m00 m01 m02 m10 ... m30 m31 m32). */
function parseTransform(s: string): number[] {
  const v = s.trim().split(/\s+/).map(Number);
  if (v.length !== 12) return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  // Column-major 4x4 for transformPositions.
  return [v[0], v[1], v[2], 0, v[3], v[4], v[5], 0, v[6], v[7], v[8], 0, v[9], v[10], v[11], 1];
}

function unitToMm(unit: string): number {
  switch (unit) {
    case 'micron': return 0.001;
    case 'centimeter': return 10;
    case 'inch': return 25.4;
    case 'foot': return 304.8;
    case 'meter': return 1000;
    default: return 1;
  }
}

function concat(parts: Float32Array[]): Float32Array {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Float32Array(n);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}
