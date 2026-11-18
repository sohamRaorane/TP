import type { Server, Socket } from 'socket.io';
import { z } from 'zod';
import type { BinaryFiles, SceneData, SketchElement } from '../../../shared/element';
import { shouldAcceptRemote } from '../../../shared/element';
import type {
  ClientToServerEvents,
  Collaborator,
  ServerToClientEvents,
} from '../../../shared/protocol';
import { binaryFileSchema, elementSchema } from '../../../shared/schema';
import type { ServerConfig } from '../config';
import type { ChangeSource, DrawingService } from '../services/drawingService';

// ----------------------------------------------------------------- types
export interface SocketData {
  roomKey?: string;
  roomId?: string;
  role?: 'edit' | 'view';
  rate?: { windowStart: number; count: number; warned: boolean };
}
type InterServerEvents = Record<string, never>;
export type CollabServer = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
type CollabSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

export interface RoomState {
  key: string;
  drawingId: string | null;
  elements: Map<string, SketchElement>;
  order: string[];
  files: BinaryFiles;
  users: Map<string, Collaborator>;
  dirty: boolean;
  firstDirtyAt: number | null;
  persistTimer: NodeJS.Timeout | null;
  evictTimer: NodeJS.Timeout | null;
  persisting: Promise<void> | null;
}

export type CollaborationOptions = Pick<
  ServerConfig,
  'persistDebounceMs' | 'persistMaxWaitMs' | 'roomEvictMs' | 'maxUpdatesPerSecond'
>;

// ------------------------------------------------------------ validation
export const MAX_ELEMENTS_PER_MESSAGE = 5000;
export const MAX_FILES_BYTES_PER_MESSAGE = 10 * 1024 * 1024;

const roomIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/, 'Invalid room id');
const joinSchema = z.object({
  roomId: roomIdSchema,
  user: z.object({
    userId: z.string().min(1).max(100),
    name: z.string().max(100),
    color: z.string().max(64),
  }),
});
const roomOnly = z.object({ roomId: roomIdSchema });
const elementsSchema = elementSchema.array().max(MAX_ELEMENTS_PER_MESSAGE);
const finite = z.number().finite();
const pointerSchema = z.object({
  x: finite,
  y: finite,
  tool: z.string().max(50),
  button: z.enum(['up', 'down']),
  selectedElementIds: z.array(z.string().max(100)).max(MAX_ELEMENTS_PER_MESSAGE),
  viewport: z
    .object({ scrollX: finite, scrollY: finite, zoom: finite, width: finite, height: finite })
    .optional(),
});
const laserSchema = z.array(z.tuple([finite, finite, finite])).max(2000);
const userUpdateSchema = z.object({ name: z.string().max(100), color: z.string().max(64) });

const roomKeyFor = (drawingId: string | null, roomId: string) => (drawingId ? `d:${drawingId}` : `a:${roomId}`);

/**
 * In-memory collaboration rooms on top of Socket.IO. Rooms are keyed by
 * drawing (so edit and view links of one drawing share a scene) or by the
 * raw room id for ad-hoc rooms that are never persisted.
 */
export class CollaborationHub {
  readonly rooms = new Map<string, RoomState>();
  private loading = new Map<string, Promise<RoomState>>();
  private closed = false;

  constructor(
    private readonly io: CollabServer,
    private readonly service: DrawingService,
    private readonly opts: CollaborationOptions,
  ) {
    io.on('connection', (socket) => this.onConnection(socket));
    service.on('changed', this.onDrawingChanged);
    service.on('deleted', this.onDrawingDeleted);
  }

