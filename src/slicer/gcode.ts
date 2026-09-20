import type { SliceSettings } from './settings';
import { PATH_TYPES, PATH_TYPE_LABEL, type LayerPlan, type PathType, type PrintPath } from './plan';

export const SLICER_NAME = 'Planty Slicer';
export const SLICER_VERSION = '0.1.0';

export interface GcodeStats {
  printTimeSec: number;
  filamentMm: number;
  filamentCm3: number;
  filamentG: number;
  layerCount: number;
  maxZ: number;
  layerTimes: number[];
}

/** Segment list for the preview: 6 floats per segment + a type byte + a layer index. */
export interface PreviewData {
  segments: Float32Array;
  types: Uint8Array;
  /** segment index where each layer starts; length = layerCount + 1 */
  layerOffsets: Uint32Array;
}

export interface GcodeResult {
  gcode: string;
  stats: GcodeStats;
  preview: PreviewData;
}

export interface GcodeOptions {
  /** Base64 PNG of thumbnailWidth x thumbnailHeight for the printer's file browser. */
  thumbnailPng?: string;
  modelName?: string;
}

const F = (v: number) => (Math.round(v * 1000) / 1000).toFixed(3).replace(/\.?0+$/, '') || '0';
const F5 = (v: number) => v.toFixed(5).replace(/\.?0+$/, '') || '0';

class GrowableF32 {
  buf = new Float32Array(1 << 16);
  len = 0;
  push6(a: number, b: number, c: number, d: number, e: number, f: number) {
    if (this.len + 6 > this.buf.length) {
      const n = new Float32Array(this.buf.length * 2);
      n.set(this.buf);
      this.buf = n;
    }
    const B = this.buf, L = this.len;
    B[L] = a; B[L + 1] = b; B[L + 2] = c; B[L + 3] = d; B[L + 4] = e; B[L + 5] = f;
    this.len += 6;
  }
  done() { return this.buf.slice(0, this.len); }
}
class GrowableU8 {
  buf = new Uint8Array(1 << 14);
  len = 0;
  push(v: number) {
    if (this.len >= this.buf.length) { const n = new Uint8Array(this.buf.length * 2); n.set(this.buf); this.buf = n; }
    this.buf[this.len++] = v;
  }
  done() { return this.buf.slice(0, this.len); }
}

/** Trapezoidal move-time estimate with junction slow-down (mm, mm/s, mm/s²). */
export function pathTime(pts: number[], speed: number, accel: number, cornerVel = 5): number {
  const n = pts.length / 2;
  if (n < 2) return 0;
  const segLen: number[] = [];
  for (let i = 0; i < n - 1; i++) segLen.push(Math.hypot(pts[i * 2 + 2] - pts[i * 2], pts[i * 2 + 3] - pts[i * 2 + 1]));
  // Junction limits between consecutive segments
  const vj: number[] = new Array(segLen.length + 1).fill(0);
  for (let i = 1; i < segLen.length; i++) {
    const ax = pts[i * 2] - pts[i * 2 - 2], ay = pts[i * 2 + 1] - pts[i * 2 - 1];
    const bx = pts[i * 2 + 2] - pts[i * 2], by = pts[i * 2 + 3] - pts[i * 2 + 1];
    const la = segLen[i - 1] || 1e-9, lb = segLen[i] || 1e-9;
    const cos = Math.max(-1, Math.min(1, (ax * bx + ay * by) / (la * lb)));
    // Klipper-style: v² = a·R, R from junction deviation and turn angle
    const sinHalf = Math.sqrt(0.5 * (1 - cos));
    const jd = (cornerVel * cornerVel * (Math.SQRT2 - 1)) / accel;
    const R = sinHalf >= 0.999999 ? Infinity : (jd * sinHalf) / (1 - sinHalf);
    vj[i] = Math.min(speed, Math.sqrt(accel * R));
  }
  // forward / backward passes
  const vStart: number[] = new Array(segLen.length).fill(0);
  const vEnd: number[] = new Array(segLen.length).fill(0);
  for (let i = 0; i < segLen.length; i++) {
    const prev = i === 0 ? 0 : vEnd[i - 1];
    vStart[i] = Math.min(vj[i], prev);
    vEnd[i] = Math.min(vj[i + 1], Math.sqrt(vStart[i] ** 2 + 2 * accel * segLen[i]));
  }
  for (let i = segLen.length - 1; i >= 0; i--) {
    const next = i === segLen.length - 1 ? 0 : vStart[i + 1];
    vEnd[i] = Math.min(vEnd[i], next);
    vStart[i] = Math.min(vStart[i], Math.sqrt(vEnd[i] ** 2 + 2 * accel * segLen[i]));
  }
  let t = 0;
  for (let i = 0; i < segLen.length; i++) {
    const d = segLen[i], v0 = vStart[i], v1 = vEnd[i];
    // distance needed to reach cruise from v0 and back to v1
    const dAcc = Math.max(0, (speed * speed - v0 * v0) / (2 * accel));
    const dDec = Math.max(0, (speed * speed - v1 * v1) / (2 * accel));
    if (dAcc + dDec <= d) {
      t += (speed - v0) / accel + (speed - v1) / accel + (d - dAcc - dDec) / speed;
    } else {
      // triangular profile: peak speed vp
      const vp = Math.sqrt(Math.max(v0 * v0, (2 * accel * d + v0 * v0 + v1 * v1) / 2));
      t += Math.max(0, vp - v0) / accel + Math.max(0, vp - v1) / accel;
      if (vp <= v0 && vp <= v1) t += d / Math.max(vp, 1e-3);
    }
  }
  return t;
}

