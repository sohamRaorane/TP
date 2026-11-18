// Thin adapter over C's REST client ('@/services/api'). If that module (or a
// method) is missing, it falls back to plain fetch against shared/protocol.ts.
import type {
  Drawing,
  DrawingSummary,
  DrawingVersion,
  DrawingVersionSummary,
} from '@shared/protocol';
import { loadOptional, PATHS } from './integration';

type AnyFn = (...args: unknown[]) => Promise<unknown>;

async function clientFn(names: string[]): Promise<AnyFn | null> {
  const mod = await loadOptional<Record<string, unknown>>(PATHS.api);
  if (!mod) return null;
  const candidates = [mod.api, mod.default, mod].filter(
    (c): c is Record<string, unknown> => !!c && typeof c === 'object',
  );
  for (const c of candidates)
    for (const n of names) if (typeof c[n] === 'function') return (c[n] as AnyFn).bind(c);
  return null;
}

async function http<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('Server is unreachable');
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  if (!res.ok) {
    const msg = (data as { error?: string } | null)?.error;
    throw new Error(msg ?? (res.status >= 500 || res.status === 404 && !data ? 'Server is unreachable' : `Request failed (${res.status})`));
  }
  if (data === null) throw new Error('Server is unreachable');
  return data as T;
}

async function via<T>(names: string[], args: unknown[], fallback: () => Promise<T>): Promise<T> {
  const fn = await clientFn(names);
  return fn ? ((await fn(...args)) as T) : fallback();
}

export const apiClient = {
  async listDrawings(search = ''): Promise<DrawingSummary[]> {
    const res = await via<unknown>(['listDrawings', 'list', 'getDrawings'], [{ search, limit: 100 }], () =>
      http('GET', `/api/drawings?search=${encodeURIComponent(search)}&limit=100`),
    );
    if (Array.isArray(res)) return res as DrawingSummary[];
    return ((res as { drawings?: DrawingSummary[] })?.drawings ?? []);
  },
  renameDrawing: (id: string, name: string) =>
    via<Drawing>(['updateDrawing', 'update'], [id, { name }], () => http('PUT', `/api/drawings/${id}`, { name })),
  duplicateDrawing: (id: string) =>
    via<Drawing>(['duplicateDrawing', 'duplicate'], [id], () => http('POST', `/api/drawings/${id}/duplicate`)),
  deleteDrawing: (id: string) =>
    via<void>(['deleteDrawing', 'delete', 'remove'], [id], () => http('DELETE', `/api/drawings/${id}`)),
  async listVersions(id: string): Promise<DrawingVersionSummary[]> {
    const res = await via<unknown>(['listVersions', 'getVersions', 'versions'], [id], () =>
      http('GET', `/api/drawings/${id}/versions`),
    );
    if (Array.isArray(res)) return res as DrawingVersionSummary[];
    return ((res as { versions?: DrawingVersionSummary[] })?.versions ?? []);
  },
  getVersion: (id: string, versionId: string) =>
    via<DrawingVersion>(['getVersion', 'version'], [id, versionId], () =>
      http('GET', `/api/drawings/${id}/versions/${versionId}`),
    ),
  restoreVersion: (id: string, versionId: string) =>
    via<Drawing>(['restoreVersion', 'restore'], [id, versionId], () =>
      http('POST', `/api/drawings/${id}/versions/${versionId}/restore`),
    ),
};