  // ------------------------------------------------------------ connection
  private onConnection(socket: CollabSocket) {
    socket.on('room:join', (payload, ack) => {
      void this.handleJoin(socket, payload, typeof ack === 'function' ? ack : () => undefined);
    });

    socket.on('room:leave', (payload) => {
      const p = roomOnly.safeParse(payload);
      if (p.success && p.data.roomId === socket.data.roomId) this.leave(socket);
    });

    socket.on('scene:update', (payload) => {
      const room = this.roomOf(socket, payload);
      if (!room) return;
      if (socket.data.role !== 'edit') return this.error(socket, 'Read-only: view links cannot edit');
      if (!this.allowUpdate(socket)) return;
      const parsed = elementsSchema.safeParse((payload as { elements?: unknown }).elements);
      if (!parsed.success) return this.error(socket, `Invalid scene:update: ${parsed.error.issues[0]?.message ?? 'bad payload'}`);
      const accepted = this.applyElements(room, parsed.data as SketchElement[]);
      if (accepted.length === 0) return;
      socket.to(room.key).emit('scene:update', { elements: accepted, from: socket.id });
      this.markDirty(room);
    });

    socket.on('files:add', (payload) => {
      const room = this.roomOf(socket, payload);
      if (!room) return;
      if (socket.data.role !== 'edit') return this.error(socket, 'Read-only: view links cannot add files');
      const files = this.parseFiles((payload as { files?: unknown }).files);
      if (typeof files === 'string') return this.error(socket, files);
      const added: BinaryFiles = {};
      for (const [id, file] of Object.entries(files)) {
        if (room.files[id]) continue;
        room.files[id] = file;
        added[id] = file;
      }
      if (Object.keys(added).length === 0) return;
      socket.to(room.key).emit('files:add', { files: added, from: socket.id });
      this.markDirty(room);
    });

    socket.on('scene:sync', (payload) => {
      const room = this.roomOf(socket, payload);
      if (room) socket.emit('scene:init', this.sceneOf(room));
    });

    socket.on('pointer:update', (payload) => {
      const room = this.roomOf(socket, payload);
      if (!room) return;
      const p = pointerSchema.safeParse((payload as { pointer?: unknown }).pointer);
      if (!p.success) return;
      socket.to(room.key).volatile.emit('pointer:update', { socketId: socket.id, pointer: p.data });
    });

    socket.on('laser:update', (payload) => {
      const room = this.roomOf(socket, payload);
      if (!room) return;
      const p = laserSchema.safeParse((payload as { points?: unknown }).points);
      if (!p.success) return;
      socket.to(room.key).volatile.emit('laser:update', { socketId: socket.id, points: p.data });
    });

    socket.on('user:update', (payload) => {
      const room = this.roomOf(socket, payload);
      if (!room) return;
      const p = userUpdateSchema.safeParse(payload);
      const user = room.users.get(socket.id);
      if (!p.success || !user) return;
      room.users.set(socket.id, { ...user, name: p.data.name, color: p.data.color });
      this.emitPresence(room);
    });

    socket.on('disconnect', () => this.leave(socket));
  }

  private async handleJoin(
    socket: CollabSocket,
    payload: unknown,
    ack: Parameters<ClientToServerEvents['room:join']>[1],
  ) {
    const p = joinSchema.safeParse(payload);
    if (!p.success) return ack({ ok: false, error: `Invalid room:join: ${p.error.issues[0]?.message ?? 'bad payload'}` });
    if (this.closed) return ack({ ok: false, error: 'Server is shutting down' });
    const { roomId, user } = p.data;
    try {
      const resolved = await this.service.resolveRoom(roomId);
      const drawingId = resolved?.drawingId ?? null;
      const role = resolved?.role ?? 'edit';
      const key = roomKeyFor(drawingId, roomId);
      if (socket.data.roomKey && socket.data.roomKey !== key) this.leave(socket);
      const room = await this.getRoom(key, drawingId);
      if (socket.disconnected) return;
      if (room.evictTimer) {
        clearTimeout(room.evictTimer);
        room.evictTimer = null;
      }
      room.users.set(socket.id, { ...user, socketId: socket.id, role });
      socket.data.roomKey = key;
      socket.data.roomId = roomId;
      socket.data.role = role;
      await socket.join(key);
      ack({ ok: true, role, drawingId: room.drawingId });
      socket.emit('scene:init', this.sceneOf(room));
      this.emitPresence(room);
    } catch (err) {
      console.error('[collab] join failed:', err);
      ack({ ok: false, error: 'Could not join room' });
    }
  }

