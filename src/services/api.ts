// Typed REST client for shared/protocol.ts. All requests time out after 8 s.
// Errors are thrown as ApiError { status, message }; status 0 = network / timeout.
import type {
  CreateDrawing,
  Drawing,
  DrawingSummary,
  DrawingVersion,
  DrawingVersionSummary,
  UpdateDrawing,
} from '@shared/protocol';

export class ApiError extends Error {
  readonly status: number;
  readonly details?: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
  /** network failure, timeout or gateway error: retrying later may succeed */
  get isOffline() {
    return this.status === 0 || this.status === 502 || this.status === 503 || this.status === 504;
  }
}

const configuredApiUrl = (import.meta.env.VITE_API_URL as string | undefined)?.trim().replace(/\/+$/, '');
export const API_BASE = configuredApiUrl ? `${configuredApiUrl}/api` : '/api';
export const API_ORIGIN = configuredApiUrl;
export const API_TIMEOUT_MS = 8000;

const STATUS_TEXT: Record<number, string> = {
  400: 'The server rejected the request',
  404: 'Drawing not found',
  409: 'The drawing was changed elsewhere',
  413: 'The drawing is too large to save',
  500: 'Server error',
};

async function request<T>(method: string, path: string, body?: unknown, timeoutMs = API_TIMEOUT_MS): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
  } catch (e) {
    const aborted = ctrl.signal.aborted || (e instanceof DOMException && e.name === 'AbortError');
    throw new ApiError(0, aborted ? 'The server did not respond in time' : 'Cannot reach the server');
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 204) return undefined as T;
  let json: unknown = null;
  const text = await res.text().catch(() => '');
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  if (!res.ok) {
    const err = json as { error?: unknown; details?: unknown } | null;
    const msg =
      typeof err?.error === 'string' && err.error ? err.error : STATUS_TEXT[res.status] ?? `Request failed (${res.status})`;
    throw new ApiError(res.status, msg, err?.details);
  }
  return json as T;
}

const enc = encodeURIComponent;

export const api = {
  /** true when the API and DB respond; false on any network error */
  async health(): Promise<boolean> {
    try {
      const r = await request<{ ok: boolean; db?: boolean }>('GET', '/health', undefined, 4000);
      return !!r?.ok;
    } catch {
      return false;
    }
  },
  listDrawings: (q: { search?: string; limit?: number; offset?: number } = {}) => {
    const p = new URLSearchParams();
    if (q.search) p.set('search', q.search);
    if (q.limit !== undefined) p.set('limit', String(q.limit));
    if (q.offset !== undefined) p.set('offset', String(q.offset));
    const qs = p.toString();
    return request<{ drawings: DrawingSummary[]; total: number }>('GET', `/drawings${qs ? `?${qs}` : ''}`);
  },
  createDrawing: (body: CreateDrawing = {}) => request<Drawing>('POST', '/drawings', body),
  getDrawing: (id: string) => request<Drawing>('GET', `/drawings/${enc(id)}`),
  updateDrawing: (id: string, body: UpdateDrawing) => request<Drawing>('PUT', `/drawings/${enc(id)}`, body),
  deleteDrawing: (id: string) => request<void>('DELETE', `/drawings/${enc(id)}`),
  duplicateDrawing: (id: string) => request<Drawing>('POST', `/drawings/${enc(id)}/duplicate`),
  listVersions: (id: string) => request<{ versions: DrawingVersionSummary[] }>('GET', `/drawings/${enc(id)}/versions`),
  getVersion: (id: string, versionId: string) =>
    request<DrawingVersion>('GET', `/drawings/${enc(id)}/versions/${enc(versionId)}`),
  restoreVersion: (id: string, versionId: string) =>
    request<Drawing>('POST', `/drawings/${enc(id)}/versions/${enc(versionId)}/restore`),
  shareDrawing: (id: string, mode: 'edit' | 'view') =>
    request<{ roomId: string; mode: 'edit' | 'view'; url: string }>('POST', `/drawings/${enc(id)}/share`, { mode }),
};
export type Api = typeof api;
