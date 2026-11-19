import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type StorageMode = 'postgres' | 'file' | 'auto';

/** Absolute path of the server package root (the folder holding package.json). */
export const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export interface ServerConfig {
  port: number;
  host: string | undefined;
  databaseUrl: string;
  /** Origins allowed by CORS (REST + Socket.IO). */
  corsOrigin: CorsOrigin;
  storage: StorageMode;
  dataDir: string;
  nodeEnv: string;
  /** Folder with the built client (served only when nodeEnv === 'production'). */
  clientDist: string;
  logRequests: boolean;
  /** Collaboration persistence tuning (ms). */
  persistDebounceMs: number;
  persistMaxWaitMs: number;
  roomEvictMs: number;
  /** Max scene:update messages per socket per second. */
  maxUpdatesPerSecond: number;
  /** Version snapshot policy. */
  snapshotIntervalMs: number;
  snapshotElementDelta: number;
  maxVersions: number;
  /** Tombstones (isDeleted) older than this are dropped when a room is persisted. */
  tombstoneTtlMs: number;
}

export type CorsOrigin = (string | RegExp)[] | true;

const DEFAULT_DATABASE_URL = 'postgresql://sketch:sketch@localhost:5432/sketchboard';
const LOCALHOST_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

function int(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? Math.floor(n) : fallback;
}

export function parseCorsOrigin(value: string | undefined): CorsOrigin {
  if (!value) return [LOCALHOST_ORIGIN];
  if (value.trim() === '*') return true;
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseStorage(value: string | undefined): StorageMode {
  if (value === 'postgres' || value === 'file' || value === 'auto') return value;
  if (value) console.warn(`[config] Unknown STORAGE="${value}", using "auto"`);
  return 'auto';
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  return {
    port: int(env.PORT, 4000),
    host: env.HOST || undefined,
    databaseUrl: env.DATABASE_URL || DEFAULT_DATABASE_URL,
    corsOrigin: parseCorsOrigin(env.CORS_ORIGIN),
    storage: parseStorage(env.STORAGE),
    dataDir: path.resolve(SERVER_ROOT, env.DATA_DIR || './data'),
    nodeEnv: env.NODE_ENV || 'development',
    clientDist: path.resolve(SERVER_ROOT, env.CLIENT_DIST || '../dist'),
    logRequests: env.LOG_REQUESTS ? env.LOG_REQUESTS !== 'false' : env.NODE_ENV !== 'test',
    persistDebounceMs: int(env.PERSIST_DEBOUNCE_MS, 2000),
    persistMaxWaitMs: int(env.PERSIST_MAX_WAIT_MS, 10_000),
    roomEvictMs: int(env.ROOM_EVICT_MS, 60_000),
    maxUpdatesPerSecond: int(env.MAX_UPDATES_PER_SECOND, 60),
    snapshotIntervalMs: 5 * 60_000,
    snapshotElementDelta: 20,
    maxVersions: 50,
    tombstoneTtlMs: 60 * 60_000,
  };
}