export function generateGcode(layers: LayerPlan[], s: SliceSettings, opts: GcodeOptions = {}): GcodeResult {
  const out: string[] = [];
  const seg = new GrowableF32();
  const types = new GrowableU8();
  const layerOffsets = new Uint32Array(layers.length + 1);
  const typeIndex = new Map<PathType, number>(PATH_TYPES.map((t, i) => [t, i]));

  const filamentArea = Math.PI * (s.filamentDiameter / 2) ** 2;
  const extrusionPerMm = (width: number, height: number, flow = 1) => {
    // Rounded-rectangle cross-section (Slic3r/Orca)
    const a = height * (width - height) + Math.PI * (height / 2) ** 2;
    return (a / filamentArea) * s.flowRatio * flow;
  };

  const speedFor = (p: PrintPath, layer: number): number => {
    let v: number;
    if (layer === 0) {
      v = isInfill(p.type) ? s.speedFirstLayerInfill : s.speedFirstLayer;
      if (p.type === 'skirt' || p.type === 'brim') v = s.speedFirstLayer;
    } else {
      switch (p.type) {
        case 'outer-wall': v = s.speedOuterWall; break;
        case 'inner-wall': v = s.speedInnerWall; break;
        case 'sparse-infill': v = s.speedSparseInfill; break;
        case 'solid-infill': v = s.speedSolidInfill; break;
        case 'top-surface': v = s.speedTopSurface; break;
        case 'bottom-surface': v = s.speedSolidInfill; break;
        case 'bridge': v = s.speedBridge; break;
        case 'support': v = s.speedSupport; break;
        case 'support-interface': v = s.speedSupportInterface; break;
        default: v = s.speedFirstLayer;
      }
    }
    return Math.min(v, s.maxSpeedXY);
  };
  const accelFor = (p: PrintPath, layer: number): number => {
    if (layer === 0) return s.accelFirstLayer;
    switch (p.type) {
      case 'outer-wall': return s.accelOuterWall;
      case 'inner-wall': return s.accelInnerWall;
      case 'top-surface': return s.accelTopSurface;
      case 'sparse-infill': case 'solid-infill': case 'bottom-surface': case 'bridge': return s.accelInfill;
      default: return s.accelDefault;
    }
  };

  /** Retract on this travel? Infill-to-infill hops shorter than ~2.5 line spacings skip retraction. */
  const needsRetract = (d: number, p: PrintPath, lastType: PathType | null): boolean => {
    if (d <= s.retractMinTravel) return false;
    if (isInfill(p.type) && lastType !== null && isInfill(lastType)) {
      const spacing = p.width / Math.max(0.05, s.infillDensity / 100);
      if (d < Math.max(s.retractMinTravel, spacing * 2.5)) return false;
    }
    return true;
  };
  const retractTime = () => {
    if (s.retractionLength <= 0) return 0;
    let t = s.retractionLength / s.retractionSpeed + s.retractionLength / s.deretractionSpeed;
    if (s.zHopEnabled && s.zHop > 0) t += (2 * s.zHop) / s.zSpeed;
    return t;
  };

  // ---- Pass 1: per-layer time to derive fan & slow-down ----
  // Uses exactly the same speed rules as the emission pass so M73 stays consistent.
  const layerTimeWith = (layer: LayerPlan, factor: number): number => {
    let t = 0;
    let px = 0, py = 0, first = true;
    let lastType: PathType | null = null;
    for (const p of layer.paths) {
      const pts = p.closed ? [...p.pts, p.pts[0], p.pts[1]] : p.pts;
      if (!first) {
        const d = Math.hypot(pts[0] - px, pts[1] - py);
        t += pathTime([px, py, pts[0], pts[1]], s.travelSpeed, s.travelAcceleration, cornerVel);
        if (needsRetract(d, p, lastType)) t += retractTime();
      }
      first = false;
      lastType = p.type;
      let v = capVolumetric(speedFor(p, layer.index), p.width, layer.height, s.maxVolumetricSpeed);
      v = Math.max(s.minSpeed, v * factor);
      t += pathTime(pts, v, accelFor(p, layer.index), cornerVel);
      const n = pts.length;
      px = pts[n - 2]; py = pts[n - 1];
    }
    return t + layer.height / s.zSpeed + 0.2;
  };
  const layerTimes: number[] = [];
  const layerFactors: number[] = [];
  const cornerVel = 5;
  for (const layer of layers) {
    let t = layerTimeWith(layer, 1);
    let factor = 1;
    if (s.minLayerTime > 0 && t < s.minLayerTime && t > 0) {
      factor = t / s.minLayerTime;
      t = layerTimeWith(layer, factor);
    }
    layerFactors.push(factor);
    layerTimes.push(t);
  }

  // ---- Emit ----
  const totalLayers = layers.length;
  const maxZ = layers.length ? layers[layers.length - 1].z : 0;
  const name = opts.modelName || 'model';
  const vars = placeholderVars(s, maxZ);

  // Filament totals are filled in after emission; header placeholders are replaced at the end.
  out.push('; HEADER_BLOCK_START');
  out.push(`; ${SLICER_NAME} ${SLICER_VERSION} (OrcaSlicer-compatible output for Flashforge Adventurer 5M)`);
  out.push(`; generated by ${SLICER_NAME} ${SLICER_VERSION} on ${new Date().toISOString()}`);
  out.push('; model printing time: {PRINT_TIME}; total estimated time: {PRINT_TIME}');
  out.push(`; total layer number: ${totalLayers}`);
  out.push('; total filament length [mm] : {FIL_MM}');
  out.push('; total filament volume [cm^3] : {FIL_CM3}');
  out.push('; total filament weight [g] : {FIL_G}');
  out.push(`; filament_density: ${s.filamentDensity}`);
  out.push(`; filament_diameter: ${s.filamentDiameter}`);
  out.push(`; max_z_height: ${F(maxZ)}`);
  out.push(`; model name: ${name}`);
  out.push('; HEADER_BLOCK_END');
  out.push('');
  if (opts.thumbnailPng) {
    out.push('; THUMBNAIL_BLOCK_START');
    out.push(`; thumbnail begin ${s.thumbnailWidth}x${s.thumbnailHeight} ${opts.thumbnailPng.length}`);
    for (let i = 0; i < opts.thumbnailPng.length; i += 78) out.push('; ' + opts.thumbnailPng.slice(i, i + 78));
    out.push('; thumbnail end');
    out.push('; THUMBNAIL_BLOCK_END');
    out.push('');
  }
  out.push('; EXECUTABLE_BLOCK_START');
  out.push('M73 P0 R{REMAINING_MIN}');
  out.push(`; filament: ${s.filamentName} (${s.filamentType})`);
  out.push(`; process: ${s.processName}`);
  out.push(`; printer: ${s.machineName}`);
  out.push(';TYPE:Custom');
  out.push(substitute(s.startGcode, vars));
  if (s.filamentStartGcode) out.push(substitute(s.filamentStartGcode, vars).trimEnd());
  if (s.enablePressureAdvance && s.pressureAdvance > 0) out.push(`SET_PRESSURE_ADVANCE ADVANCE=${s.pressureAdvance}`);
  out.push('M107 ; fan off');
  out.push('G90 ; absolute XYZ');
  out.push('M83 ; relative E');
  out.push('G92 E0');

  let x = NaN, y = NaN, z = 0;
  let retracted = false;
  let lifted = false;
  let curF = -1;
  let curAccel = -1;
  let curFan = -1;
  let totalE = 0;
  let totalTime = 0;
  const adjustedLayerTimes: number[] = layerTimes.slice();
  const totalEstimated = adjustedLayerTimes.reduce((a, b) => a + b, 0);

  const setF = (mmPerSec: number) => {
    const f = Math.round(mmPerSec * 60);
    if (f !== curF) { curF = f; return ` F${f}`; }
    return '';
  };
  const setAccel = (a: number) => {
    if (!s.emitAccelerations) return;
    const v = Math.round(a);
    if (v !== curAccel) { curAccel = v; out.push(`M204 S${v}`); }
  };
  const retract = () => {
    if (retracted || s.retractionLength <= 0) return;
    out.push(`G1 E-${F(s.retractionLength)} F${Math.round(s.retractionSpeed * 60)}`);
    curF = Math.round(s.retractionSpeed * 60);
    retracted = true;
  };
  const unretract = () => {
    if (!retracted) return;
    out.push(`G1 E${F(s.retractionLength)} F${Math.round(s.deretractionSpeed * 60)}`);
    curF = Math.round(s.deretractionSpeed * 60);
    retracted = false;
  };
  const lift = (layerZ: number) => {
    if (lifted || !s.zHopEnabled || s.zHop <= 0) return;
    out.push(`G1 Z${F(layerZ + s.zHop)} F${Math.round(s.zSpeed * 60)}`);
    curF = Math.round(s.zSpeed * 60);
    lifted = true;
  };
  const unlift = (layerZ: number) => {
    if (!lifted) return;
    out.push(`G1 Z${F(layerZ)} F${Math.round(s.zSpeed * 60)}`);
    curF = Math.round(s.zSpeed * 60);
    lifted = false;
  };

  for (const layer of layers) {
    const li = layer.index;
    layerOffsets[li] = types.len;
    const factor = layerFactors[li];
    out.push(';LAYER_CHANGE');
    out.push(`;Z:${F(layer.z)}`);
    out.push(`;HEIGHT:${F(layer.height)}`);
    out.push(`;LAYER:${li}`);
    out.push(substitute(s.beforeLayerChangeGcode, { ...vars, layer_z: F(layer.z), layer_num: String(li) }));
    if (li > 0 && s.retractOnLayerChange) retract();
    z = layer.z;
    // Move to the new layer (with z-hop if enabled); the first travel of the layer un-lifts.
    const hop = s.zHopEnabled && s.zHop > 0 && li > 0 ? s.zHop : 0;
    out.push(`G1 Z${F(z + hop)} F${Math.round(s.zSpeed * 60)}`);
    curF = Math.round(s.zSpeed * 60);
    lifted = hop > 0;
    out.push(substitute(s.afterLayerChangeGcode, { ...vars, layer_z: F(layer.z), layer_num: String(li) }));

    // Temperatures after first layer
    if (li === 1) {
      if (s.nozzleTemp !== s.nozzleTempFirstLayer) out.push(`M104 S${s.nozzleTemp}`);
      if (s.bedTemp !== s.bedTempFirstLayer) out.push(`M140 S${s.bedTemp}`);
    }
    // Fan
    let fan = 0;
    if (li >= s.fanOffLayers) {
      const t = adjustedLayerTimes[li];
      if (t <= s.fanFullLayerTime || s.fanMin === s.fanMax) fan = s.fanMax;
      else fan = s.fanMin + (s.fanMax - s.fanMin) * Math.min(1, s.fanFullLayerTime / Math.max(t, 1e-3));
    }
    const fanVal = Math.round((fan / 100) * 255);
    if (fanVal !== curFan) { out.push(fanVal === 0 ? 'M107' : `M106 S${fanVal}`); curFan = fanVal; }

    // Progress
    const pct = Math.min(99, Math.floor((totalTime / Math.max(1e-6, totalEstimated)) * 100));
    out.push(`M73 P${pct} R${Math.max(0, Math.round((totalEstimated - totalTime) / 60))}`);

    let lastType: PathType | null = null;
    let lastWidth = -1;
    let layerTime = 0;
    for (const p of layer.paths) {
      const pts = p.pts;
      const n = pts.length / 2;
      if (n < 2) continue;
      const sx = pts[0], sy = pts[1];
      // Travel
      if (!isNaN(x)) {
        const d = Math.hypot(sx - x, sy - y);
        if (d > 1e-6) {
          const needRetract = needsRetract(d, p, lastType);
          if (needRetract) { retract(); lift(z); layerTime += retractTime(); }
          // Only switch to travel acceleration for travels long enough to matter.
          if (d > 5) setAccel(s.travelAcceleration);
          out.push(`G1 X${F(sx)} Y${F(sy)}${setF(s.travelSpeed)}`);
          layerTime += pathTime([x, y, sx, sy], s.travelSpeed, s.travelAcceleration, cornerVel);
          seg.push6(x, y, z + (lifted ? s.zHop : 0), sx, sy, z + (lifted ? s.zHop : 0));
          types.push(typeIndex.get('travel')!);
        }
      } else {
        setAccel(s.travelAcceleration);
        out.push(`G1 X${F(sx)} Y${F(sy)}${setF(s.travelSpeed)}`);
      }
      unlift(z);
      unretract();
      if (p.type !== lastType) { out.push(`;TYPE:${PATH_TYPE_LABEL[p.type]}`); lastType = p.type; }
      if (p.width !== lastWidth) { out.push(`;WIDTH:${F(p.width)}`); lastWidth = p.width; }
      const flow = p.type === 'bridge' ? 1.0 : 1.0;
      const ePerMm = extrusionPerMm(p.width, layer.height, flow);
      let v = capVolumetric(speedFor(p, li), p.width, layer.height, s.maxVolumetricSpeed);
      v = Math.max(s.minSpeed, v * factor);
      setAccel(accelFor(p, li));
      const fStr = setF(v);
      let px = sx, py = sy;
      x = sx; y = sy;
      const count = p.closed ? n + 1 : n;
      let firstMove = true;
      for (let i = 1; i < count; i++) {
        const idx = (i % n) * 2;
        const nx = pts[idx], ny = pts[idx + 1];
        const d = Math.hypot(nx - px, ny - py);
        if (d < 1e-6) continue;
        const e = d * ePerMm;
        totalE += e;
        out.push(`G1 X${F(nx)} Y${F(ny)} E${F5(e)}${firstMove ? fStr : ''}`);
        firstMove = false;
        seg.push6(px, py, z, nx, ny, z);
        types.push(typeIndex.get(p.type)!);
        px = nx; py = ny;
      }
      if (firstMove && fStr) { /* zero-length path: nothing emitted */ }
      x = px; y = py;
      const pathPts = p.closed ? [...pts, pts[0], pts[1]] : pts;
      layerTime += pathTime(pathPts, v, accelFor(p, li), cornerVel);
    }
    layerTime += layer.height / s.zSpeed + 0.2;
    totalTime += layerTime;
    adjustedLayerTimes[li] = layerTime;
  }
  layerOffsets[totalLayers] = types.len;

  out.push(';TYPE:Custom');
  out.push('M73 P100 R0');
  retract();
  out.push(substitute(s.endGcode, { ...vars, max_layer_z: F(maxZ) }));
  out.push('M107');
  out.push('; EXECUTABLE_BLOCK_END');
  out.push('');

  const filamentMm = totalE;
  const filamentCm3 = (filamentMm * filamentArea) / 1000;
  const filamentG = filamentCm3 * s.filamentDensity;
  const stats: GcodeStats = {
    printTimeSec: totalTime,
    filamentMm,
    filamentCm3,
    filamentG,
    layerCount: totalLayers,
    maxZ,
    layerTimes: adjustedLayerTimes,
  };

  out.push('; CONFIG_BLOCK_START');
  out.push(`; estimated printing time (normal mode) = ${formatDuration(totalTime)}`);
  out.push(`; filament used [mm] = ${F(filamentMm)}`);
  out.push(`; filament used [cm3] = ${F(filamentCm3)}`);
  out.push(`; filament used [g] = ${F(filamentG)}`);
  for (const [k, v] of Object.entries(s)) {
    if (typeof v === 'string' && v.includes('\n')) out.push(`; ${camelToSnake(k)} = ${JSON.stringify(v)}`);
    else out.push(`; ${camelToSnake(k)} = ${v}`);
  }
  out.push('; CONFIG_BLOCK_END');

  let gcode = out.join('\n') + '\n';
  gcode = gcode
    .replace(/\{PRINT_TIME\}/g, formatDuration(totalTime))
    .replace(/\{FIL_MM\}/g, F(filamentMm))
    .replace(/\{FIL_CM3\}/g, F(filamentCm3))
    .replace(/\{FIL_G\}/g, F(filamentG))
    .replace(/\{REMAINING_MIN\}/g, String(Math.round(totalEstimated / 60)));

  return {
    gcode,
    stats,
    preview: { segments: seg.done(), types: types.done(), layerOffsets },
  };
}

