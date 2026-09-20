import { describe, it, expect } from 'vitest';
import { planLayers } from '../src/slicer/engine';
import { generateGcode, pathTime, substitute } from '../src/slicer/gcode';
import { DEFAULT_SETTINGS, type SliceSettings } from '../src/slicer/settings';
import { boxMesh, tubeMesh } from './fixtures';
import { parallelLines, connectLines, dropShortLines } from '../src/slicer/infill';
import { pt } from '../src/slicer/polygons';
import { MACHINES, FILAMENTS, PROCESSES, buildSettings } from '../src/profiles';

const settings = (o: Partial<SliceSettings> = {}): SliceSettings =>
  buildSettings(MACHINES[0], FILAMENTS[0], PROCESSES.find((p) => p.id === '0.20-standard-0.4')!, o);

describe('planLayers', () => {
  it('creates walls, bottom, top and sparse infill for a cube', () => {
    const cube = boxMesh(20, 20, 10);
    const { layers } = planLayers(cube.positions, settings());
    expect(layers.length).toBe(50);
    const types = (i: number) => new Set(layers[i].paths.map((p) => p.type));
    expect(types(0).has('outer-wall')).toBe(true);
    expect(types(0).has('inner-wall')).toBe(true);
    expect(types(0).has('bottom-surface')).toBe(true);
    expect(types(0).has('sparse-infill')).toBe(false);
    expect(types(25).has('sparse-infill')).toBe(true);
    expect(types(25).has('solid-infill')).toBe(false);
    expect(types(25).has('top-surface')).toBe(false);
    expect(types(49).has('top-surface')).toBe(true);
    expect(types(46).has('solid-infill')).toBe(true); // inside the 5 top layers
    expect(types(3).has('bridge')).toBe(false);
  });
  it('orders inner walls before the outer wall by default', () => {
    const cube = boxMesh(20, 20, 4);
    const { layers } = planLayers(cube.positions, settings());
    const walls = layers[5].paths.filter((p) => p.type.endsWith('wall')).map((p) => p.type);
    expect(walls[0]).toBe('inner-wall');
    expect(walls[walls.length - 1]).toBe('outer-wall');
  });
  it('keeps every path inside the printable area for a centred cube', () => {
    const cube = boxMesh(20, 20, 2);
    const { layers } = planLayers(cube.positions, settings());
    for (const l of layers) for (const p of l.paths) for (let i = 0; i < p.pts.length; i += 2) {
      expect(Math.abs(p.pts[i])).toBeLessThanOrEqual(10.01);
      expect(Math.abs(p.pts[i + 1])).toBeLessThanOrEqual(10.01);
    }
  });
  it('generates skirt and brim when enabled', () => {
    const cube = boxMesh(10, 10, 1);
    const { layers } = planLayers(cube.positions, settings({ skirtLoops: 2, brimType: 'outer', brimWidth: 3 }));
    const t0 = layers[0].paths.map((p) => p.type);
    expect(t0.filter((t) => t === 'skirt').length).toBe(2);
    expect(t0.filter((t) => t === 'brim').length).toBeGreaterThanOrEqual(6);
    // adhesion prints first
    expect(t0[0] === 'brim' || t0[0] === 'skirt').toBe(true);
  });
  it('handles holes: tube has walls on both contours', () => {
    const tube = tubeMesh(20, 10, 2);
    const { layers } = planLayers(tube.positions, settings());
    const outerWalls = layers[3].paths.filter((p) => p.type === 'outer-wall');
    expect(outerWalls.length).toBe(2);
  });
  it('generates supports under an overhang', () => {
    // A 20x20 slab floating 5mm above the bed on a 4x4 pillar
    const pillar = boxMesh(4, 4, 5);
    const slab = boxMesh(20, 20, 2, 0, 0, 5);
    const positions = new Float32Array(pillar.positions.length + slab.positions.length);
    positions.set(pillar.positions);
    positions.set(slab.positions, pillar.positions.length);
    const noSup = planLayers(positions, settings({ supportEnabled: false }));
    expect(noSup.layers.some((l) => l.paths.some((p) => p.type === 'support'))).toBe(false);
    const sup = planLayers(positions, settings({ supportEnabled: true, supportType: 'normal' }));
    const supportLayers = sup.layers.filter((l) => l.paths.some((p) => p.type === 'support'));
    expect(supportLayers.length).toBeGreaterThan(15);
    expect(supportLayers[0].index).toBe(0);
    expect(sup.layers.some((l) => l.paths.some((p) => p.type === 'support-interface'))).toBe(true);
    // support must stay outside the pillar footprint (xy gap)
    for (const p of sup.layers[5].paths.filter((p) => p.type === 'support')) {
      for (let i = 0; i < p.pts.length; i += 2) {
        const inside = Math.abs(p.pts[i]) < 2.29 && Math.abs(p.pts[i + 1]) < 2.29;
        expect(inside).toBe(false);
      }
    }
    // the layer directly under the slab is bridge over support
    const under = sup.layers.find((l) => Math.abs(l.z - 5.2) < 1e-6)!;
    expect(under.paths.some((p) => p.type === 'bridge')).toBe(true);
  });
});

