/** Output of the geometry stage, input of the G-code stage. */

export type PathType =
  | 'outer-wall'
  | 'inner-wall'
  | 'sparse-infill'
  | 'solid-infill'
  | 'top-surface'
  | 'bottom-surface'
  | 'bridge'
  | 'skirt'
  | 'brim'
  | 'support'
  | 'support-interface'
  | 'travel';

export const PATH_TYPES: PathType[] = [
  'outer-wall', 'inner-wall', 'sparse-infill', 'solid-infill', 'top-surface', 'bottom-surface',
  'bridge', 'skirt', 'brim', 'support', 'support-interface', 'travel',
];

export const PATH_TYPE_LABEL: Record<PathType, string> = {
  'outer-wall': 'Outer wall',
  'inner-wall': 'Inner wall',
  'sparse-infill': 'Sparse infill',
  'solid-infill': 'Internal solid infill',
  'top-surface': 'Top surface',
  'bottom-surface': 'Bottom surface',
  bridge: 'Bridge',
  skirt: 'Skirt',
  brim: 'Brim',
  support: 'Support',
  'support-interface': 'Support interface',
  travel: 'Travel',
};

export const PATH_TYPE_COLOR: Record<PathType, string> = {
  'outer-wall': '#ff7a1a',
  'inner-wall': '#ffd23f',
  'sparse-infill': '#c04bd6',
  'solid-infill': '#8a5cff',
  'top-surface': '#ff3b6b',
  'bottom-surface': '#3fb0ff',
  bridge: '#4fd2c9',
  skirt: '#6bff8d',
  brim: '#6bff8d',
  support: '#9aa4b1',
  'support-interface': '#d7dde5',
  travel: '#3a4a5c',
};

export interface PrintPath {
  type: PathType;
  /** Flat XY coordinates in mm: [x0, y0, x1, y1, ...]. */
  pts: number[];
  closed: boolean;
  /** Extrusion width (mm). */
  width: number;
}

export interface LayerPlan {
  index: number;
  /** Top Z of this layer (mm). */
  z: number;
  height: number;
  paths: PrintPath[];
}

export interface PlanStats {
  layerCount: number;
  maxZ: number;
  supportLayers: number;
}
