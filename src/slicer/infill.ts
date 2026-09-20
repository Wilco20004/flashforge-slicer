import { bounds, clipLines, offset, isEmpty, type Polys, type Poly, SCALE } from './polygons';

/**
 * Parallel lines at `angleDeg`, `spacingMm` apart, clipped to `region`.
 * Lines are anchored to the global origin so consecutive layers line up.
 * Result is returned in scan order with alternating direction (monotonic-friendly).
 */
export function parallelLines(region: Polys, spacingMm: number, angleDeg: number): Polys {
  if (isEmpty(region) || spacingMm <= 0) return [];
  const b = bounds(region);
  const th = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(th), sin = Math.sin(th);
  // Rotated frame: u = perpendicular offset, v = along the line.
  const corners = [
    [b.minX, b.minY], [b.maxX, b.minY], [b.minX, b.maxY], [b.maxX, b.maxY],
  ];
  let umin = Infinity, umax = -Infinity, vmin = Infinity, vmax = -Infinity;
  for (const [x, y] of corners) {
    const u = -x * sin + y * cos;
    const v = x * cos + y * sin;
    if (u < umin) umin = u; if (u > umax) umax = u;
    if (v < vmin) vmin = v; if (v > vmax) vmax = v;
  }
  const spacing = spacingMm * SCALE;
  const margin = spacing;
  vmin -= margin; vmax += margin;
  const kStart = Math.ceil((umin - margin) / spacing);
  const kEnd = Math.floor((umax + margin) / spacing);
  if (kEnd - kStart > 200000) return []; // safety
  const lines: Polys = [];
  for (let k = kStart; k <= kEnd; k++) {
    const u = k * spacing;
    // back to xy: x = v cos - u sin ; y = v sin + u cos
    lines.push([
      { X: Math.round(vmin * cos - u * sin), Y: Math.round(vmin * sin + u * cos) },
      { X: Math.round(vmax * cos - u * sin), Y: Math.round(vmax * sin + u * cos) },
    ]);
  }
  const clipped = clipLines(lines, region);
  // Scan order: by u then v, alternate direction per u-band.
  const keyed = clipped.map((p) => {
    const a = p[0], z = p[p.length - 1];
    const u = (-a.X * sin + a.Y * cos + -z.X * sin + z.Y * cos) / 2;
    const va = a.X * cos + a.Y * sin;
    const vz = z.X * cos + z.Y * sin;
    return { p, band: Math.round(u / spacing), vmin: Math.min(va, vz), va, vz };
  });
  keyed.sort((m, n) => (m.band - n.band) || (m.vmin - n.vmin));
  const out: Polys = [];
  let bandIdx = -1, lastBand = NaN;
  for (const k of keyed) {
    if (k.band !== lastBand) { bandIdx++; lastBand = k.band; }
    const forward = bandIdx % 2 === 0;
    // forward: increasing v; backward: decreasing v
    const startsLow = k.va <= k.vz;
    out.push(forward === startsLow ? k.p : k.p.slice().reverse());
  }
  return out;
}


/**
 * Join scan-ordered infill lines into continuous zigzags.
 *
 * Each clipped line would otherwise be printed on its own: stop, lift, travel,
 * retract, restart. Consecutive lines are linked when the connector is short
 * and stays inside the region, which is what every production slicer does and
 * what keeps the head moving instead of stopping at every line end.
 */
export function connectLines(lines: Polys, region: Polys, maxGapMm: number): Polys {
  if (lines.length <= 1 || isEmpty(region) || maxGapMm <= 0) return lines;
  const maxGap = maxGapMm * SCALE;
  const e = regionEdges(region);
  const out: Polys = [];
  let cur: Poly = lines[0].slice();
  for (let i = 1; i < lines.length; i++) {
    const a = cur[cur.length - 1];
    const next = lines[i];
    const b = next[0];
    const dx = b.X - a.X, dy = b.Y - a.Y;
    if (dx * dx + dy * dy <= maxGap * maxGap && connectorInside(a, b, e)) {
      for (const q of next) cur.push(q);
    } else {
      out.push(cur);
      cur = next.slice();
    }
  }
  out.push(cur);
  return out;
}

/** Drop open lines shorter than `minMm`: they cost a travel and a retraction to lay down almost nothing. */
export function dropShortLines(lines: Polys, minMm: number): Polys {
  if (minMm <= 0) return lines;
  const min = minMm * SCALE;
  return lines.filter((p) => {
    let len = 0;
    for (let i = 1; i < p.length; i++) len += Math.hypot(p[i].X - p[i - 1].X, p[i].Y - p[i - 1].Y);
    return len >= min;
  });
}

interface Edges { x1: Float64Array; y1: Float64Array; x2: Float64Array; y2: Float64Array; n: number }

function regionEdges(region: Polys): Edges {
  let n = 0;
  for (const p of region) n += p.length;
  const x1 = new Float64Array(n), y1 = new Float64Array(n), x2 = new Float64Array(n), y2 = new Float64Array(n);
  let k = 0;
  for (const p of region) {
    for (let i = 0; i < p.length; i++) {
      const a = p[i], b = p[(i + 1) % p.length];
      x1[k] = a.X; y1[k] = a.Y; x2[k] = b.X; y2[k] = b.Y; k++;
    }
  }
  return { x1, y1, x2, y2, n: k };
}

const cross3 = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) =>
  (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);

/**
 * True when the whole connector a-b lies within the region.
 *
 * Both endpoints sit exactly on the outline (they are clipped line ends), which
 * makes a crossing test alone blind to a connector that spans the gap between
 * two separate areas. So the interior is sampled as well: a connector that
 * leaves the region, crosses a hole or bridges a slot is rejected.
 */
