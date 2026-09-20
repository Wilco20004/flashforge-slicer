import { describe, it, expect } from 'vitest';
import { FrameSplitter, snapshotUrlFor } from '../src/printer/mjpeg';

const jpeg = (payload: number[]) => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...payload, 0xff, 0xd9]);
const text = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));
const cat = (...parts: Uint8Array[]) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };

describe('FrameSplitter', () => {
  const f1 = jpeg([1, 2, 3]);
  const f2 = jpeg([9, 8, 7, 6]);
  const part = (f: Uint8Array) => cat(text(`--boundarydonotcross\r\nContent-Type: image/jpeg\r\nContent-Length: ${f.length}\r\nX-Timestamp: 1.2\r\n\r\n`), f, text('\r\n'));

  it('splits MJPG-Streamer parts using Content-Length', () => {
    const s = new FrameSplitter();
    const frames = s.push(cat(part(f1), part(f2)));
    expect(frames.length).toBe(2);
    expect(Array.from(frames[0])).toEqual(Array.from(f1));
    expect(Array.from(frames[1])).toEqual(Array.from(f2));
  });
  it('handles frames split across arbitrary chunk boundaries', () => {
    const s = new FrameSplitter();
    const all = cat(part(f1), part(f2), part(f1));
    const frames: Uint8Array[] = [];
    for (let i = 0; i < all.length; i += 5) frames.push(...s.push(all.slice(i, i + 5)));
    expect(frames.length).toBe(3);
    expect(Array.from(frames[2])).toEqual(Array.from(f1));
  });
  it('falls back to SOI/EOI markers without Content-Length', () => {
    const s = new FrameSplitter();
    const frames = s.push(cat(text('--b\r\nContent-Type: image/jpeg\r\n\r\n'), f1, text('\r\n--b\r\nContent-Type: image/jpeg\r\n\r\n'), f2));
    expect(frames.length).toBe(2);
    expect(Array.from(frames[1])).toEqual(Array.from(f2));
  });
  it('uses Content-Length so an embedded EOI marker does not cut a frame short', () => {
    const tricky = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xd9, 0x11, 0x22, 0xff, 0xd9]);
    const s = new FrameSplitter();
    const frames = s.push(cat(text(`--b\r\nContent-Length: ${tricky.length}\r\n\r\n`), tricky));
    expect(frames.length).toBe(1);
    expect(frames[0].length).toBe(tricky.length);
  });
  it('derives the snapshot URL', () => {
    expect(snapshotUrlFor('printer/10.1.1.163:8080/?action=stream')).toBe('printer/10.1.1.163:8080/?action=snapshot');
    expect(snapshotUrlFor('http://cam/stream.mjpg')).toBeNull();
  });
});
