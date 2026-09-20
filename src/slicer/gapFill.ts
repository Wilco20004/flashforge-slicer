import { islands, offset, polyArea, perimeter, isEmpty, toMm, type Polys, type Poly } from './polygons';

export interface GapPath {
  /** Flat XY in mm. */
  pts: number[];
  closed: boolean;
  /** Extrusion width for this path: the local width of the gap. */
  width: number;
}

/**
 * Fill what is left between the walls and the infill.
 *
 * Where a feature is too narrow for another wall loop but too wide to ignore -
 * a tapering rib, the tip of a wedge, the seam between two curved walls - the
 * area stays empty and the part comes out weak and gappy. Each leftover sliver
 * is reduced to its centreline by eroding it until it collapses, then printed
 * once at the sliver's own width.
 */
export function gapFillPaths(gaps: Polys, lineWidth: number, minAreaMm2 = 0.05): GapPath[] {
  if (isEmpty(gaps) || lineWidth <= 0) return [];
  const out: GapPath[] = [];
  for (const island of islands(gaps)) {
    const area = island.reduce((s, p) => s + polyArea(p), 0);
    const per = island.reduce((s, p) => s + perimeter(p, true), 0);
    if (area < minAreaMm2 || per <= 0) continue;
    // Mean width of a thin region: twice its area over its outline length.
    const t = (2 * area) / per;
    // Anything this wide should have been covered by a wall or by infill.
    if (t <= 0 || t > lineWidth * 1.2) continue;
    const width = Math.min(lineWidth, Math.max(lineWidth * 0.3, t));

    let spine: Polys = [];
    for (const f of [0.45, 0.35, 0.25]) {
      spine = offset(island, -t * f);
      if (!isEmpty(spine)) break;
    }
    if (isEmpty(spine)) continue;

    for (const sub of islands(spine)) {
      const outline = sub[0];
      if (outline.length < 3) continue;
      if (sub.length > 1) {
        // A ring (a gap around a hole): its outline already follows the gap.
        if (perimeter(outline, true) >= lineWidth) out.push({ pts: flatten(outline), closed: true, width });
      } else {
        // A collapsed sliver: both sides of the loop trace the same line, so
        // print one side of it.
        const chain = halfLoop(outline);
        if (chain.length >= 4 && chainLength(chain) >= lineWidth) out.push({ pts: chain, closed: false, width });
      }
    }
  }
  return out;
}

function flatten(p: Poly): number[] {
  const pts: number[] = new Array(p.length * 2);
  for (let i = 0; i < p.length; i++) { pts[i * 2] = toMm(p[i].X); pts[i * 2 + 1] = toMm(p[i].Y); }
  return pts;
}

/** One side of a loop, between its two most distant vertices. */
function halfLoop(p: Poly): number[] {
  const far = (from: number) => {
    let best = from, bestD = -1;
    for (let i = 0; i < p.length; i++) {
      const d = (p[i].X - p[from].X) ** 2 + (p[i].Y - p[from].Y) ** 2;
      if (d > bestD) { bestD = d; best = i; }
    }
    return best;
  };
  const a = far(far(0));
  const b = far(a);
  const out: number[] = [];
  for (let i = a; ; i = (i + 1) % p.length) {
    out.push(toMm(p[i].X), toMm(p[i].Y));
    if (i === b) break;
  }
  return out;
}

function chainLength(pts: number[]): number {
  let len = 0;
  for (let i = 2; i < pts.length; i += 2) len += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
  return len;
}
