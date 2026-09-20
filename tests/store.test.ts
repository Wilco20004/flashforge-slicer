import { describe, it, expect } from 'vitest';
import { pickNewer } from '../src/store/settingsStore';

describe('settings store merge', () => {
  it('prefers the more recently updated record', () => {
    expect(pickNewer({ updatedAt: 1, v: 'a' }, { updatedAt: 2, v: 'b' })!.v).toBe('b');
    expect(pickNewer({ updatedAt: 3, v: 'a' }, { updatedAt: 2, v: 'b' })!.v).toBe('a');
  });
  it('falls back to whichever side exists', () => {
    expect(pickNewer(null, { updatedAt: 1, v: 'b' })!.v).toBe('b');
    expect(pickNewer({ updatedAt: 1, v: 'a' }, null)!.v).toBe('a');
    expect(pickNewer(null, null)).toBeNull();
  });
  it('keeps the existing record on a tie', () => {
    expect(pickNewer({ updatedAt: 5, v: 'a' }, { updatedAt: 5, v: 'b' })!.v).toBe('a');
  });
});