function connectorInside(a: Poly[number], b: Poly[number], e: Edges): boolean {
  if (crossesBoundary(a, b, e)) return false;
  for (const t of [0.25, 0.5, 0.75]) {
    const px = a.X + (b.X - a.X) * t, py = a.Y + (b.Y - a.Y) * t;
    // A turn at the end of a scan line runs along the outline, where a ray cast
    // is ambiguous, so points on the outline count as inside.
    if (!pointInside(px, py, e) && !nearBoundary(px, py, e)) return false;
  }
  return true;
}

/** Half an extrusion width is far too coarse here; this is a geometric tolerance only. */
const ON_BOUNDARY = 25; // µm

function nearBoundary(px: number, py: number, e: Edges): boolean {
  const lim = ON_BOUNDARY * ON_BOUNDARY;
  for (let i = 0; i < e.n; i++) {
    const ax = e.x1[i], ay = e.y1[i], bx = e.x2[i], by = e.y2[i];
    if (px < Math.min(ax, bx) - ON_BOUNDARY || px > Math.max(ax, bx) + ON_BOUNDARY) continue;
    if (py < Math.min(ay, by) - ON_BOUNDARY || py > Math.max(ay, by) + ON_BOUNDARY) continue;
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy;
    let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = ax + t * dx - px, qy = ay + t * dy - py;
    if (qx * qx + qy * qy <= lim) return true;
  }
  return false;
}

/** Even-odd ray cast against the region outline (holes included). */
function pointInside(px: number, py: number, e: Edges): boolean {
  let inside = false;
  for (let i = 0; i < e.n; i++) {
    const ay = e.y1[i], by = e.y2[i];
    if ((ay > py) === (by > py)) continue;
    const ax = e.x1[i], bx = e.x2[i];
    if (px < ax + ((py - ay) / (by - ay)) * (bx - ax)) inside = !inside;
  }
  return inside;
}

function crossesBoundary(a: Poly[number], b: Poly[number], e: Edges): boolean {
  const loX = Math.min(a.X, b.X), hiX = Math.max(a.X, b.X);
  const loY = Math.min(a.Y, b.Y), hiY = Math.max(a.Y, b.Y);
  for (let i = 0; i < e.n; i++) {
    const cx = e.x1[i], cy = e.y1[i], dx = e.x2[i], dy = e.y2[i];
    if (Math.max(cx, dx) < loX || Math.min(cx, dx) > hiX || Math.max(cy, dy) < loY || Math.min(cy, dy) > hiY) continue;
    const d1 = cross3(cx, cy, dx, dy, a.X, a.Y);
    const d2 = cross3(cx, cy, dx, dy, b.X, b.Y);
    const d3 = cross3(a.X, a.Y, b.X, b.Y, cx, cy);
    const d4 = cross3(a.X, a.Y, b.X, b.Y, dx, dy);
    if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  }
  return false;
}

/** Concentric loops: inward offsets of the region every spacing. */
export function concentric(region: Polys, spacingMm: number, firstInsetMm: number): Polys {
  const out: Polys = [];
  let cur = offset(region, -firstInsetMm);
  let guard = 0;
  while (!isEmpty(cur) && guard++ < 10000) {
    for (const p of cur) out.push(p);
    cur = offset(cur, -spacingMm);
  }
  return out;
}

export type InfillPatternName = 'rectilinear' | 'grid' | 'triangles' | 'concentric' | 'lines';

export interface InfillResult { open: Polys; closed: Polys }

/**
 * Sparse infill for one region.
 * @param lineWidth extrusion width (mm)
 * @param density   0..1
 */
export function sparseInfill(
  region: Polys,
  pattern: InfillPatternName,
  lineWidth: number,
  density: number,
  baseAngle: number,
  layerIndex: number,
): InfillResult {
  if (isEmpty(region) || density <= 0) return { open: [], closed: [] };
  // Each direction is generated, joined and pruned on its own, so a zigzag never
  // links lines belonging to different directions of the same pattern.
  const runs = (spacingMm: number, angle: number) =>
    dropShortLines(connectLines(parallelLines(region, spacingMm, angle), region, spacingMm * 1.5), lineWidth);

  if (density >= 0.99) return { open: runs(lineWidth, baseAngle + 90 * (layerIndex % 2)), closed: [] };
  const spacing = lineWidth / density;
  switch (pattern) {
    case 'lines':
      return { open: runs(spacing, baseAngle), closed: [] };
    case 'rectilinear':
      return { open: runs(spacing, baseAngle + 90 * (layerIndex % 2)), closed: [] };
    case 'grid':
      return { open: [...runs(spacing * 2, baseAngle), ...runs(spacing * 2, baseAngle + 90)], closed: [] };
    case 'triangles':
      return {
        open: [
          ...runs(spacing * 3, baseAngle),
          ...runs(spacing * 3, baseAngle + 60),
          ...runs(spacing * 3, baseAngle + 120),
        ],
        closed: [],
      };
    case 'concentric':
      return { open: [], closed: concentric(region, spacing, lineWidth / 2) };
    default:
      return { open: runs(spacing, baseAngle), closed: [] };
  }
}

export function polyLengthMm(p: Poly, closed: boolean): number {
  let len = 0;
  for (let i = 0; i < p.length - 1; i++) len += Math.hypot(p[i + 1].X - p[i].X, p[i + 1].Y - p[i].Y);
  if (closed && p.length > 2) len += Math.hypot(p[0].X - p[p.length - 1].X, p[0].Y - p[p.length - 1].Y);
  return len / SCALE;
}
