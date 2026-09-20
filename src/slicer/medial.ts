import { islands, offset, perimeter, isEmpty, SCALE, type Polys, type Poly } from './polygons';

export interface MedialChain {
  pts: Poly;
  closed: boolean;
}

/**
 * Approximate the centreline of a region that is everywhere about `thickness`
 * wide, by eroding it until it collapses onto itself.
 *
 * A proper medial axis needs the Voronoi diagram of the outline's segments.
 * For the shapes this is used on - slivers between walls, the last bead of a
 * thin feature - the region is a slab or a ring, and eroding it to collapse
 * lands on the same line to well under a line width.
 */
export function medialChains(region: Polys, thickness: number, minLength = 0): MedialChain[] {
  if (isEmpty(region) || thickness <= 0) return [];
  let spine: Polys = [];
  for (const f of [0.48, 0.44, 0.38, 0.3, 0.2]) {
    spine = offset(region, -thickness * f);
    if (!isEmpty(spine)) break;
  }
  if (isEmpty(spine)) return [];

  const out: MedialChain[] = [];
  for (const sub of islands(spine)) {
    const outline = sub[0];
    if (outline.length < 3) continue;
    if (sub.length > 1) {
      // A ring (the region wraps a hole): its centre runs between the two sides.
      const ring = midline(outline, sub.slice(1));
      if (perimeter(ring, true) >= minLength) out.push({ pts: ring, closed: true });
    } else {
      // Collapsed: both sides of the loop trace the same line.
      const chain = centreChain(outline);
      if (chain.length >= 2 && chainLength(chain) >= minLength) out.push({ pts: chain, closed: false });
    }
  }
  return out;
}

/**
 * The centre of a collapsed loop, between its two most distant vertices.
 *
 * Erosion leaves a sliver rather than a true line, so one side of it sits half
 * the residual thickness off centre - enough, on a feature only a little wider
 * than the nozzle, to push the bead past the model's surface. Walking one side
 * and pulling each point halfway to the other removes that bias.
 */
function centreChain(p: Poly): Poly {
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
  const side = (from: number, to: number): Poly => {
    const out: Poly = [];
    for (let i = from; ; i = (i + 1) % p.length) {
      out.push(p[i]);
      if (i === to) break;
    }
    return out;
  };
  return midline(side(a, b), [side(b, a)]);
}

/** Pairing cost above which the midline is not worth the time. */
const MAX_PAIRINGS = 40000;

/** Pull every point of `chain` halfway towards the nearest point of `others`. */
function midline(chain: Poly, others: Polys): Poly {
  let n = 0;
  for (const o of others) n += o.length;
  if (n === 0 || chain.length * n > MAX_PAIRINGS) return chain;
  return chain.map((q) => {
    let bx = 0, by = 0, bd = Infinity;
    for (const o of others) {
      for (let i = 0; i < o.length; i++) {
        const a = o[i], b = o[(i + 1) % o.length];
        const dx = b.X - a.X, dy = b.Y - a.Y;
        const l2 = dx * dx + dy * dy;
        let t = l2 > 0 ? ((q.X - a.X) * dx + (q.Y - a.Y) * dy) / l2 : 0;
        t = Math.max(0, Math.min(1, t));
        const px = a.X + t * dx, py = a.Y + t * dy;
        const d = (px - q.X) ** 2 + (py - q.Y) ** 2;
        if (d < bd) { bd = d; bx = px; by = py; }
      }
    }
    return { X: Math.round((q.X + bx) / 2), Y: Math.round((q.Y + by) / 2) };
  });
}

function chainLength(p: Poly): number {
  let len = 0;
  for (let i = 1; i < p.length; i++) len += Math.hypot(p[i].X - p[i - 1].X, p[i].Y - p[i - 1].Y);
  return len / SCALE;
}
