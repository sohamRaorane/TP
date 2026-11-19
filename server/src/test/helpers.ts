import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import type { SceneData, SketchElement } from '../../../shared/element';
import { createServer, type CreateServerOptions, type RunningServer } from '../app';
import { applyMigrations } from '../db/migrate';

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://sketch:sketch@localhost:5432/sketchboard_test';

export type Backend = 'postgres' | 'file';

/** Postgres-backed suites run only when the test database is reachable (file-storage suites always run). */
export const POSTGRES_AVAILABLE: boolean = await (async () => {
  const client = new pg.Client({ connectionString: TEST_DATABASE_URL, connectionTimeoutMillis: 1500 });
  try {
    await client.connect();
    await client.query('SELECT 1');
    return true;
  } catch {
    console.warn(`[tests] Postgres not reachable at ${TEST_DATABASE_URL.replace(/:[^:@/]+@/, ':***@')}; skipping Postgres suites`);
    return false;
  } finally {
    await client.end().catch(() => {});
  }
})();
export const BACKENDS: Backend[] = POSTGRES_AVAILABLE ? ['postgres', 'file'] : ['file'];
export const DEFAULT_BACKEND: Backend = POSTGRES_AVAILABLE ? 'postgres' : 'file';

let seq = 0;
export function makeElement(overrides: Partial<SketchElement> & { id?: string } = {}): SketchElement {
  seq++;
  return {
    id: `el-${seq}`,
    type: 'rectangle',
    x: 10 * seq,
    y: 20,
    width: 100,
    height: 50,
    angle: 0,
    strokeColor: '#1e1e1e',
    backgroundColor: 'transparent',
    fillStyle: 'hachure',
    strokeWidth: 2,
    strokeStyle: 'solid',
    roughness: 1,
    opacity: 100,
    roundness: false,
    locked: false,
    groupIds: [],
    frameId: null,
    boundElements: [],
    link: null,
    seed: 1000 + seq,
    version: 1,
    versionNonce: 500,
    isDeleted: false,
    updated: Date.now(),
    ...overrides,
  } as SketchElement;
}

export const scene = (elements: SketchElement[], extra: Partial<SceneData> = {}): SceneData => ({
  type: 'sketchboard',
  version: 1,
  elements,
  appState: {},
  files: {},
  ...extra,
});

export async function resetPostgres(): Promise<void> {
  const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  try {
    await applyMigrations(client);
    await client.query('TRUNCATE "ShareLink", "DrawingVersion", "Drawing" CASCADE');
  } finally {
    await client.end();
  }
}

/** Starts a server on an ephemeral port with the given backend (fresh DB / temp dir). */
export async function startTestServer(
  backend: Backend,
  overrides: CreateServerOptions = {},
): Promise<RunningServer & { cleanup(): Promise<void> }> {
  let dataDir: string | undefined;
  if (backend === 'postgres') await resetPostgres();
  else dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sketchboard-test-'));
  const server = await createServer({
    port: 0,
    host: '127.0.0.1',
    storage: backend,
    databaseUrl: TEST_DATABASE_URL,
    dataDir: dataDir ?? os.tmpdir(),
    logRequests: false,
    quiet: true,
    ...overrides,
  });
  return {
    ...server,
    async cleanup() {
      await server.close();
      if (dataDir) await fs.rm(dataDir, { recursive: true, force: true });
    },
  };
}
