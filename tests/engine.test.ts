import { describe, it, expect } from 'vitest';
import { planLayers } from '../src/slicer/engine';
import { generateGcode, pathTime, substitute } from '../src/slicer/gcode';
import { DEFAULT_SETTINGS, type SliceSettings } from '../src/slicer/settings';
import { boxMesh, tubeMesh } from './fixtures';
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
    const sup = planLayers(positions, settings({ supportEnabled: true }));
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
    const t = pathTime([0, 0, 1, 0], 100, 10000);
    expect(t).toBeCloseTo(2 * Math.sqrt(1 / 10000), 3);
  });
  it('substitute replaces both bracket styles', () => {
    expect(substitute('M104 S[temperature] ; {layer_z} [unknown]', { temperature: '210', layer_z: '0.2' })).toBe('M104 S210 ; 0.2 [unknown]');
  });
  it('default settings are complete', () => {
    expect(Object.keys(DEFAULT_SETTINGS).length).toBeGreaterThan(80);
  });
});