  private leave(socket: CollabSocket) {
    const key = socket.data.roomKey;
    socket.data.roomKey = undefined;
    socket.data.roomId = undefined;
    socket.data.role = undefined;
    if (!key) return;
    void socket.leave(key);
    const room = this.rooms.get(key);
    if (!room || !room.users.delete(socket.id)) return;
    this.emitPresence(room);
    if (room.users.size === 0) {
      void this.persist(room);
      this.scheduleEvict(room);
    }
  }

  // ---------------------------------------------------------------- rooms
  private getRoom(key: string, drawingId: string | null): Promise<RoomState> {
    const existing = this.rooms.get(key);
    if (existing) return Promise.resolve(existing);
    const pending = this.loading.get(key);
    if (pending) return pending;
    const load = (async () => {
      const drawing = drawingId ? await this.service.repo.get(drawingId) : null;
      const elements = drawing?.data.elements ?? [];
      const room: RoomState = {
        key,
        drawingId: drawing ? drawing.id : null,
        elements: new Map(elements.map((el) => [el.id, el])),
        order: [...new Set(elements.map((el) => el.id))],
        files: { ...(drawing?.data.files ?? {}) },
        users: new Map(),
        dirty: false,
        firstDirtyAt: null,
        persistTimer: null,
        evictTimer: null,
        persisting: null,
      };
      this.rooms.set(key, room);
      return room;
    })().finally(() => this.loading.delete(key));
    this.loading.set(key, load);
    return load;
  }

  /** The socket's room if `payload.roomId` matches the room it joined. */
  private roomOf(socket: CollabSocket, payload: unknown): RoomState | null {
    const p = roomOnly.safeParse(payload);
    const key = socket.data.roomKey;
    if (!p.success || !key || p.data.roomId !== socket.data.roomId) {
      this.error(socket, 'Not in room: join it first');
      return null;
    }
    return this.rooms.get(key) ?? null;
  }

  private sceneOf(room: RoomState): { elements: SketchElement[]; files: BinaryFiles } {
    return { elements: room.order.map((id) => room.elements.get(id)!), files: room.files };
  }

  /** Reconciles elements into the room; returns those that won. */
  private applyElements(room: RoomState, incoming: readonly SketchElement[]): SketchElement[] {
    const accepted: SketchElement[] = [];
    for (const el of incoming) {
      const local = room.elements.get(el.id);
      if (!shouldAcceptRemote(local, el)) continue;
      if (!local) room.order.push(el.id);
      room.elements.set(el.id, el);
      accepted.push(el);
    }
    return accepted;
  }

  private parseFiles(raw: unknown): BinaryFiles | string {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'Invalid files:add: files must be an object';
    const out: BinaryFiles = {};
    let bytes = 0;
    for (const [id, value] of Object.entries(raw)) {
      const f = binaryFileSchema.safeParse(value);
      if (!f.success || f.data.id !== id) return `Invalid files:add: bad file ${id.slice(0, 100)}`;
      bytes += f.data.dataURL.length;
      if (bytes > MAX_FILES_BYTES_PER_MESSAGE) return 'Invalid files:add: files exceed 10MB per message';
      out[id] = f.data;
    }
    return out;
  }

  private emitPresence(room: RoomState) {
    this.io.to(room.key).emit('presence', { users: [...room.users.values()] });
  }

  private error(socket: CollabSocket, error: string) {
    socket.emit('room:error', { error });
  }

  private allowUpdate(socket: CollabSocket): boolean {
    const now = Date.now();
    const rate = socket.data.rate ?? { windowStart: now, count: 0, warned: false };
    if (now - rate.windowStart >= 1000) Object.assign(rate, { windowStart: now, count: 0, warned: false });
    rate.count++;
    socket.data.rate = rate;
    if (rate.count <= this.opts.maxUpdatesPerSecond) return true;
    if (!rate.warned) {
      rate.warned = true;
      this.error(socket, 'Rate limit exceeded: scene:update dropped, send scene:sync to resync');
    }
    return false;
  }

