import {
  islands, offset, difference, unionAll, isEmpty, stroke, meanWidth,
  type Polys, type Poly,
} from './polygons';
import { medialChains } from './medial';

export interface WallBead {
  pts: Poly;
  closed: boolean;
  /** Extrusion width for this bead (mm). Varies when `variable` is on. */
  width: number;
  /** 0 = outermost. */
  loop: number;
}

export interface WallResult {
  beads: WallBead[];
  /** Area the walls did not cover, before any infill overlap is applied. */
  inner: Polys;
  /** Area the walls do cover, for working out what is left to gap fill. */
  covered: Polys;
}

export interface WallOptions {
  loops: number;
  outerWidth: number;
  innerWidth: number;
  /** Let a bead be wider or narrower than nominal to fill its feature exactly. */
  variable: boolean;
}

/** A bead narrower than this fraction of nominal will not stick; drop it. */
const MIN_WIDTH_RATIO = 0.5;

/**
 * Wall loops for one island.
 *
 * With `variable` off this is the classic fixed-width inset chain: loop k sits
 * one line width inside loop k-1 and whatever is left over becomes infill.
 *
 * With it on, each connected part of what remains is measured first. A part
 * thick enough to take the full complement of loops and still leave a core for
 * infill is inset as usual. A part too thin for that is consumed by the walls
 * instead: it is given `n = round(thickness / lineWidth)` beads, each
 * `thickness / n` wide, so the feature is filled exactly rather than getting
 * fixed-width loops plus an unprintable sliver. An odd bead count puts the last
 * bead on the feature's centreline.
 *
 * This is the useful half of Arachne without its Voronoi skeleton: the bead
 * count and width come from a measured thickness rather than from a
 * per-vertex skeletal graph, so a part whose thickness changes sharply gets one
 * width per connected region rather than a width that varies along the bead.
 *
 * Coverage is tracked by subtracting the area each bead actually paints, so a
 * feature an inset dropped for being too thin survives into the next round and
 * is picked up there instead of silently vanishing.
 */
export function generateWalls(island: Polys, o: WallOptions): WallResult {
  const beads: WallBead[] = [];
  const painted: Polys[] = [];
  let remaining = island;

  const minW = o.innerWidth * MIN_WIDTH_RATIO;

  for (let k = 0; k < o.loops && !isEmpty(remaining); k++) {
    const bw = k === 0 ? o.outerWidth : o.innerWidth;
    const budget = o.loops - k;
    const keep: Polys = [];

    for (const comp of islands(remaining)) {
      const t = meanWidth(comp);
      if (t < minW) continue; // nothing printable here

      // Room for every remaining loop at nominal width plus an infill line?
      const roomy = t >= 2 * budget * bw + o.innerWidth;
      if (!o.variable || roomy) {
        const centre = offset(comp, -bw / 2);
        if (isEmpty(centre)) continue;
        for (const c of centre) if (c.length >= 3) beads.push({ pts: c, closed: true, width: bw, loop: k });
        const band = stroke(centre, bw);
        painted.push(band);
        keep.push(...difference(comp, band));
      } else {
        keep.push(...consume(comp, t, bw, budget, k, beads, painted));
      }
    }
    remaining = keep;
  }

  // Slivers left by the offsets are for gap fill, not for infill lines.
  const inner: Polys = [];
  for (const comp of islands(remaining)) if (meanWidth(comp) >= minW) inner.push(...comp);

  beads.sort((a, b) => a.loop - b.loop);
  return { beads, inner, covered: unionAll(painted) };
}

/**
 * Fill a part too thin for more nominal loops with evenly divided beads, and
 * return whatever they still failed to cover.
 */
function consume(
  comp: Polys, t: number, bw: number, budget: number, k: number,
  beads: WallBead[], painted: Polys[],
): Polys {
  // The epsilon keeps a feature sitting exactly on a half line - 1.05mm walls
  // drawn for a 0.42 line, say - from landing on either bead count depending on
  // the last bit of the thickness. Half a line rounds up, which keeps the beads
  // nearer nominal than rounding down would.
  const n = Math.max(1, Math.min(2 * budget, Math.round(t / bw + 1e-9)));
  const width = t / n;
  const rings = Math.floor(n / 2);
  const mine: Polys[] = [];
  let region = comp;

  for (let j = 0; j < rings && !isEmpty(region); j++) {
    const centre = offset(region, -width / 2);
    if (isEmpty(centre)) break;
    for (const c of centre) if (c.length >= 3) beads.push({ pts: c, closed: true, width, loop: k + j });
    mine.push(stroke(centre, width));
    region = offset(region, -width);
  }
  if (n % 2 === 1 && !isEmpty(region)) {
    for (const sub of islands(region)) {
      // The measured thickness is one number for the whole part, so a part that
      // is thin at one end and thick at the other can still have a solid core
      // here. A centreline through that would be a bead down one side of it;
      // leave it uncovered and let the next round measure it on its own.
      if (meanWidth(sub) > width * 1.5) continue;
      for (const m of medialChains(sub, width, width)) {
        beads.push({ pts: m.pts, closed: m.closed, width, loop: k + rings });
        mine.push(stroke([m.pts], width, m.closed));
      }
    }
  }

  const band = unionAll(mine);
  painted.push(band);
  return difference(comp, band);
}