function isInfill(t: PathType): boolean {
  return t === 'sparse-infill' || t === 'solid-infill' || t === 'top-surface' || t === 'bottom-surface' || t === 'bridge' || t === 'support' || t === 'support-interface';
}

function capVolumetric(speed: number, width: number, height: number, maxVol: number): number {
  if (maxVol <= 0) return speed;
  const area = height * (width - height) + Math.PI * (height / 2) ** 2;
  return Math.min(speed, maxVol / area);
}

export function formatDuration(sec: number): string {
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function camelToSnake(k: string): string {
  return k.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase());
}

function placeholderVars(s: SliceSettings, maxZ: number): Record<string, string> {
  return {
    bed_temperature_initial_layer_single: String(s.bedTempFirstLayer),
    bed_temperature_initial_layer: String(s.bedTempFirstLayer),
    first_layer_bed_temperature: String(s.bedTempFirstLayer),
    bed_temperature: String(s.bedTemp),
    nozzle_temperature_initial_layer: String(s.nozzleTempFirstLayer),
    first_layer_temperature: String(s.nozzleTempFirstLayer),
    nozzle_temperature: String(s.nozzleTemp),
    temperature: String(s.nozzleTemp),
    max_layer_z: F(maxZ),
    printable_height: String(s.maxZ),
    travel_speed: String(s.travelSpeed),
    layer_height: String(s.layerHeight),
    initial_layer_print_height: String(s.firstLayerHeight),
    nozzle_diameter: String(s.nozzleDiameter),
    filament_type: s.filamentType,
  };
}

/** Replace [key] and {key} placeholders (Orca/PrusaSlicer style, simple variables only). */
export function substitute(template: string, vars: Record<string, string>): string {
  if (!template) return '';
  return template
    .replace(/\[([a-z_0-9]+)\]/gi, (m, k) => (k in vars ? vars[k] : m))
    .replace(/\{([a-z_0-9]+)\}/gi, (m, k) => (k in vars ? vars[k] : m))
    .replace(/\r\n/g, '\n');
}