describe('tree supports', () => {
  const pillar = boxMesh(4, 4, 5);
  const slab = boxMesh(20, 20, 2, 0, 0, 5);
  const positions = new Float32Array(pillar.positions.length + slab.positions.length);
  positions.set(pillar.positions);
  positions.set(slab.positions, pillar.positions.length);
  const { layers } = planLayers(positions, settings({ supportEnabled: true, supportType: 'tree' }));
  const has = (i: number, t: string) => layers[i].paths.some((p) => p.type === t);

  it('grows branches from the bed up to just below the roof', () => {
    expect(has(0, 'support')).toBe(true);
    expect(has(10, 'support')).toBe(true);
    expect(has(21, 'support')).toBe(true);
    // slab starts at layer 25 (z 5.2): roof occupies the 3 layers below the z gap
    expect(has(24, 'support-interface')).toBe(true);
    expect(has(23, 'support-interface')).toBe(true);
    expect(has(22, 'support-interface')).toBe(true);
    expect(has(26, 'support')).toBe(false);
    expect(has(30, 'support-interface')).toBe(false);
  });
  it('keeps branches away from the model by the XY gap', () => {
    for (const i of [2, 10, 20]) {
      for (const p of layers[i].paths.filter((p) => p.type === 'support')) {
        for (let k = 0; k < p.pts.length; k += 2) {
          const inside = Math.abs(p.pts[k]) < 2.29 && Math.abs(p.pts[k + 1]) < 2.29;
          expect(inside).toBe(false);
        }
      }
    }
  });
  it('stays under the overhang footprint', () => {
    for (const p of layers[5].paths.filter((p) => p.type === 'support')) {
      for (let k = 0; k < p.pts.length; k += 2) {
        expect(Math.abs(p.pts[k])).toBeLessThan(11.5);
        expect(Math.abs(p.pts[k + 1])).toBeLessThan(11.5);
      }
    }
  });
  it('merges tips into fewer, thicker branches lower down', () => {
    const loops = (i: number) => layers[i].paths.filter((p) => p.type === 'support' && p.closed).length;
    expect(loops(21)).toBeGreaterThan(loops(2));
  });
});

