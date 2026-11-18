import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseCorsOrigin } from '../config';
import { POSTGRES_AVAILABLE, TEST_DATABASE_URL } from '../test/helpers';
import { createRepository } from './storage';

const dirs: string[] = [];
const tmp = async () => {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), 'sketchboard-storage-'));
  dirs.push(d);
  return d;
};
afterEach(async () => {
  vi.restoreAllMocks();
  for (const d of dirs.splice(0)) await fs.rm(d, { recursive: true, force: true });
});

const UNREACHABLE = 'postgresql://sketch:sketch@127.0.0.1:1/nope';

describe('storage selection', () => {
  it.skipIf(!POSTGRES_AVAILABLE)('auto uses Postgres when reachable (and applies migrations)', async () => {
    const repo = await createRepository({ storage: 'auto', databaseUrl: TEST_DATABASE_URL, dataDir: await tmp() }, () => {});
    expect(repo.kind).toBe('postgres');
    expect(await repo.ping()).toBe(true);
    await repo.close();
  });

  it('auto falls back to file storage with a warning when Postgres is down', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const dataDir = await tmp();
    const repo = await createRepository({ storage: 'auto', databaseUrl: UNREACHABLE, dataDir }, () => {});
    expect(repo.kind).toBe('file');
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/Falling back to file storage/));
    expect(warn.mock.calls[0]![0]).not.toContain('sketch:sketch'); // password redacted
    await repo.close();
  });

  it('postgres mode fails hard when unreachable', async () => {
    await expect(createRepository({ storage: 'postgres', databaseUrl: UNREACHABLE, dataDir: await tmp() }, () => {})).rejects.toThrow(
      /STORAGE=postgres/,
    );
  });

  it('file repository survives a restart', async () => {
    const dataDir = await tmp();
    const repo = await createRepository({ storage: 'file', databaseUrl: UNREACHABLE, dataDir }, () => {});
    const d = await repo.create({ name: 'Persisted', data: { type: 'sketchboard', version: 1, elements: [], appState: {}, files: {} }, thumbnail: null, elementCount: 0 });
    await repo.createShareLink(d.id, 'view');
    await repo.close();
    const again = await createRepository({ storage: 'file', databaseUrl: UNREACHABLE, dataDir }, () => {});
    expect((await again.get(d.id))?.name).toBe('Persisted');
    expect((await again.findShareLink(d.id, 'view'))?.drawingId).toBe(d.id);
    expect((await fs.readdir(path.join(dataDir, 'drawings'))).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });
});

describe('config', () => {
  it('parses CORS_ORIGIN', () => {
    const [localhost] = parseCorsOrigin(undefined) as RegExp[];
    expect(localhost!.test('http://localhost:5173')).toBe(true);
    expect(localhost!.test('http://evil.com')).toBe(false);
    expect(parseCorsOrigin('*')).toBe(true);
    expect(parseCorsOrigin('https://a.com, https://b.com')).toEqual(['https://a.com', 'https://b.com']);
  });
});
