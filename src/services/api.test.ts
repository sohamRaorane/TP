import { describe, it, expect, vi, afterEach } from 'vitest';
import { api, ApiError } from './api';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('api client', () => {
  it('sends JSON and parses responses', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ drawings: [], total: 0 }), { status: 200 }));
    vi.stubGlobal('fetch', f);
    await expect(api.listDrawings({ search: 'a b', limit: 5 })).resolves.toEqual({ drawings: [], total: 0 });
    expect(f).toHaveBeenCalledWith('/api/drawings?search=a+b&limit=5', expect.objectContaining({ method: 'GET' }));
  });

  it('maps server errors to ApiError with the server message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Nope' }), { status: 409 })));
    const e = await api.updateDrawing('x', { name: 'n' }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect(e).toMatchObject({ status: 409, message: 'Nope' });
  });

  it('network errors are status 0 / offline; health returns false', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const e = (await api.getDrawing('x').catch((x: unknown) => x)) as ApiError;
    expect(e.status).toBe(0);
    expect(e.isOffline).toBe(true);
    await expect(api.health()).resolves.toBe(false);
  });

  it('times out after 8s', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_u: string, init: RequestInit) => new Promise((_r, reject) => {
      init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    })));
    const p = api.getDrawing('x').catch((x: unknown) => x);
    await vi.advanceTimersByTimeAsync(8000);
    expect(await p).toMatchObject({ status: 0, message: 'The server did not respond in time' });
  });

  it('204 resolves undefined', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })));
    await expect(api.deleteDrawing('x')).resolves.toBeUndefined();
  });
});
