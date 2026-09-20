import ClipperLib, { type IntPoint, type PolyNode } from 'clipper-lib';

/** Integer scale: 1 unit = 1 µm. */
export const SCALE = 1000;

export type Pt = IntPoint;
export type Poly = Pt[];
export type Polys = Poly[];

const { Clipper, ClipperOffset, PolyTree, ClipType, PolyType, PolyFillType, JoinType, EndType } = ClipperLib;

export const toInt = (mm: number) => Math.round(mm * SCALE);
export const toMm = (v: number) => v / SCALE;

export function pt(xMm: number, yMm: number): Pt {
  return { X: toInt(xMm), Y: toInt(yMm) };
}

export function isEmpty(p: Polys | undefined | null): boolean {
  return !p || p.length === 0;
}

/** Union with even-odd fill: normalises arbitrary loops into outers (+) and holes (-). */
export function normalize(loops: Polys): Polys {
  if (loops.length === 0) return [];
  const c = new Clipper();
  c.StrictlySimple = true;
  c.AddPaths(loops, PolyType.ptSubject, true);
  const out: Polys = [];
  c.Execute(ClipType.ctUnion, out, PolyFillType.pftEvenOdd, PolyFillType.pftEvenOdd);
  return out;
}

export function union(a: Polys, b?: Polys): Polys {
  if (isEmpty(a) && isEmpty(b)) return [];
  const c = new Clipper();
  c.AddPaths(a, PolyType.ptSubject, true);
  if (b && b.length) c.AddPaths(b, PolyType.ptClip, true);
  const out: Polys = [];
  c.Execute(ClipType.ctUnion, out, PolyFillType.pftNonZero, PolyFillType.pftNonZero);
  return out;
}

export function unionAll(list: Polys[]): Polys {
  const c = new Clipper();
  let any = false;
  for (const p of list) {
    if (p && p.length) { c.AddPaths(p, PolyType.ptSubject, true); any = true; }
  }
  if (!any) return [];
  const out: Polys = [];
  c.Execute(ClipType.ctUnion, out, PolyFillType.pftNonZero, PolyFillType.pftNonZero);
  return out;
}

export function difference(a: Polys, b: Polys): Polys {
  if (isEmpty(a)) return [];
  if (isEmpty(b)) return a;
  const c = new Clipper();
  c.AddPaths(a, PolyType.ptSubject, true);
  c.AddPaths(b, PolyType.ptClip, true);
  const out: Polys = [];
  c.Execute(ClipType.ctDifference, out, PolyFillType.pftNonZero, PolyFillType.pftNonZero);
  return out;
}

export function intersection(a: Polys, b: Polys): Polys {
  if (isEmpty(a) || isEmpty(b)) return [];
  const c = new Clipper();
  c.AddPaths(a, PolyType.ptSubject, true);
  c.AddPaths(b, PolyType.ptClip, true);
  const out: Polys = [];
  c.Execute(ClipType.ctIntersection, out, PolyFillType.pftNonZero, PolyFillType.pftNonZero);
  return out;
}

/** Offset closed polygons by delta (mm). Negative shrinks. */
export function offset(polys: Polys, deltaMm: number, join: 'miter' | 'round' | 'square' = 'miter'): Polys {
  if (isEmpty(polys)) return [];
  const co = new ClipperOffset(3, 0.25 * SCALE / 10);
  const jt = join === 'round' ? JoinType.jtRound : join === 'square' ? JoinType.jtSquare : JoinType.jtMiter;
  co.AddPaths(polys, jt, EndType.etClosedPolygon);
  const out: Polys = [];
  co.Execute(out, toInt(deltaMm));
  return out;
}

/** Morphological opening: removes features thinner than 2*r. */
export function open(polys: Polys, rMm: number): Polys {
  return offset(offset(polys, -rMm), rMm);
}

/** Total signed area in mm² (holes negative). */
export function area(polys: Polys): number {
  let a = 0;
  for (const p of polys) a += Clipper.Area(p);
  return a / (SCALE * SCALE);
}

export function polyArea(p: Poly): number {
  return Clipper.Area(p) / (SCALE * SCALE);
}

export function bounds(polys: Polys): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of polys) for (const q of p) {
    if (q.X < minX) minX = q.X;
    if (q.Y < minY) minY = q.Y;
    if (q.X > maxX) maxX = q.X;
    if (q.Y > maxY) maxY = q.Y;
  }
  return { minX, minY, maxX, maxY };
}

/** Clip open polylines to the inside of a closed region. Returns open paths. */
export function clipLines(lines: Polys, region: Polys): Polys {
  if (isEmpty(lines) || isEmpty(region)) return [];
  const c = new Clipper();
  c.AddPaths(lines, PolyType.ptSubject, false);
  c.AddPaths(region, PolyType.ptClip, true);
  const tree = new PolyTree();
  c.Execute(ClipType.ctIntersection, tree, PolyFillType.pftNonZero, PolyFillType.pftNonZero);
  return Clipper.OpenPathsFromPolyTree(tree);
}

export function simplify(polys: Polys, toleranceMm: number): Polys {
  if (isEmpty(polys)) return [];
  const cleaned = Clipper.CleanPolygons(polys, toInt(toleranceMm));
  return cleaned.filter((p) => p.length >= 3);
}

/** Split a set of polygons into islands: each outer with its holes. */
export function islands(polys: Polys): Polys[] {
  if (isEmpty(polys)) return [];
  const c = new Clipper();
  c.AddPaths(polys, PolyType.ptSubject, true);
  const tree = new PolyTree();
  c.Execute(ClipType.ctUnion, tree, PolyFillType.pftNonZero, PolyFillType.pftNonZero);
  const out: Polys[] = [];
  const visit = (node: PolyNode) => {
    for (const child of node.Childs()) {
      if (!child.IsHole()) {
        const island: Polys = [child.Contour()];
        for (const hole of child.Childs()) {
          island.push(hole.Contour());
          // Islands nested inside holes are separate islands.
          visit(hole);
        }
        out.push(island);
      }
    }
  };
  visit(tree);
  return out;
}

/** Convex hull (Andrew's monotone chain) of all points in polys. */
export function convexHull(polys: Polys): Poly {
  const pts: Pt[] = [];
  for (const p of polys) for (const q of p) pts.push(q);
  if (pts.length < 3) return pts;
  pts.sort((a, b) => (a.X - b.X) || (a.Y - b.Y));
  const cross = (o: Pt, a: Pt, b: Pt) => (a.X - o.X) * (b.Y - o.Y) - (a.Y - o.Y) * (b.X - o.X);
  const lower: Pt[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Pt[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

export function pointInPolys(x: number, y: number, polys: Polys): boolean {
  // Non-zero winding over outers (+) and holes (-) via even-odd count of containing polys.
  let inside = 0;
  const p = { X: x, Y: y };
  for (const poly of polys) {
    if (Clipper.PointInPolygon(p, poly) !== 0) inside++;
  }
  return inside % 2 === 1;
}

export function perimeter(poly: Poly, closed = true): number {
  let len = 0;
  for (let i = 0; i < poly.length - 1; i++) len += Math.hypot(poly[i + 1].X - poly[i].X, poly[i + 1].Y - poly[i].Y);
  if (closed && poly.length > 2) len += Math.hypot(poly[0].X - poly[poly.length - 1].X, poly[0].Y - poly[poly.length - 1].Y);
  return len / SCALE;
}