  // ----------------------------------------------------------- persistence
  private markDirty(room: RoomState) {
    if (!room.drawingId) return; // ad-hoc rooms live in memory only
    room.dirty = true;
    const now = Date.now();
    room.firstDirtyAt ??= now;
    if (room.persistTimer) clearTimeout(room.persistTimer);
    const delay = Math.min(this.opts.persistDebounceMs, Math.max(0, room.firstDirtyAt + this.opts.persistMaxWaitMs - now));
    room.persistTimer = setTimeout(() => void this.persist(room), delay);
  }

  /** Writes the room to its drawing if dirty; serialized per room. */
  async persist(room: RoomState): Promise<void> {
    while (room.persisting) await room.persisting;
    if (room.persistTimer) {
      clearTimeout(room.persistTimer);
      room.persistTimer = null;
    }
    if (!room.dirty || !room.drawingId) return;
    const drawingId = room.drawingId;
    const { elements, files } = this.sceneOf(room);
    room.dirty = false;
    room.firstDirtyAt = null;
    room.persisting = (async () => {
      try {
        const saved = await this.service.saveRoomScene(drawingId, elements, files);
        if (!saved) room.drawingId = null; // drawing was deleted
      } catch (err) {
        console.error(`[collab] persisting ${room.key} failed, will retry:`, err);
        if (!this.closed) this.markDirty(room);
        else room.dirty = true;
      } finally {
        room.persisting = null;
      }
    })();
    await room.persisting;
  }

  private scheduleEvict(room: RoomState) {
    if (room.evictTimer) clearTimeout(room.evictTimer);
    room.evictTimer = setTimeout(() => {
      room.evictTimer = null;
      void (async () => {
        await this.persist(room);
        if (room.users.size === 0 && !room.dirty && this.rooms.get(room.key) === room) this.rooms.delete(room.key);
      })();
    }, this.opts.roomEvictMs);
  }

  // ------------------------------------------- REST changes -> live rooms
  private onDrawingChanged = (drawingId: string, data: SceneData, source: ChangeSource) => {
    if (source === 'room') return;
    const room = this.rooms.get(roomKeyFor(drawingId, drawingId));
    if (!room) return;
    const accepted = this.applyElements(room, data.elements);
    if (accepted.length > 0) this.io.to(room.key).emit('scene:update', { elements: accepted, from: 'server' });
    const added: BinaryFiles = {};
    for (const [id, f] of Object.entries(data.files)) {
      if (!room.files[id]) added[id] = room.files[id] = f;
    }
    if (Object.keys(added).length > 0) this.io.to(room.key).emit('files:add', { files: added, from: 'server' });
  };

  private onDrawingDeleted = (drawingId: string) => {
    const room = this.rooms.get(roomKeyFor(drawingId, drawingId));
    if (!room) return;
    room.drawingId = null;
    room.dirty = false;
    if (room.persistTimer) clearTimeout(room.persistTimer);
    room.persistTimer = null;
    this.io.to(room.key).emit('room:error', { error: 'Drawing was deleted' });
  };

  // ------------------------------------------------------------- shutdown
  /** Persists every dirty room (used on shutdown and in tests). */
  async flushAll(): Promise<void> {
    await Promise.all([...this.rooms.values()].map((r) => this.persist(r)));
  }

  async close(): Promise<void> {
    this.closed = true;
    this.service.off('changed', this.onDrawingChanged);
    this.service.off('deleted', this.onDrawingDeleted);
    await this.flushAll();
    for (const room of this.rooms.values()) {
      if (room.persistTimer) clearTimeout(room.persistTimer);
      if (room.evictTimer) clearTimeout(room.evictTimer);
    }
    this.rooms.clear();
  }
}
