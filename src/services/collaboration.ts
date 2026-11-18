// Real-time collaboration over Socket.IO (same origin; Vite proxies /socket.io).
// Fills useCollaborationStore; syncs elements incrementally (see syncDiff.ts).
import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, Collaborator, PointerPayload, ServerToClientEvents } from '@shared/protocol';
import type { BinaryFiles, SketchElement } from '@/types/appState';
import { useCanvasStore } from '@/store/canvasStore';
import { useHistoryStore } from '@/store/historyStore';
import { useCollaborationStore } from '@/store/collaborationStore';
import { binaryFileSchema } from '@shared/schema';
import {
  collectChanged,
  filesToSend,
  followViewport,
  localNewerThan,
  markKnown,
  markReceived,
  pruneLaser,
  restampLaser,
  sanitizeIncoming,
  type VersionMap,
} from './syncDiff';
import { throttle } from '@/utils/timing';
import { toast } from '@/utils/toast';

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const SCENE_THROTTLE_MS = 50;
const POINTER_THROTTLE_MS = 30;
const JOIN_TIMEOUT_MS = 10_000;

let socket: ClientSocket | null = null;
let currentRoom: string | null = null;
/** versions sent or received per element id: never echo these back */
const known: VersionMap = new Map();
const knownFiles = new Set<string>();
let unsubs: Array<() => void> = [];
let laserTimer: ReturnType<typeof setInterval> | null = null;
let applyingFollow = false;
let joinedOnce = false;

const cs = () => useCollaborationStore.getState();
const canvas = () => useCanvasStore.getState();

/** factory indirection so tests can inject a fake socket */
let socketFactory: () => ClientSocket = () =>
  io({ path: '/socket.io', autoConnect: false, reconnection: true, reconnectionDelay: 500, reconnectionDelayMax: 5000 });
export const __setSocketFactory = (f: () => ClientSocket) => {
  socketFactory = f;
};

const isConnected = () => !!socket?.connected && cs().status === 'connected';

// ---------------------------------------------------------------- outgoing scene
function flushScene() {
  if (!socket || !currentRoom || !isConnected() || cs().role !== 'edit') return;
  const { elements, files } = canvas();
  const changed = collectChanged(elements, known);
  if (!changed.length) return;
  const f = filesToSend(changed, files, knownFiles);
  if (Object.keys(f).length) {
    socket.emit('files:add', { roomId: currentRoom, files: f });
    Object.keys(f).forEach((id) => knownFiles.add(id));
  }
  socket.emit('scene:update', { roomId: currentRoom, elements: changed });
  markKnown(known, changed);
}
const scheduleFlush = throttle(flushScene, SCENE_THROTTLE_MS);

// ---------------------------------------------------------------- incoming
function onSceneInit(p: { elements: SketchElement[]; files: BinaryFiles }) {
  const remote = sanitizeIncoming(p.elements);
  addRemoteFiles(p.files);
  const s = canvas();
  const newerLocal = localNewerThan(s.elements, remote);
  s.applyRemoteElements(remote);
  // remote state is the new history baseline (not undoable); keeps pending local work
  markReceived(known, remote, canvas().elementsById);
  if (!joinedOnce) {
    // first join: everything currently local that the server already has is "known"
    for (const el of remote) if (!known.has(el.id)) known.set(el.id, el.version);
    useHistoryStore.getState().absorb(canvas().elements);
  }
  joinedOnce = true;
  if (newerLocal.length && socket && currentRoom && cs().role === 'edit') {
    const f = filesToSend(newerLocal, canvas().files, knownFiles);
    if (Object.keys(f).length) {
      socket.emit('files:add', { roomId: currentRoom, files: f });
      Object.keys(f).forEach((id) => knownFiles.add(id));
    }
    socket.emit('scene:update', { roomId: currentRoom, elements: newerLocal });
    markKnown(known, newerLocal);
  }
  // anything else changed locally meanwhile
  scheduleFlush();
}

function onSceneUpdate(p: { elements: SketchElement[]; from: string }) {
  const incoming = sanitizeIncoming(p.elements);
  if (!incoming.length) return;
  canvas().applyRemoteElements(incoming);
  markReceived(known, incoming, canvas().elementsById);
}

