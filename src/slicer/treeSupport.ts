import { difference, offset, unionAll, isEmpty, pointInPolys, toInt, toMm, type Polys, type Poly } from './polygons';
import type { SliceSettings } from './settings';

export interface TreeSupportResult {
  /** Branch regions per layer (already trimmed away from the model). */
  branches: Polys[];
  /** Roof (interface) regions per layer. */
  roof: Polys[];
}

interface Node {
  id: number;
  x: number; // mm
  y: number;
  r: number; // mm
  tipLayer: number;
}

interface Circle { x: number; y: number; r: number; id: number }

/**
 * Organic ("tree") supports on 2-D layer polygons.
 *
 * For every overhang region we place tips a few layers below it (leaving room for
 * the roof and the Z gap). Each tip becomes a node that walks down one layer at a
 * time: it grows, drifts toward nearby nodes, merges with them when they touch and
 * either lands on the bed or on the model (respecting the Z gap). The union of the
 * node circles on each layer, minus the model plus XY gap, is the branch region.
 */
export function generateTreeSupport(
  R: (i: number) => Polys,
  heights: number[],
  overhang: Polys[],
  s: SliceSettings,
  progress?: (fraction: number) => void,
): TreeSupportResult {
  const L = heights.length;
  const h = s.layerHeight;
  const gapLayers = Math.max(1, Math.round(s.supportZGap / h));
  const roofLayers = Math.max(0, s.supportInterfaceLayers);
  const rTip = Math.max(0.5, s.treeTipDiameter / 2);
  const rBranch = Math.max(rTip, s.treeBranchDiameter / 2);
  const rMax = Math.max(rBranch, s.treeMaxDiameter / 2);
  const maxMove = h * Math.tan((Math.min(75, Math.max(1, s.treeBranchAngle)) * Math.PI) / 180);
  const growSlow = h * Math.tan((Math.max(0, s.treeDiameterAngle) * Math.PI) / 180);
  const growFast = h * Math.tan((45 * Math.PI) / 180);
  const attraction = Math.max(2, s.treeTipSpacing * 3);
  const baseLayers = Math.max(1, Math.round(1.0 / h));

  // ---- roof: the overhang itself, repeated for `roofLayers` layers under it ----
  const roof: Polys[] = new Array(L).fill(null).map(() => []);
  for (let i = 0; i < L; i++) {
    if (isEmpty(overhang[i])) continue;
    for (let k = 1; k <= roofLayers; k++) {
      const j = i - gapLayers - k + 1; // layers i-gap, i-gap-1, ... just below the gap
      if (j >= 0) roof[j].push(...overhang[i]);
    }
  }
  for (let j = 0; j < L; j++) if (roof[j].length) roof[j] = difference(unionAll([roof[j]]), offset(R(j), s.supportXYGap));

  // ---- tips: sample points under each overhang ----
  const tipsByLayer: Node[][] = new Array(L).fill(null).map(() => []);
  let nextId = 1;
  for (let i = 0; i < L; i++) {
    if (isEmpty(overhang[i])) continue;
    const tipLayer = i - gapLayers - roofLayers;
    if (tipLayer < 0) continue; // overhang too close to the bed to support
    for (const [x, y] of sampleTips(overhang[i], s.treeTipSpacing, rTip)) {
      tipsByLayer[tipLayer].push({ id: nextId++, x, y, r: rTip, tipLayer });
    }
  }

  // ---- walk the nodes down ----
  const circles: Circle[][] = new Array(L).fill(null).map(() => []);
  let active: Node[] = [];
  let topLayer = -1;
  for (let i = L - 1; i >= 0; i--) if (tipsByLayer[i].length) { topLayer = i; break; }

  for (let layer = topLayer; layer >= 0; layer--) {
    active.push(...tipsByLayer[layer]);
    if (active.length === 0) continue;

    // record this layer's circles
    const modelHere = offset(R(layer), s.supportXYGap);
    for (const n of active) {
      const rr = layer < baseLayers ? n.r + ((baseLayers - layer) / baseLayers) * 1.0 : n.r;
      circles[layer].push({ x: n.x, y: n.y, r: rr, id: n.id });
    }
    if (layer === 0) break;

    // landing on the model? the node's centre would be inside the model on the layer below
    const modelBelow = offset(R(layer - 1), s.supportXYGap);
    const survivors: Node[] = [];
    for (const n of active) {
      const insideBelow = !isEmpty(modelBelow) && pointInPolys(toInt(n.x), toInt(n.y), modelBelow);
      if (insideBelow) {
        // branch rests on the model: remove the circles inside the Z gap
        for (let k = layer; k < Math.min(L, layer + gapLayers) ; k++) {
          circles[k] = circles[k].filter((c) => c.id !== n.id);
        }
        continue;
      }
      survivors.push(n);
    }
    active = survivors;
    void modelHere;

    // grow and move toward neighbours
    const grid = new Map<string, Node[]>();
    const cell = attraction;
    const key = (x: number, y: number) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
    for (const n of active) {
      const k = key(n.x, n.y);
      const arr = grid.get(k);
      if (arr) arr.push(n); else grid.set(k, [n]);
    }
    const moves = new Map<number, [number, number]>();
    for (const n of active) {
      let best: Node | null = null, bestD = Infinity;
      const cx = Math.floor(n.x / cell), cy = Math.floor(n.y / cell);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        const arr = grid.get(`${cx + dx},${cy + dy}`);
        if (!arr) continue;
        for (const m of arr) {
          if (m === n) continue;
          const d = Math.hypot(m.x - n.x, m.y - n.y);
          if (d < bestD) { bestD = d; best = m; }
        }
      }
      if (best && bestD < attraction && bestD > 1e-6) {
        const step = Math.min(maxMove, bestD / 2);
        moves.set(n.id, [((best.x - n.x) / bestD) * step, ((best.y - n.y) / bestD) * step]);
      }
    }
    for (const n of active) {
      const mv = moves.get(n.id);
      if (mv) { n.x += mv[0]; n.y += mv[1]; }
      const below = n.tipLayer - (layer - 1);
      const ramp = Math.min(rBranch, rTip + below * growFast);
      n.r = Math.min(rMax, ramp + below * growSlow);
    }
    // merge touching nodes
    active.sort((a, b) => b.r - a.r);
    const merged: Node[] = [];
    const gone = new Set<number>();
    for (let a = 0; a < active.length; a++) {
      const n = active[a];
      if (gone.has(n.id)) continue;
      for (let b = a + 1; b < active.length; b++) {
        const m = active[b];
        if (gone.has(m.id)) continue;
        const d = Math.hypot(m.x - n.x, m.y - n.y);
        if (d <= n.r + m.r) {
          const wa = n.r * n.r, wb = m.r * m.r;
          n.x = (n.x * wa + m.x * wb) / (wa + wb);
          n.y = (n.y * wa + m.y * wb) / (wa + wb);
          n.r = Math.min(rMax, Math.sqrt(wa + wb));
          n.tipLayer = Math.max(n.tipLayer, m.tipLayer);
          gone.add(m.id);
          // the merged node keeps n's id; re-tag m's circles so a later landing removes both
          for (let k = layer; k < Math.min(L, layer + gapLayers); k++) for (const c of circles[k]) if (c.id === m.id) c.id = n.id;
        }
      }
      merged.push(n);
    }
    active = merged;
    if (layer % 10 === 0) progress?.(1 - layer / Math.max(1, topLayer));
  }

  // ---- polygons ----
  const branches: Polys[] = new Array(L).fill(null).map(() => []);
  for (let i = 0; i < L; i++) {
    if (!circles[i].length) continue;
    const polys: Polys = circles[i].map((c) => circlePoly(c.x, c.y, c.r));
    let region = unionAll([polys]);
    region = difference(region, offset(R(i), s.supportXYGap));
    // branches don't need to print where the roof already prints
    if (roof[i].length) region = difference(region, roof[i]);
    branches[i] = region;
  }
  return { branches, roof };
}

