import { describe, it, expect, vi } from 'vitest';
import { SlicerClient } from '../src/slicer/client';
import { serverBuildId, updateAvailable, BUILD_ID } from '../src/ui/buildInfo';
import { boxMesh } from './fixtures';
import { MACHINES, FILAMENTS, PROCESSES, buildSettings } from '../src/profiles';

const settings = () => buildSettings(MACHINES[0], FILAMENTS[0], PROCESSES.find((p) => p.id === '0.20-standard-0.4')!, {});

describe('SlicerClient', () => {
  it('slices on this thread when no Web Worker can be started', async () => {
    // Node has no Worker, which is the same situation as a worker chunk that 404s.
    const client = new SlicerClient();
    const onFallback = vi.fn();
    const cube = boxMesh(10, 10, 2);
    const out = await client.slice(cube.positions, settings(), { modelName: 'cube', onFallback });
    expect(onFallback).toHaveBeenCalledOnce();
    expect(out.gcode).toContain('EXECUTABLE_BLOCK_START');
    expect(out.stats.layerCount).toBe(10);
    expect(out.layerZs.length).toBe(10);
  });
});

describe('buildInfo', () => {
  const res = (body: unknown, ok = true) => ({ ok, json: async () => body }) as Response;
  it('reads the build id the server is offering', async () => {
    let asked = '';
    const f = (async (url: string) => { asked = String(url); return res({ build: '9.9.9+abc', version: '9.9.9' }); }) as unknown as typeof fetch;
    await expect(serverBuildId(f)).resolves.toBe('9.9.9+abc');
    expect(asked).toContain('version.json');
  });
  it('reports no id when the file is missing or malformed', async () => {
    await expect(serverBuildId((async () => res({}, false)) as unknown as typeof fetch)).resolves.toBeNull();
    await expect(serverBuildId((async () => res({ build: 7 })) as unknown as typeof fetch)).resolves.toBeNull();
    await expect(serverBuildId((async () => { throw new Error('offline'); }) as unknown as typeof fetch)).resolves.toBeNull();
  });
  it('only reports an update for a built page whose id differs', async () => {
    const differs = (async () => res({ build: 'other' })) as unknown as typeof fetch;
    const same = (async () => res({ build: BUILD_ID })) as unknown as typeof fetch;
    expect(await updateAvailable(same)).toBe(false);
    // BUILD_ID is 'dev' under the test runner, where an update never applies.
    expect(await updateAvailable(differs)).toBe(BUILD_ID !== 'dev');
  });
});
