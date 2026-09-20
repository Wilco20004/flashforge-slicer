// Minimal typings for clipper-lib 6.4.2 (Angus Johnson's Clipper, JS port).
declare module 'clipper-lib' {
  export interface IntPoint { X: number; Y: number }
  export type Path = IntPoint[];
  export type Paths = Path[];

  export const Path: { new (): Path };
  export const Paths: { new (): Paths };
  export class IntPoint {
    constructor(x?: number, y?: number);
    X: number;
    Y: number;
  }

  export enum ClipType { ctIntersection = 0, ctUnion = 1, ctDifference = 2, ctXor = 3 }
  export enum PolyType { ptSubject = 0, ptClip = 1 }
  export enum PolyFillType { pftEvenOdd = 0, pftNonZero = 1, pftPositive = 2, pftNegative = 3 }
  export enum JoinType { jtSquare = 0, jtRound = 1, jtMiter = 2 }
  export enum EndType { etOpenSquare = 0, etOpenRound = 1, etOpenButt = 2, etClosedLine = 3, etClosedPolygon = 4 }

  export class PolyNode {
    Contour(): Path;
    Childs(): PolyNode[];
    Parent(): PolyNode | null;
    IsHole(): boolean;
    IsOpen: boolean;
    ChildCount(): number;
    GetNext(): PolyNode | null;
    m_polygon: Path;
    m_Childs: PolyNode[];
  }
  export class PolyTree extends PolyNode {
    Clear(): void;
    GetFirst(): PolyNode | null;
    Total(): number;
  }

  export class Clipper {
    constructor(initOptions?: number);
    AddPath(path: Path, polyType: PolyType, closed: boolean): boolean;
    AddPaths(paths: Paths, polyType: PolyType, closed: boolean): boolean;
    Execute(clipType: ClipType, solution: Paths | PolyTree, subjFillType?: PolyFillType, clipFillType?: PolyFillType): boolean;
    Clear(): void;
    StrictlySimple: boolean;
    PreserveCollinear: boolean;
    ReverseSolution: boolean;
    static Area(path: Path): number;
    static Orientation(path: Path): boolean;
    static ReversePath(path: Path): void;
    static ReversePaths(paths: Paths): void;
    static CleanPolygon(path: Path, distance?: number): Path;
    static CleanPolygons(paths: Paths, distance?: number): Paths;
    static SimplifyPolygon(path: Path, fillType?: PolyFillType): Paths;
    static SimplifyPolygons(paths: Paths, fillType?: PolyFillType): Paths;
    static PolyTreeToPaths(tree: PolyTree): Paths;
    static ClosedPathsFromPolyTree(tree: PolyTree): Paths;
    static OpenPathsFromPolyTree(tree: PolyTree): Paths;
    static PointInPolygon(pt: IntPoint, path: Path): number;
    static MinkowskiSum(pattern: Path, path: Path, pathIsClosed: boolean): Paths;
  }

  export class ClipperOffset {
    constructor(miterLimit?: number, arcTolerance?: number);
    AddPath(path: Path, joinType: JoinType, endType: EndType): void;
    AddPaths(paths: Paths, joinType: JoinType, endType: EndType): void;
    Execute(solution: Paths | PolyTree, delta: number): void;
    Clear(): void;
    MiterLimit: number;
    ArcTolerance: number;
  }

  export const JS: {
    AreaOfPolygon(poly: Path, scale?: number): number;
    AreaOfPolygons(polys: Paths, scale?: number): number;
    BoundsOfPath(path: Path, scale?: number): { left: number; top: number; right: number; bottom: number };
    BoundsOfPaths(paths: Paths, scale?: number): { left: number; top: number; right: number; bottom: number };
    Clone(paths: Paths): Paths;
    Lighten(paths: Paths, tolerance: number): Paths;
    PerimeterOfPath(path: Path, closed: boolean, scale?: number): number;
    PerimeterOfPaths(paths: Paths, closed: boolean, scale?: number): number;
    ScaleUpPath(path: Path, scale: number): void;
    ScaleUpPaths(paths: Paths, scale: number): void;
    ScaleDownPath(path: Path, scale: number): void;
    ScaleDownPaths(paths: Paths, scale: number): void;
  };

  const ClipperLib: {
    Clipper: typeof Clipper;
    ClipperOffset: typeof ClipperOffset;
    PolyTree: typeof PolyTree;
    PolyNode: typeof PolyNode;
    IntPoint: typeof IntPoint;
    Path: typeof Path;
    Paths: typeof Paths;
    ClipType: typeof ClipType;
    PolyType: typeof PolyType;
    PolyFillType: typeof PolyFillType;
    JoinType: typeof JoinType;
    EndType: typeof EndType;
    JS: typeof JS;
  };
  export default ClipperLib;
}
