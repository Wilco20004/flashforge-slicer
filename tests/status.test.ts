import { describe, it, expect } from 'vitest';
import { cameraUrl, statusLabel, isPrintingStatus } from '../src/printer/flashforge';

const cfg = { host: '10.1.1.163', serialNumber: 'SN', checkCode: 'cc' };

describe('printer status helpers', () => {
  it('routes the camera stream through the relay for LAN printers', () => {
    const detail = { cameraStreamUrl: 'http://10.1.1.163:8080/?action=stream' };
    expect(cameraUrl(cfg, detail, true)).toBe('printer/10.1.1.163:8080/?action=stream');
    expect(cameraUrl(cfg, detail, false)).toBe('http://10.1.1.163:8080/?action=stream');
  });
  it('returns null without a camera', () => {
    expect(cameraUrl(cfg, { cameraStreamUrl: '' }, true)).toBeNull();
    expect(cameraUrl(cfg, null, true)).toBeNull();
  });
  it('labels statuses and knows which ones are active prints', () => {
    expect(statusLabel('printing')).toBe('Printing');
    expect(statusLabel('pause')).toBe('Paused');
    expect(statusLabel(undefined)).toBe('Unknown');
    expect(isPrintingStatus('heating')).toBe(true);
    expect(isPrintingStatus('ready')).toBe(false);
  });
});