describe('generateGcode', () => {
  const cube = boxMesh(20, 20, 4);
  const s = settings();
  const { layers } = planLayers(cube.positions, s);
  const res = generateGcode(layers, s, { thumbnailPng: 'iVBORw0KGgo=', modelName: 'cube' });
  const g = res.gcode;

  it('contains the Flashforge start/end gcode with temperatures substituted', () => {
    expect(g).toContain('M190 S55');
    expect(g).toContain('M109 S220');
    expect(g).toContain('G1 X110 Y-110 F6000');
    expect(g).toContain('G0 X50 Y50 F30000');
    const exec = g.slice(g.indexOf('; EXECUTABLE_BLOCK_START'), g.indexOf('; EXECUTABLE_BLOCK_END'));
    expect(exec).not.toMatch(/\[(bed|nozzle)_temperature[a-z_]*\]/);
  });
  it('has Orca-style header, thumbnail and config blocks', () => {
    expect(g).toContain('; HEADER_BLOCK_START');
    expect(g).toContain('; total layer number: 20');
    expect(g).toContain('; thumbnail begin 140x110');
    expect(g).toContain('; THUMBNAIL_BLOCK_END');
    expect(g).toContain('; EXECUTABLE_BLOCK_START');
    expect(g).toContain('; CONFIG_BLOCK_START');
    expect(g).toContain('; estimated printing time (normal mode) = ');
    expect(g).toMatch(/; total filament length \[mm\] : \d/);
  });
  it('uses relative extrusion with reasonable totals', () => {
    expect(g).toContain('M83');
    // 20x20x4 solid cube ≈ 1600 mm³ of plastic, minus infill sparsity. Filament ≈ vol / 2.405 mm².
    expect(res.stats.filamentMm).toBeGreaterThan(200);
    expect(res.stats.filamentMm).toBeLessThan(800);
    expect(res.stats.filamentG).toBeGreaterThan(0.5);
    expect(res.stats.printTimeSec).toBeGreaterThan(30);
    expect(res.stats.printTimeSec).toBeLessThan(1800);
  });
  it('emits layer markers, types, progress and fan commands', () => {
    expect((g.match(/;LAYER_CHANGE/g) || []).length).toBe(20);
    expect(g).toContain(';TYPE:Outer wall');
    expect(g).toContain(';TYPE:Sparse infill');
    expect(g).toContain('M73 P0 R');
    expect(g).toContain('M73 P100 R0');
    expect(g).toContain('M106 S255');
    expect(g).toContain('SET_PRESSURE_ADVANCE ADVANCE=0.025');
  });
  it('never extrudes outside the bed and never moves below the layer', () => {
    let z = 0;
    for (const line of g.split('\n')) {
      if (!line.startsWith('G1')) continue;
      const m = /X(-?[\d.]+)/.exec(line);
      const my = /Y(-?[\d.]+)/.exec(line);
      const mz = /Z(-?[\d.]+)/.exec(line);
      if (mz) z = parseFloat(mz[1]);
      if (m && Math.abs(parseFloat(m[1])) > 110.01 && !line.includes('F30000')) throw new Error('X out of bed: ' + line);
      if (my && Math.abs(parseFloat(my[1])) > 110.01) throw new Error('Y out of bed: ' + line);
      if (line.includes(' E') && !line.startsWith('G1 E') && z < 0.19 && /X/.test(line) && !/Y-110|Y-109.6/.test(line)) throw new Error('extrusion below first layer: ' + line);
    }
  });
  it('keeps the preview consistent with the layers', () => {
    expect(res.preview.layerOffsets.length).toBe(21);
    expect(res.preview.types.length).toBe(res.preview.segments.length / 6);
    expect(res.preview.layerOffsets[20]).toBe(res.preview.types.length);
  });
  it('retracts before long travels and z-hops', () => {
    expect(g).toContain('G1 E-0.8 F2100');
    expect(g).toContain('G1 E0.8 F2100');
    expect(g).toMatch(/G1 Z0\.6 F1200/); // 0.2 + 0.4 hop
  });
});

describe('helpers', () => {
  it('pathTime is distance/speed for long straight moves plus accel', () => {
    const t = pathTime([0, 0, 100, 0], 100, 10000);
    // 0.5mm accelerating + 99mm cruise + 0.5mm decelerating
    expect(t).toBeCloseTo(0.01 + 0.99 + 0.01, 3);
  });
  it('pathTime handles triangular profiles', () => {
    const t = pathTime([0, 0, 1, 0], 100, 10000, 5, 0);
    expect(t).toBeCloseTo(2 * Math.sqrt(1 / 10000), 3);
    // Klipper's minimum_cruise_ratio caps the peak of very short moves, so it is a little slower.
    expect(pathTime([0, 0, 1, 0], 100, 10000)).toBeGreaterThan(t);
  });
  it('pathTime does not slow down at collinear vertices', () => {
    const single = pathTime([0, 0, 100, 0], 200, 5000);
    const pts: number[] = [];
    for (let i = 0; i <= 200; i++) pts.push(i * 0.5, 0);
    expect(pathTime(pts, 200, 5000)).toBeCloseTo(single, 3);
  });
  it('pathTime slows for sharp corners and reversals', () => {
    const straight = pathTime([0, 0, 50, 0, 100, 0], 200, 5000);
    const corner = pathTime([0, 0, 50, 0, 50, 50], 200, 5000);
    const reversal = pathTime([0, 0, 50, 0, 0, 0], 200, 5000);
    expect(corner).toBeGreaterThan(straight);
    expect(reversal).toBeGreaterThan(corner);
    // a full reversal is two moves from rest to rest
    expect(reversal).toBeCloseTo(2 * pathTime([0, 0, 50, 0], 200, 5000), 3);
  });
  it('pathTime keeps a finely tessellated arc close to its ideal speed', () => {
    const pts: number[] = [];
    const r = 20;
    for (let i = 0; i <= 720; i++) { const a = (i / 720) * Math.PI * 2; pts.push(r * Math.cos(a), r * Math.sin(a)); }
    const t = pathTime(pts, 200, 5000);
    const ideal = (2 * Math.PI * r) / 200;
    expect(t).toBeLessThan(ideal * 1.5);
  });
  it('substitute replaces both bracket styles', () => {
    expect(substitute('M104 S[temperature] ; {layer_z} [unknown]', { temperature: '210', layer_z: '0.2' })).toBe('M104 S210 ; 0.2 [unknown]');
  });
  it('default settings are complete', () => {
    expect(Object.keys(DEFAULT_SETTINGS).length).toBeGreaterThan(80);
  });
});

