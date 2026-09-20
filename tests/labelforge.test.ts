import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  defaultLabelForgeConfig, labelForgeConfigured, labelForgeUrl, labelForgeBlocked,
  listTemplates, printLabel, renderLabel, type LabelForgeConfig, type LabelTemplate,
} from '../src/label/labelforge';
import { planSpoolLabel, spoolQrText, spoolTextVariables } from '../src/label/spoolLabel';
import { newSpool, type Spool } from '../src/profiles/spools';

const cfg = (over: Partial<LabelForgeConfig> = {}): LabelForgeConfig => ({
  ...defaultLabelForgeConfig(), host: '192.168.1.20', templateId: 'tpl', ...over,
});

const template = (over: Partial<LabelTemplate> = {}): LabelTemplate => ({
  id: 'tpl', name: 'Spool 29x62', label_size: '29x62',
  variables: ['name', 'temps', 'art'],
  image_variable: 'art',
  image: { variable: 'art', x: 4, y: 4, width: 240, height: 96 },
  ...over,
});

const spool = (over: Partial<Spool> = {}): Spool => ({
  ...newSpool('petg'), id: 'K7M2QX', brand: 'Prusament', colorName: 'Jet Black',
  color: '#1a1a1a', nozzleTemp: 250, bedTemp: 85, netWeightG: 1000, usedG: 260, ...over,
});

afterEach(() => { vi.unstubAllGlobals(); });

describe('addressing LabelForge', () => {
  it('goes through the LAN relay when this server offers one', () => {
    expect(labelForgeUrl(cfg(), 'api/templates', true)).toBe('printer/192.168.1.20:8095/api/templates');
  });

  it('goes straight there when it does not', () => {
    expect(labelForgeUrl(cfg(), '/api/labels/print', false)).toBe('http://192.168.1.20:8095/api/labels/print');
  });

  it('respects a non-default port', () => {
    expect(labelForgeUrl(cfg({ port: 9000 }), 'api/health', true)).toBe('printer/192.168.1.20:9000/api/health');
  });

  it('is not configured until it has a host', () => {
    expect(labelForgeConfigured(defaultLabelForgeConfig())).toBe(false);
    expect(labelForgeConfigured(cfg())).toBe(true);
    expect(labelForgeConfigured(cfg({ host: '  ' }))).toBe(false);
  });
});

describe('what stops a print before it is attempted', () => {
  it('asks for an address when there is none', () => {
    expect(labelForgeBlocked(defaultLabelForgeConfig(), true)).toMatch(/enter the address/i);
  });

  it('explains that the relay needs an IP, not a host name', () => {
    expect(labelForgeBlocked(cfg({ host: 'labelforge.local' }), true)).toMatch(/private LAN addresses/);
  });

  it('is happy with a private address behind the relay', () => {
    expect(labelForgeBlocked(cfg(), true)).toBeNull();
    expect(labelForgeBlocked(cfg({ host: '10.0.0.9' }), true)).toBeNull();
  });

  it('allows a host name when going direct, since LabelForge answers CORS', () => {
    expect(labelForgeBlocked(cfg({ host: 'labelforge.local' }), false)).toBeNull();
  });
});

describe('talking to it', () => {
  it('lists templates', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([template()]), { status: 200 })));
    const list = await listTemplates(cfg(), true);
    expect(list).toHaveLength(1);
    expect(list[0].image_variable).toBe('art');
  });

  it('survives a body that is not the list it promised', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
    expect(await listTemplates(cfg(), true)).toEqual([]);
  });

  it('passes on the reason a print failed instead of just the status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ detail: "Failed to print: [Errno 2] No such file or directory: '/dev/usb/lp0'" }),
      { status: 502 },
    )));
    await expect(printLabel(cfg(), true, { template_id: 'tpl', variables: {} }))
      .rejects.toThrow(/No such file or directory/);
  });

  it('still says something useful when the error body is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<h1>502</h1>', { status: 502 })));
    await expect(printLabel(cfg(), true, { template_id: 'tpl', variables: {} }))
      .rejects.toThrow(/LabelForge returned 502/);
  });

  it('turns a dead connection into an explanation, not a TypeError', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    await expect(renderLabel(cfg(), true, 'tpl', {})).rejects.toThrow(/Could not reach LabelForge at 192\.168\.1\.20:8095/);
  });

  it('defaults to one copy', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response('{"ok":true}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await printLabel(cfg(), true, { template_id: 'tpl', variables: { name: 'x' } });
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      copies: 1, template_id: 'tpl', variables: { name: 'x' },
    });
  });
});

describe('what a spool tells a template', () => {
  it('encodes the bare id when no prefix is set', () => {
    expect(spoolQrText(spool(), '')).toBe('K7M2QX');
  });

  it('encodes a scannable link when one is', () => {
    expect(spoolQrText(spool(), 'http://192.168.1.4:8099/#spool=')).toBe('http://192.168.1.4:8099/#spool=K7M2QX');
  });

  it('fills in every field a label might want', () => {
    const v = spoolTextVariables(spool(), 'K7M2QX');
    expect(v).toMatchObject({
      name: 'Prusament PETG · Jet Black',
      brand: 'Prusament',
      material: 'PETG',
      color: 'Jet Black',
      color_hex: '#1a1a1a',
      nozzle_temp: '250',
      bed_temp: '85',
      temps: '250 / 85 °C',
      weight: '1000 g',
      used: '260 g',
      remaining: '740 g',
      remaining_pct: '74%',
      id: 'K7M2QX',
      link: 'K7M2QX',
    });
  });

  it('leaves weights blank rather than printing "0 g" for an unweighed spool', () => {
    const v = spoolTextVariables(spool({ netWeightG: 0 }), 'X');
    expect(v.weight).toBe('');
    expect(v.remaining).toBe('');
    expect(v.remaining_pct).toBe('');
  });
});

describe('planning a label', () => {
  it('sizes the art to the template\'s own image block', () => {
    const plan = planSpoolLabel(spool(), template(), '');
    expect(plan.imageVariable).toBe('art');
    expect(plan.art).toMatchObject({ width: 240, height: 96, qrText: 'K7M2QX', color: '#1a1a1a' });
    expect(plan.warnings).toEqual([]);
  });

  it('warns about a variable a spool cannot fill, which would print blank', () => {
    const plan = planSpoolLabel(spool(), template({ variables: ['name', 'shelf', 'art'] }), '');
    expect(plan.warnings.join(' ')).toMatch(/\{\{shelf\}\}/);
  });

  it('says so when the image cannot be overridden', () => {
    const plan = planSpoolLabel(spool(), template({ image_variable: null }), '');
    expect(plan.art).toBeNull();
    expect(plan.warnings.join(' ')).toMatch(/no override variable/);
  });

  it('says so when there is no image block at all', () => {
    const plan = planSpoolLabel(spool(), template({ image: null, image_variable: null, variables: ['name'] }), '');
    expect(plan.art).toBeNull();
    expect(plan.warnings.join(' ')).toMatch(/text only/);
  });
});
