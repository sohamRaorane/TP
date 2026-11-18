// REST + Socket.IO contract between client and server. CONTRACT.
import type { BinaryFiles, SceneData, SketchElement } from './element';

// ---------------------------------------------------------------- REST
// All JSON. Base path /api. Errors: { error: string, details?: unknown } with 4xx/5xx.
//
// GET    /api/health                              -> { ok: true, db: boolean }
// GET    /api/drawings?search=&limit=&offset=     -> { drawings: DrawingSummary[], total: number }
// POST   /api/drawings        body CreateDrawing  -> Drawing (201)
// GET    /api/drawings/:id                        -> Drawing
// PUT    /api/drawings/:id    body UpdateDrawing  -> Drawing   (409 if baseRevision mismatch)
// DELETE /api/drawings/:id                        -> 204
// POST   /api/drawings/:id/duplicate              -> Drawing (201)
// GET    /api/drawings/:id/versions               -> { versions: DrawingVersionSummary[] }
// GET    /api/drawings/:id/versions/:versionId    -> DrawingVersion
// POST   /api/drawings/:id/versions/:versionId/restore -> Drawing
// POST   /api/drawings/:id/share  body { mode: 'edit' | 'view' } -> { roomId, mode, url }
//
// A drawing's collaboration room id === drawing id (edit mode).
// View-only links use a separate opaque roomId mapped to the drawing (mode 'view').

export interface DrawingSummary {
  id: string;
  name: string;
  thumbnail: string | null; // small PNG data URL
  elementCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface Drawing extends DrawingSummary {
  data: SceneData;
  revision: number; // server-side counter, incremented per save
}

export interface CreateDrawing {
  name?: string;
  data?: SceneData;
  thumbnail?: string | null;
}

export interface UpdateDrawing {
  name?: string;
  data?: SceneData;
  thumbnail?: string | null;
  /** optional optimistic-concurrency check */
  baseRevision?: number;
}

export interface DrawingVersionSummary {
  id: string;
  createdAt: string;
  elementCount: number;
  label: string | null;
}
export interface DrawingVersion extends DrawingVersionSummary {
  data: SceneData;
}

// ---------------------------------------------------------------- Socket.IO
// Namespace '/'. Rooms joined via 'room:join'.

export interface Collaborator {
  /** stable per browser (localStorage) */
  userId: string;
  /** socket id, unique per tab */
  socketId: string;
  name: string;
  color: string;
  role: 'edit' | 'view';
}

export interface PointerPayload {
  x: number; // scene coords
  y: number;
  tool: string;
  button: 'up' | 'down';
  selectedElementIds: string[];
  /** visible scene rect, enables "follow user" */
  viewport?: { scrollX: number; scrollY: number; zoom: number; width: number; height: number };
}

export interface ClientToServerEvents {
  'room:join': (
    p: { roomId: string; user: { userId: string; name: string; color: string } },
    ack: (res: { ok: true; role: 'edit' | 'view'; drawingId: string | null } | { ok: false; error: string }) => void,
  ) => void;
  'room:leave': (p: { roomId: string }) => void;
  /** incremental: only elements whose version changed since last broadcast */
  'scene:update': (p: { roomId: string; elements: SketchElement[] }) => void;
  'files:add': (p: { roomId: string; files: BinaryFiles }) => void;
  /** ask the server for the full current scene (after reconnect) */
  'scene:sync': (p: { roomId: string }) => void;
  'pointer:update': (p: { roomId: string; pointer: PointerPayload }) => void;
  'laser:update': (p: { roomId: string; points: Array<[number, number, number]> }) => void; // x,y,t
  'user:update': (p: { roomId: string; name: string; color: string }) => void;
}

export interface ServerToClientEvents {
  /** full scene on join or on 'scene:sync' */
  'scene:init': (p: { elements: SketchElement[]; files: BinaryFiles }) => void;
  'scene:update': (p: { elements: SketchElement[]; from: string }) => void;
  'files:add': (p: { files: BinaryFiles; from: string }) => void;
  'presence': (p: { users: Collaborator[] }) => void;
  'pointer:update': (p: { socketId: string; pointer: PointerPayload }) => void;
  'laser:update': (p: { socketId: string; points: Array<[number, number, number]> }) => void;
  'room:error': (p: { error: string }) => void;
}
