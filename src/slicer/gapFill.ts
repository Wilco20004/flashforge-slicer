import { islands, polyArea, meanWidth, isEmpty, toMm, type Polys, type Poly } from './polygons';
import { medialChains } from './medial';

/** Below this fraction of a line width a gap is left alone. */
const MIN_WIDTH_RATIO = 0.3;

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
 * is reduced to its centreline and printed once at the sliver's own width.
 */
export function gapFillPaths(gaps: Polys, lineWidth: number, minAreaMm2 = 0.05): GapPath[] {
  if (isEmpty(gaps) || lineWidth <= 0) return [];
  const out: GapPath[] = [];
  for (const island of islands(gaps)) {
    const area = island.reduce((s, p) => s + polyArea(p), 0);
    if (area < minAreaMm2) continue;
    const t = meanWidth(island);
    // Anything this wide should have been covered by a wall or by infill, and
    // anything this narrow costs more in over-extrusion than the gap is worth.
    if (t < lineWidth * MIN_WIDTH_RATIO || t > lineWidth * 1.2) continue;
    const width = Math.min(lineWidth, t);
    for (const m of medialChains(island, t, lineWidth)) {
      out.push({ pts: flatten(m.pts), closed: m.closed, width });
    }
  }
  return out;
}

function flatten(p: Poly): number[] {
  const pts: number[] = new Array(p.length * 2);
  for (let i = 0; i < p.length; i++) { pts[i * 2] = toMm(p[i].X); pts[i * 2 + 1] = toMm(p[i].Y); }
  return pts;
}
