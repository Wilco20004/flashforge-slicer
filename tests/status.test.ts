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

import { relayIfLan, defaultCameraUrl } from '../src/printer/flashforge';

describe('manual camera URL', () => {
  const cfg = { host: '10.1.1.163', serialNumber: 'SN', checkCode: 'cc' };
  it('suggests the firmware camera port for the saved printer', () => {
    expect(defaultCameraUrl(cfg)).toBe('http://10.1.1.163:8080/?action=stream');
  });
  it('prefers the manual URL over the reported one and relays LAN addresses', () => {
    expect(cameraUrl(cfg, { cameraStreamUrl: '' }, true, 'http://10.1.1.163:8080/?action=stream')).toBe('printer/10.1.1.163:8080/?action=stream');
    expect(cameraUrl(cfg, { cameraStreamUrl: 'http://10.1.1.163:8080/?action=stream' }, true, 'http://192.168.1.9:8081/stream')).toBe('printer/192.168.1.9:8081/stream');
  });
  it('leaves public or https URLs alone', () => {
    expect(relayIfLan('https://cam.example.com/stream', true)).toBe('https://cam.example.com/stream');
    expect(relayIfLan('10.0.0.7:8080/?action=stream', true)).toBe('printer/10.0.0.7:8080/?action=stream');
    expect(relayIfLan('10.0.0.7:8080/?action=stream', false)).toBe('http://10.0.0.7:8080/?action=stream');
  });
});
