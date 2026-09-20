import type { SliceSettings } from './settings';
import type { LayerPlan, PrintPath, PathType } from './plan';
import { layerHeights, sliceMesh } from './slice';
import {
  offset, union, unionAll, difference, intersection, islands, convexHull, isEmpty, polyArea, open,
  toMm, type Polys, type Poly,
} from './polygons';
import { parallelLines, sparseInfill } from './infill';
import { computeBounds } from '../geometry/mesh';
import { generateTreeSupport } from './treeSupport';

export interface PlanProgress { (stage: string, fraction: number): void }

export interface PlanResult {
  layers: LayerPlan[];
  modelBounds: ReturnType<typeof computeBounds>;
}

/** Full geometry pipeline: triangle soup (mm, bed coordinates) -> ordered print paths per layer. */
export function planLayers(positions: Float32Array, s: SliceSettings, progress?: PlanProgress): PlanResult {
  const modelBounds = computeBounds(positions);
  const zs = layerHeights(modelBounds.max[2], s.layerHeight, s.firstLayerHeight);
  const heights = zs.map((z, i) => (i === 0 ? z : +(z - zs[i - 1]).toFixed(5)));
  const planes = zs.map((z, i) => z - heights[i] / 2);

  progress?.('Slicing mesh', 0);
  const regions = sliceMesh(positions, planes, s.resolution, (f) => progress?.('Slicing mesh', f));
  const L = regions.length;

  // Drop trailing empty layers (model top exactly on a plane etc.)
  let lastNonEmpty = L - 1;
  while (lastNonEmpty > 0 && isEmpty(regions[lastNonEmpty])) lastNonEmpty--;
  const layerCount = lastNonEmpty + 1;

  const R = (i: number): Polys => (i >= 0 && i < layerCount ? regions[i] : []);

  // ---- Supports ----
  progress?.('Generating supports', 0);
  let support: Polys[] = new Array(layerCount).fill(null).map(() => []);
  let supportInterface: Polys[] = new Array(layerCount).fill(null).map(() => []);
  const treeStyle = s.supportEnabled && s.supportType === 'tree';
  if (s.supportEnabled) {
    // Overhang of each layer relative to the one below (slope flatter than the threshold angle).
    const overhang: Polys[] = new Array(layerCount);
    for (let i = 0; i < layerCount; i++) {
      if (i === 0) { overhang[i] = []; continue; }
      const thr = heights[i] / Math.tan((Math.max(1, s.supportThresholdAngle) * Math.PI) / 180);
      let oh = difference(R(i), offset(R(i - 1), thr));
      oh = open(oh, s.lineWidth * 0.5);
      oh = oh.filter((p) => polyArea(p) < 0 || polyArea(p) >= s.supportMinArea);
      overhang[i] = oh;
    }
    const gapLayers = Math.max(1, Math.round(s.supportZGap / s.layerHeight));
    if (treeStyle) {
      const tree = generateTreeSupport(R, heights.slice(0, layerCount), overhang, s, (f) => progress?.('Generating supports', f));
      support = tree.branches;
      supportInterface = tree.roof;
    } else {
      let acc: Polys = [];
      for (let i = layerCount - 1; i >= 0; i--) {
        const above = i + gapLayers < layerCount ? overhang[i + gapLayers] : [];
        acc = difference(union(acc, above), offset(R(i), s.supportXYGap));
        acc = acc.filter((p) => polyArea(p) < 0 || polyArea(p) >= 0.5);
        support[i] = acc;
        if (!isEmpty(acc) && s.supportInterfaceLayers > 0) {
          const window: Polys[] = [];
          for (let k = 1; k <= s.supportInterfaceLayers; k++) {
            const idx = i + gapLayers + k - 1;
            if (idx < layerCount) window.push(overhang[idx]);
          }
          supportInterface[i] = intersection(acc, unionAll(window));
        }
        if (i % 10 === 0) progress?.('Generating supports', 1 - i / layerCount);
      }
    }
  }

  // ---- Shell detection ----
  progress?.('Detecting shells', 0);
  const topShell: Polys[] = new Array(layerCount);
  const bottomShell: Polys[] = new Array(layerCount);
  const topSurface: Polys[] = new Array(layerCount);
  const bottomExposed: Polys[] = new Array(layerCount);
  for (let i = 0; i < layerCount; i++) {
    const r = R(i);
    topSurface[i] = difference(r, R(i + 1));
    bottomExposed[i] = difference(r, R(i - 1));
    let aboveAll: Polys | null = null;
    for (let k = 1; k <= s.topLayers; k++) {
      const rk = R(i + k);
      aboveAll = aboveAll === null ? rk : intersection(aboveAll, rk);
      if (isEmpty(aboveAll)) break;
    }
    topShell[i] = s.topLayers > 0 ? difference(r, aboveAll ?? []) : [];
    let belowAll: Polys | null = null;
    for (let k = 1; k <= s.bottomLayers; k++) {
      const rk = R(i - k);
      belowAll = belowAll === null ? rk : intersection(belowAll, rk);
      if (isEmpty(belowAll)) break;
    }
    bottomShell[i] = s.bottomLayers > 0 ? difference(r, belowAll ?? []) : [];
    if (i % 10 === 0) progress?.('Detecting shells', i / layerCount);
  }

  // ---- Per-layer path generation ----
  progress?.('Generating paths', 0);
  const layers: LayerPlan[] = [];
  let cur = { x: 0, y: 0 };
  const rand = mulberry32(1234);

  for (let i = 0; i < layerCount; i++) {
    const h = heights[i];
    const first = i === 0;
    const w = first ? s.firstLayerLineWidth : s.lineWidth;
    const wOuter = first ? s.firstLayerLineWidth : s.outerWallLineWidth;
    const paths: PrintPath[] = [];
    let region = R(i);
    if (first && s.elephantFootCompensation > 0) region = offset(region, -s.elephantFootCompensation);

    // Adhesion (layer 0 only)
    if (first) {
      const base = union(region, support[0]);
      let brimOuter: Polys = [];
      if (s.brimType === 'outer' && s.brimWidth > 0) {
        const loops = Math.max(1, Math.round(s.brimWidth / w));
        for (let k = 1; k <= loops; k++) {
          const ring = offset(base, s.brimGap + k * w - w / 2, 'round');
          // Only the outer contours of the brim ring (holes stay open)
          for (const p of ring) if (polyArea(p) > 0) addClosed(paths, 'brim', p, w);
          if (k === loops) brimOuter = ring;
        }
      }
      if (s.skirtLoops > 0) {
        const hull = convexHull(isEmpty(brimOuter) ? base : brimOuter);
        if (hull.length >= 3) {
          for (let k = 0; k < s.skirtLoops; k++) {
            const ring = offset([hull], s.skirtDistance + k * w + w / 2, 'round');
            for (const p of ring) addClosed(paths, 'skirt', p, w);
          }
        }
      }
    }

    // Supports
    if (!isEmpty(support[i]) || !isEmpty(supportInterface[i])) {
      const iface = supportInterface[i];
      const base = treeStyle ? support[i] : difference(support[i], iface);
      if (treeStyle) {
        // Branches: up to two concentric walls, the remainder as sparse lines (thin branches are walls only).
        const loops = Math.max(1, s.supportWalls || 2);
        let curW = offset(base, -w / 2);
        let k = 0;
        for (; k < loops && !isEmpty(curW); k++) {
          for (const p of curW) addClosed(paths, 'support', p, w);
          curW = offset(curW, -w);
        }
        const inner = offset(curW, w / 2 + w * 0.25);
        for (const l of parallelLines(inner, s.supportSpacing, 0)) addOpen(paths, 'support', l, w);
      } else {
        if (s.supportWalls > 0) {
          let curW = offset(base, -w / 2);
          for (let k = 0; k < s.supportWalls && !isEmpty(curW); k++) {
            for (const p of curW) addClosed(paths, 'support', p, w);
            curW = offset(curW, -w);
          }
        }
        const baseInner = s.supportWalls > 0 ? offset(base, -(s.supportWalls * w) + w * 0.25) : base;
        for (const l of parallelLines(baseInner, s.supportSpacing, 0)) addOpen(paths, 'support', l, w);
      }
      // Roof / interface: dense lines, alternating direction so the roof is a solid sheet
      const ifaceAngle = treeStyle ? 90 * (i % 2) : 90;
      for (const l of parallelLines(iface, s.supportInterfaceSpacing, ifaceAngle)) addOpen(paths, 'support-interface', l, w);
    }

    // Islands, nearest-first
    const isl = islands(region);
    const remaining = new Set(isl.map((_, k) => k));
    const solidReg = offset(union(topShell[i], bottomShell[i]), w);
    const topReg = offset(topSurface[i], w);
    const bottomReg = offset(bottomExposed[i], w);
    const solidAngle = s.infillAngle + 90 * (i % 2);

    while (remaining.size) {
      // pick nearest island by first contour point
      let best = -1, bestD = Infinity;
      for (const k of remaining) {
        const p = isl[k][0][0];
        const d = (toMm(p.X) - cur.x) ** 2 + (toMm(p.Y) - cur.y) ** 2;
        if (d < bestD) { bestD = d; best = k; }
      }
      remaining.delete(best);
      const island = isl[best];

      // Walls
      const walls: Polys[] = [];
      let curWall = offset(island, -wOuter / 2);
      for (let k = 0; k < s.wallLoops && !isEmpty(curWall); k++) {
        walls.push(curWall);
        curWall = offset(curWall, k === 0 ? -(wOuter / 2 + w / 2) : -w);
      }
      const lastWall = walls[walls.length - 1];
      let innerArea: Polys = [];
      if (lastWall) {
        innerArea = offset(lastWall, -w / 2 + s.infillWallOverlap * w);
      } else if (s.wallLoops === 0) {
        innerArea = island;
      }

      const wallPaths: PrintPath[] = [];
      walls.forEach((loops, k) => {
        for (const p of loops) wallPaths.push(makeClosed(k === 0 ? 'outer-wall' : 'inner-wall', p, k === 0 ? wOuter : w));
      });
      if (s.wallOrder === 'inner-outer') wallPaths.reverse();

      // Infill areas
      let solidArea = intersection(innerArea, solidReg);
      let sparseArea = difference(innerArea, solidArea);
      // tiny sparse areas -> solid
      if (s.minSparseInfillArea > 0 && !isEmpty(sparseArea)) {
        const small: Polys = [];
        const keep: Polys = [];
        for (const sub of islands(sparseArea)) {
          const a = sub.reduce((acc, p) => acc + polyArea(p), 0);
          if (a < s.minSparseInfillArea) small.push(...sub); else keep.push(...sub);
        }
        if (small.length) { solidArea = union(solidArea, small); sparseArea = keep; }
      }
      const topPart = intersection(solidArea, topReg);
      const rest1 = difference(solidArea, topPart);
      const bottomPart = intersection(rest1, bottomReg);
      const internalSolid = difference(rest1, bottomPart);

      const infillPaths: PrintPath[] = [];
      for (const l of parallelLines(internalSolid, w, solidAngle)) infillPaths.push(makeOpen('solid-infill', l, w));
      for (const l of parallelLines(bottomPart, w, solidAngle)) infillPaths.push(makeOpen(first ? 'bottom-surface' : 'bridge', l, w));
      for (const l of parallelLines(topPart, w, solidAngle)) infillPaths.push(makeOpen('top-surface', l, w));
      const sp = sparseInfill(sparseArea, s.infillPattern, w, s.infillDensity / 100, s.infillAngle, i);
      for (const l of sp.open) infillPaths.push(makeOpen('sparse-infill', l, w));
      for (const p of sp.closed) infillPaths.push(makeClosed('sparse-infill', p, w));

      const ordered = [...wallPaths, ...infillPaths];
      for (const p of ordered) {
        orientPath(p, cur, s.seamPosition, rand);
        paths.push(p);
        cur = endPoint(p);
      }
    }

    layers.push({ index: i, z: zs[i], height: h, paths });
    if (i % 5 === 0) progress?.('Generating paths', i / layerCount);
  }
  progress?.('Generating paths', 1);
  return { layers, modelBounds };
}