function addRemoteFiles(files: unknown) {
  if (!files || typeof files !== 'object') return;
  const ok: BinaryFiles = {};
  for (const [id, f] of Object.entries(files as Record<string, unknown>)) {
    const r = binaryFileSchema.safeParse(f);
    if (r.success) {
      ok[id] = r.data;
      knownFiles.add(id);
    }
  }
  if (Object.keys(ok).length) canvas().addFiles(ok, { remote: true });
}

function onPresence(p: { users: Collaborator[] }) {
  const mine = socket?.id;
  const others = p.users.filter((u) => u.socketId !== mine);
  const ids = new Set(others.map((u) => u.socketId));
  const { pointers, lasers } = cs();
  const keep = <T>(m: Record<string, T>) => Object.fromEntries(Object.entries(m).filter(([k]) => ids.has(k)));
  cs().set({ collaborators: others, pointers: keep(pointers), lasers: keep(lasers) });
  const following = canvas().appState.followingSocketId;
  if (following && !ids.has(following)) canvas().setAppState({ followingSocketId: null });
}

function onPointer(p: { socketId: string; pointer: PointerPayload }) {
  if (p.socketId === socket?.id) return;
  cs().set({ pointers: { ...cs().pointers, [p.socketId]: { ...p.pointer, updated: Date.now() } } });
  if (canvas().appState.followingSocketId === p.socketId && p.pointer.viewport) applyFollow(p.pointer.viewport);
}

export function applyFollow(vp: NonNullable<PointerPayload['viewport']>) {
  const a = canvas().appState;
  const next = followViewport(vp, a.width, a.height);
  if (next.zoom === a.zoom && next.scrollX === a.scrollX && next.scrollY === a.scrollY) return;
  applyingFollow = true;
  try {
    canvas().setAppState(next);
  } finally {
    applyingFollow = false;
  }
}

function onLaser(p: { socketId: string; points: Array<[number, number, number]> }) {
  if (p.socketId === socket?.id || !Array.isArray(p.points)) return;
  cs().set({ lasers: { ...cs().lasers, [p.socketId]: restampLaser(p.points, Date.now()) } });
  ensureLaserPruning();
}

function ensureLaserPruning() {
  if (laserTimer) return;
  laserTimer = setInterval(() => {
    const now = Date.now();
    const lasers = cs().lasers;
    const next: Record<string, Array<[number, number, number]>> = {};
    let changed = false;
    for (const [k, pts] of Object.entries(lasers)) {
      const kept = pruneLaser(pts, now);
      if (kept.length !== pts.length) changed = true;
      if (kept.length) next[k] = kept;
    }
    if (changed) cs().set({ lasers: next });
    if (!Object.keys(next).length && laserTimer) {
      clearInterval(laserTimer);
      laserTimer = null;
    }
  }, 100);
}

// ---------------------------------------------------------------- join
function join(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!socket || !currentRoom) return reject(new Error('Not connected'));
    const roomId = currentRoom;
    const timer = setTimeout(() => reject(new Error('Joining the room timed out')), JOIN_TIMEOUT_MS);
    socket.emit('room:join', { roomId, user: cs().me }, (res) => {
      clearTimeout(timer);
      if (!res || !res.ok) {
        const msg = res && !res.ok ? res.error : 'Could not join the room';
        cs().set({ status: 'disconnected' });
        return reject(new Error(msg));
      }
      cs().set({ status: 'connected', role: res.role, roomId });
      if (res.role === 'view') canvas().setAppState({ viewModeEnabled: true });
      else if (res.drawingId) canvas().setAppState({ drawingId: res.drawingId });
      canvas().setAppState({ saveStatus: 'saved' });
      resolve();
    });
  });
}

function subscribeStores() {
  unsubs.push(
    useCanvasStore.subscribe(
      (s) => s.localNonce,
      () => scheduleFlush(),
    ),
  );
  // stop following when the user pans/zooms on their own
  unsubs.push(
    useCanvasStore.subscribe((s, prev) => {
      const a = s.appState, b = prev.appState;
      if (applyingFollow || !a.followingSocketId || a.followingSocketId !== b.followingSocketId) return;
      if (a.scrollX !== b.scrollX || a.scrollY !== b.scrollY || a.zoom !== b.zoom)
        canvas().setAppState({ followingSocketId: null });
    }),
  );
  // jump to the followed user's last known viewport immediately
  unsubs.push(
    useCanvasStore.subscribe(
      (s) => s.appState.followingSocketId,
      (id) => {
        const vp = id ? cs().pointers[id]?.viewport : undefined;
        if (vp) applyFollow(vp);
      },
    ),
  );
}

