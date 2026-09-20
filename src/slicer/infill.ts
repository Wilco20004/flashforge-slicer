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
  if (density >= 0.99) {
    return { open: parallelLines(region, lineWidth, baseAngle + 90 * (layerIndex % 2)), closed: [] };
  }
  const spacing = lineWidth / density;
  switch (pattern) {
    case 'lines':
      return { open: parallelLines(region, spacing, baseAngle), closed: [] };
    case 'rectilinear':
      return { open: parallelLines(region, spacing, baseAngle + 90 * (layerIndex % 2)), closed: [] };
    case 'grid':
      return {
        open: [
          ...parallelLines(region, spacing * 2, baseAngle),
          ...parallelLines(region, spacing * 2, baseAngle + 90),
        ],
        closed: [],
      };
    case 'triangles':
      return {
        open: [
          ...parallelLines(region, spacing * 3, baseAngle),
          ...parallelLines(region, spacing * 3, baseAngle + 60),
          ...parallelLines(region, spacing * 3, baseAngle + 120),
        ],
        closed: [],
      };
    case 'concentric':
      return { open: [], closed: concentric(region, spacing, lineWidth / 2) };
    default:
      return { open: parallelLines(region, spacing, baseAngle), closed: [] };
  }
}

export function polyLengthMm(p: Poly, closed: boolean): number {
  let len = 0;
  for (let i = 0; i < p.length - 1; i++) len += Math.hypot(p[i + 1].X - p[i].X, p[i + 1].Y - p[i].Y);
  if (closed && p.length > 2) len += Math.hypot(p[0].X - p[p.length - 1].X, p[0].Y - p[p.length - 1].Y);
  return len / SCALE;
}