function circlePoly(x: number, y: number, r: number): Poly {
  const n = r < 1.5 ? 12 : r < 4 ? 20 : 32;
  const out: Poly = [];
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    out.push({ X: toInt(x + r * Math.cos(a)), Y: toInt(y + r * Math.sin(a)) });
  }
  return out;
}

/** Grid points inside the region plus points along its inset boundary; at least one per polygon. */
function sampleTips(region: Polys, spacing: number, rTip: number): [number, number][] {
  const out: [number, number][] = [];
  const inset = offset(region, -Math.min(rTip, 0.4));
  const target = isEmpty(inset) ? region : inset;
  // grid anchored to the origin so tips line up between neighbouring overhangs
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of target) for (const q of p) {
    minX = Math.min(minX, q.X); minY = Math.min(minY, q.Y); maxX = Math.max(maxX, q.X); maxY = Math.max(maxY, q.Y);
  }
  const sp = Math.max(1, spacing);
  for (let gx = Math.ceil(toMm(minX) / sp) * sp; gx <= toMm(maxX); gx += sp) {
    for (let gy = Math.ceil(toMm(minY) / sp) * sp; gy <= toMm(maxY); gy += sp) {
      if (pointInPolys(toInt(gx), toInt(gy), target)) out.push([gx, gy]);
    }
  }
  // boundary points on the inset outline
  const edgeInset = offset(region, -Math.max(rTip, 0.6));
  for (const p of edgeInset) {
    let acc = 0;
    for (let i = 0; i < p.length; i++) {
      const a = p[i], b = p[(i + 1) % p.length];
      const len = Math.hypot(b.X - a.X, b.Y - a.Y) / 1000;
      let t = acc === 0 ? 0 : sp - acc;
      while (t <= len) {
        const f = len === 0 ? 0 : t / len;
        out.push([toMm(a.X) + (toMm(b.X) - toMm(a.X)) * f, toMm(a.Y) + (toMm(b.Y) - toMm(a.Y)) * f]);
        t += sp;
      }
      acc = (acc + len) % sp;
    }
  }
  if (out.length === 0) {
    // tiny region: one tip at the vertex average of each outer polygon
    for (const p of region) {
      let sx = 0, sy = 0;
      for (const q of p) { sx += q.X; sy += q.Y; }
      if (p.length) out.push([toMm(sx / p.length), toMm(sy / p.length)]);
    }
  }
  // de-duplicate close points
  const kept: [number, number][] = [];
  const minD2 = (sp * 0.5) ** 2;
  for (const pt of out) {
    if (!kept.some((k) => (k[0] - pt[0]) ** 2 + (k[1] - pt[1]) ** 2 < minD2)) kept.push(pt);
  }
  return kept;
}
