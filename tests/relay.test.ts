import { describe, it, expect } from 'vitest';
import { isPrivateIPv4, relayUrl } from '../src/printer/relay';
import { apiUrl, splitHost, sanitizeFilename } from '../src/printer/flashforge';
import { moonrakerBase } from '../src/printer/moonraker';

describe('printer relay helpers', () => {
  it('recognises private LAN addresses only', () => {
    expect(isPrivateIPv4('10.1.1.163')).toBe(true);
    expect(isPrivateIPv4('192.168.0.5')).toBe(true);
    expect(isPrivateIPv4('172.16.4.2')).toBe(true);
    expect(isPrivateIPv4('172.32.0.1')).toBe(false);
    expect(isPrivateIPv4('127.0.0.1')).toBe(true);
    expect(isPrivateIPv4('8.8.8.8')).toBe(false);
    expect(isPrivateIPv4('printer.local')).toBe(false);
  });
  it('builds relay and direct URLs for the Flashforge API', () => {
    const cfg = { host: '10.1.1.163', serialNumber: 'SN', checkCode: 'cc' };
    expect(apiUrl(cfg, 'uploadGcode', true)).toBe('printer/10.1.1.163:8898/uploadGcode');
    expect(apiUrl(cfg, 'detail', false)).toBe('http://10.1.1.163:8898/detail');
    expect(apiUrl({ ...cfg, host: 'http://10.1.1.163:9000/' }, 'detail', true)).toBe('printer/10.1.1.163:9000/detail');
    expect(splitHost('10.0.0.2')).toEqual({ host: '10.0.0.2', port: 8898 });
    expect(relayUrl('10.0.0.2', 7125, '/server/files/upload')).toBe('printer/10.0.0.2:7125/server/files/upload');
  });
  it('routes Moonraker through the relay only for LAN IPs', () => {
    expect(moonrakerBase({ url: 'http://10.1.1.50:7125' }, true)).toBe('printer/10.1.1.50:7125');
    expect(moonrakerBase({ url: '10.1.1.50' }, true)).toBe('printer/10.1.1.50:7125');
    expect(moonrakerBase({ url: 'http://ad5m.local:7125' }, true)).toBe('http://ad5m.local:7125');
    expect(moonrakerBase({ url: 'http://10.1.1.50:7125' }, false)).toBe('http://10.1.1.50:7125');
  });
  it('sanitises file names the way the printer expects', () => {
    expect(sanitizeFilename('my part (v2).gcode')).toBe('my_part__v2_.gcode');
    expect(sanitizeFilename('plate')).toBe('plate.gcode');
  });
});