// ---------------------------------------------------------------- public API
export const collab = {
  /** join a room; resolves once the server acknowledged the join */
  async connect(roomId: string): Promise<void> {
    if (socket && currentRoom === roomId && cs().status !== 'disconnected') return;
    if (socket) collab.disconnect();
    currentRoom = roomId;
    known.clear();
    knownFiles.clear();
    joinedOnce = false;
    cs().set({ roomId, status: 'connecting', collaborators: [], pointers: {}, lasers: {} });
    const s = socketFactory();
    socket = s;
    s.on('scene:init', onSceneInit);
    s.on('scene:update', onSceneUpdate);
    s.on('files:add', (p) => addRemoteFiles(p.files));
    s.on('presence', onPresence);
    s.on('pointer:update', onPointer);
    s.on('laser:update', onLaser);
    s.on('room:error', (p) => toast(p.error || 'Collaboration error', 'error'));
    s.on('disconnect', (reason) => {
      if (socket !== s) return;
      // 'io client disconnect' = we called disconnect()
      cs().set({ status: reason === 'io client disconnect' ? 'disconnected' : 'reconnecting' });
    });
    subscribeStores();
    const first = new Promise<void>((resolve, reject) => {
      let initial = true;
      s.on('connect', () => {
        if (socket !== s) return;
        if (initial) {
          initial = false;
          join().then(resolve, reject);
        } else {
          // reconnect: re-join, then ask for the full scene; onSceneInit resends newer local elements
          cs().set({ status: 'connecting' });
          join()
            .then(() => s.emit('scene:sync', { roomId }))
            .catch((e: unknown) => toast(e instanceof Error ? e.message : 'Reconnect failed', 'error'));
        }
      });
      s.on('connect_error', (err) => {
        if (initial) {
          initial = false;
          cs().set({ status: 'reconnecting' });
          reject(new Error(`Cannot connect to the collaboration server (${err.message})`));
        }
      });
    });
    s.connect();
    try {
      await first;
    } catch (e) {
      // keep retrying in the background unless the room itself was refused
      if (!s.connected) cs().set({ status: 'reconnecting' });
      else collab.disconnect();
      throw e;
    }
  },

  disconnect(): void {
    const s = socket;
    if (s) {
      if (currentRoom && s.connected) s.emit('room:leave', { roomId: currentRoom });
      s.removeAllListeners();
      s.disconnect();
    }
    socket = null;
    currentRoom = null;
    scheduleFlush.cancel();
    unsubs.forEach((u) => u());
    unsubs = [];
    if (laserTimer) clearInterval(laserTimer);
    laserTimer = null;
    known.clear();
    knownFiles.clear();
    cs().set({ roomId: null, status: 'disconnected', role: 'edit', collaborators: [], pointers: {}, lasers: {} });
    if (canvas().appState.followingSocketId) canvas().setAppState({ followingSocketId: null });
  },

  sendPointer: throttle((p: PointerPayload) => {
    if (!socket || !currentRoom || !isConnected()) return;
    const a = canvas().appState;
    const pointer: PointerPayload = p.viewport
      ? p
      : { ...p, viewport: { scrollX: a.scrollX, scrollY: a.scrollY, zoom: a.zoom, width: a.width, height: a.height } };
    socket.emit('pointer:update', { roomId: currentRoom, pointer });
  }, POINTER_THROTTLE_MS),

  sendLaser: throttle((points: Array<[number, number, number]>) => {
    if (!socket || !currentRoom || !isConnected()) return;
    socket.emit('laser:update', { roomId: currentRoom, points: points.slice(-80) });
  }, POINTER_THROTTLE_MS),

  /** change own display name / color (persisted, broadcast) */
  updateUser(p: { name?: string; color?: string }): void {
    const me = { ...cs().me, ...p };
    cs().set({ me });
    try {
      localStorage.setItem('sketchboard:me', JSON.stringify(me));
    } catch {
      /* ignore */
    }
    if (socket && currentRoom && isConnected()) socket.emit('user:update', { roomId: currentRoom, name: me.name, color: me.color });
  },

  /** push pending local changes immediately */
  flush(): void {
    scheduleFlush.cancel();
    flushScene();
  },

  get roomId() {
    return currentRoom;
  },
  isConnected,
};

export type Collab = typeof collab;