describe('infill connection', () => {
  const rect = (x0: number, y0: number, x1: number, y1: number) => [pt(x0, y0), pt(x1, y0), pt(x1, y1), pt(x0, y1)];

  it('joins scan lines into zigzag runs inside a region', () => {
    const region = [rect(0, 0, 20, 20)];
    const lines = parallelLines(region, 1, 0);
    const runs = connectLines(lines, region, 3);
    expect(lines.length).toBeGreaterThan(15);
    expect(runs.length).toBe(1); // one continuous zigzag
    const pts = runs[0].length;
    expect(pts).toBe(lines.reduce((a, l) => a + l.length, 0));
  });

  it('does not connect across a hole or outside the region', () => {
    // Two separate squares: lines of one must never link to the other.
    const region = [rect(0, 0, 10, 20), rect(30, 0, 40, 20)];
    const runs = connectLines(parallelLines(region, 1, 0), region, 100);
    expect(runs.length).toBeGreaterThan(1);
    for (const r of runs) {
      const xs = r.map((p) => p.X / 1000);
      // no run may span the empty gap between the squares
      expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(25);
    }
  });

  it('drops stubs that cost more to reach than they lay down', () => {
    const keep = [pt(0, 0), pt(10, 0)];
    const stub = [pt(0, 5), pt(0.2, 5)];
    expect(dropShortLines([keep, stub], 1)).toEqual([keep]);
  });

  it('never extrudes across the hole of a tube', () => {
    // Connecting infill lines must not bridge a void: sample every extrusion
    // segment of a square tube and check none passes through its 10mm hole.
    const tube = tubeMesh(30, 12, 3);
    const { layers } = planLayers(tube.positions, settings());
    const half = 12 / 2 - 0.6; // inside the hole, clear of the wall
    let inHole = 0;
    for (const l of layers.slice(1)) for (const p of l.paths) {
      const pts = p.closed ? [...p.pts, p.pts[0], p.pts[1]] : p.pts;
      for (let i = 2; i < pts.length; i += 2) {
        for (const t of [0.25, 0.5, 0.75]) {
          const x = pts[i - 2] + (pts[i] - pts[i - 2]) * t;
          const y = pts[i - 1] + (pts[i + 1] - pts[i - 1]) * t;
          if (Math.abs(x) < half && Math.abs(y) < half) inHole++;
        }
      }
    }
    expect(inHole).toBe(0);
  });

  it('keeps travel small compared with extrusion for a solid plate', () => {
    const plate = boxMesh(40, 40, 1.2);
    const { layers } = planLayers(plate.positions, settings());
    let ext = 0, travel = 0, px = NaN, py = NaN;
    for (const l of layers) for (const p of l.paths) {
      const pts = p.closed ? [...p.pts, p.pts[0], p.pts[1]] : p.pts;
      if (!isNaN(px)) travel += Math.hypot(pts[0] - px, pts[1] - py);
      for (let i = 2; i < pts.length; i += 2) ext += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
      px = pts[pts.length - 2]; py = pts[pts.length - 1];
    }
    // Before infill lines were connected this ratio was above 1.
    expect(travel / ext).toBeLessThan(0.25);
  });
});