function makeClosed(type: PathType, p: Poly, width: number): PrintPath {
  const pts: number[] = new Array(p.length * 2);
  for (let i = 0; i < p.length; i++) { pts[i * 2] = toMm(p[i].X); pts[i * 2 + 1] = toMm(p[i].Y); }
  return { type, pts, closed: true, width };
}
function makeOpen(type: PathType, p: Poly, width: number): PrintPath {
  const pts: number[] = new Array(p.length * 2);
  for (let i = 0; i < p.length; i++) { pts[i * 2] = toMm(p[i].X); pts[i * 2 + 1] = toMm(p[i].Y); }
  return { type, pts, closed: false, width };
}
function addClosed(paths: PrintPath[], type: PathType, p: Poly, width: number) {
  if (p.length >= 3) paths.push(makeClosed(type, p, width));
}
function addOpen(paths: PrintPath[], type: PathType, p: Poly, width: number) {
  if (p.length >= 2) paths.push(makeOpen(type, p, width));
}

function endPoint(p: PrintPath): { x: number; y: number } {
  if (p.closed) return { x: p.pts[0], y: p.pts[1] };
  const n = p.pts.length;
  return { x: p.pts[n - 2], y: p.pts[n - 1] };
}

/** Choose the start vertex of a loop (seam) or the direction of an open path. */
function orientPath(p: PrintPath, cur: { x: number; y: number }, seam: SliceSettings['seamPosition'], rand: () => number) {
  const n = p.pts.length / 2;
  if (!p.closed) {
    const d0 = (p.pts[0] - cur.x) ** 2 + (p.pts[1] - cur.y) ** 2;
    const d1 = (p.pts[(n - 1) * 2] - cur.x) ** 2 + (p.pts[(n - 1) * 2 + 1] - cur.y) ** 2;
    if (d1 < d0) reverseFlat(p.pts);
    return;
  }
  if (n < 3) return;
  let best = 0;
  if (seam === 'random') {
    best = Math.floor(rand() * n);
  } else {
    let bestScore = -Infinity;
    for (let i = 0; i < n; i++) {
      const x = p.pts[i * 2], y = p.pts[i * 2 + 1];
      let score: number;
      if (seam === 'nearest') score = -((x - cur.x) ** 2 + (y - cur.y) ** 2);
      else if (seam === 'rear') score = y * 1000 + x;
      else score = x + y; // aligned: consistent back-right vertex
      if (score > bestScore) { bestScore = score; best = i; }
    }
  }
  if (best !== 0) {
    const rotated = p.pts.slice(best * 2).concat(p.pts.slice(0, best * 2));
    for (let i = 0; i < p.pts.length; i++) p.pts[i] = rotated[i];
  }
}

function reverseFlat(pts: number[]) {
  const n = pts.length / 2;
  for (let i = 0; i < Math.floor(n / 2); i++) {
    const j = n - 1 - i;
    const tx = pts[i * 2], ty = pts[i * 2 + 1];
    pts[i * 2] = pts[j * 2]; pts[i * 2 + 1] = pts[j * 2 + 1];
    pts[j * 2] = tx; pts[j * 2 + 1] = ty;
  }
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
