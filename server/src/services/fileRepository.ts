import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  RevisionConflict,
  type CreateDrawingInput,
  type CreateVersionInput,
  type DrawingRecord,
  type DrawingRepository,
  type DrawingSummaryRecord,
  type ListQuery,
  type ShareLinkRecord,
  type ShareMode,
  type UpdateDrawingInput,
  type VersionRecord,
  type VersionSummaryRecord,
} from './drawingRepository';

/** On-disk JSON shapes (dates as ISO strings). */
type Stored<T> = { [K in keyof T]: T[K] extends Date ? string : T[K] };
type StoredDrawing = Stored<DrawingRecord>;
type StoredVersionSummary = Stored<VersionSummaryRecord>;
type StoredShareLink = Stored<ShareLinkRecord>;

const SAFE_ID = /^[A-Za-z0-9_-]{1,100}$/;

async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value));
  await fs.rename(tmp, file);
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

const toDrawing = (s: StoredDrawing): DrawingRecord => ({
  ...s,
  createdAt: new Date(s.createdAt),
  updatedAt: new Date(s.updatedAt),
});
const toSummary = (d: DrawingRecord): DrawingSummaryRecord => ({
  id: d.id,
  name: d.name,
  thumbnail: d.thumbnail,
  elementCount: d.elementCount,
  createdAt: d.createdAt,
  updatedAt: d.updatedAt,
});
const toVersionSummary = (s: StoredVersionSummary): VersionSummaryRecord => ({
  ...s,
  createdAt: new Date(s.createdAt),
});
const toShare = (s: StoredShareLink): ShareLinkRecord => ({ ...s, createdAt: new Date(s.createdAt) });

/**
 * JSON-file storage for machines without Postgres.
 * Layout under DATA_DIR:
 *   drawings/<id>.json              full drawing (incl. data)
 *   versions/<drawingId>/index.json version summaries (newest first)
 *   versions/<drawingId>/<vid>.json version data
 *   share-links.json                all share links
 * Writes are atomic (temp file + rename) and serialized through one queue,
 * so concurrent requests cannot interleave read-modify-write cycles.
 * Drawing summaries are cached in memory for listing.
 */
export class FileRepository implements DrawingRepository {
  readonly kind = 'file' as const;
  private summaries = new Map<string, DrawingSummaryRecord & { revision: number }>();
  private shareLinks: StoredShareLink[] = [];
  private queue: Promise<unknown> = Promise.resolve();

  constructor(readonly dataDir: string) {}

  private get drawingsDir() {
    return path.join(this.dataDir, 'drawings');
  }
  private get versionsRoot() {
    return path.join(this.dataDir, 'versions');
  }
  private get shareFile() {
    return path.join(this.dataDir, 'share-links.json');
  }
  private drawingFile(id: string) {
    return path.join(this.drawingsDir, `${id}.json`);
  }
  private versionsDir(drawingId: string) {
    return path.join(this.versionsRoot, drawingId);
  }

  /** Serializes mutations. */
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  async init(): Promise<void> {
    await fs.mkdir(this.drawingsDir, { recursive: true });
    await fs.mkdir(this.versionsRoot, { recursive: true });
    this.summaries.clear();
    for (const name of await fs.readdir(this.drawingsDir)) {
      if (!name.endsWith('.json')) continue;
      try {
        const stored = await readJson<StoredDrawing>(path.join(this.drawingsDir, name));
        if (stored) {
          const d = toDrawing(stored);
          this.summaries.set(d.id, { ...toSummary(d), revision: d.revision });
        }
      } catch (err) {
        console.warn(`[file-repo] skipping unreadable ${name}:`, (err as Error).message);
      }
    }
    this.shareLinks = (await readJson<StoredShareLink[]>(this.shareFile)) ?? [];
  }

  async ping(): Promise<boolean> {
    try {
      await fs.access(this.dataDir);
      return true;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    await this.queue;
  }

  async list(q: ListQuery): Promise<{ drawings: DrawingSummaryRecord[]; total: number }> {
    const needle = q.search?.toLowerCase();
    const all = [...this.summaries.values()]
      .filter((s) => !needle || s.name.toLowerCase().includes(needle))
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime() || a.id.localeCompare(b.id));
    return {
      total: all.length,
      drawings: all.slice(q.offset, q.offset + q.limit).map(({ revision: _r, ...s }) => s),
    };
  }

  private async save(d: DrawingRecord): Promise<void> {
    const stored: StoredDrawing = { ...d, createdAt: d.createdAt.toISOString(), updatedAt: d.updatedAt.toISOString() };
    await writeJsonAtomic(this.drawingFile(d.id), stored);
    this.summaries.set(d.id, { ...toSummary(d), revision: d.revision });
  }

  create(input: CreateDrawingInput): Promise<DrawingRecord> {
    return this.exclusive(async () => {
      const now = new Date();
      const d: DrawingRecord = {
        id: randomUUID(),
        name: input.name,
        data: input.data,
        thumbnail: input.thumbnail,
        elementCount: input.elementCount,
        revision: 1,
        createdAt: now,
        updatedAt: now,
      };
      await this.save(d);
      return d;
    });
  }

  async get(id: string): Promise<DrawingRecord | null> {
    if (!SAFE_ID.test(id) || !this.summaries.has(id)) return null;
    const stored = await readJson<StoredDrawing>(this.drawingFile(id));
    return stored ? toDrawing(stored) : null;
  }

  update(id: string, patch: UpdateDrawingInput, baseRevision?: number): Promise<DrawingRecord | null> {
    return this.exclusive(async () => {
      const current = await this.get(id);
      if (!current) return null;
      if (baseRevision !== undefined && baseRevision !== current.revision) {
        throw new RevisionConflict(current.revision);
      }
      // updatedAt must strictly increase so list ordering is stable.
      const now = Math.max(Date.now(), current.updatedAt.getTime() + 1);
      const next: DrawingRecord = {
        ...current,
        ...(patch.name !== undefined && { name: patch.name }),
        ...(patch.data !== undefined && { data: patch.data }),
        ...(patch.thumbnail !== undefined && { thumbnail: patch.thumbnail }),
        ...(patch.elementCount !== undefined && { elementCount: patch.elementCount }),
        revision: current.revision + 1,
        updatedAt: new Date(now),
      };
      await this.save(next);
      return next;
    });
  }

  delete(id: string): Promise<boolean> {
    return this.exclusive(async () => {
      if (!SAFE_ID.test(id) || !this.summaries.has(id)) return false;
      await fs.rm(this.drawingFile(id), { force: true });
      await fs.rm(this.versionsDir(id), { recursive: true, force: true });
      this.summaries.delete(id);
      const before = this.shareLinks.length;
      this.shareLinks = this.shareLinks.filter((l) => l.drawingId !== id);
      if (this.shareLinks.length !== before) await writeJsonAtomic(this.shareFile, this.shareLinks);
      return true;
    });
  }

  private async readVersionIndex(drawingId: string): Promise<StoredVersionSummary[]> {
    if (!SAFE_ID.test(drawingId)) return [];
    return (await readJson<StoredVersionSummary[]>(path.join(this.versionsDir(drawingId), 'index.json'))) ?? [];
  }

  async listVersions(drawingId: string): Promise<VersionSummaryRecord[]> {
    return (await this.readVersionIndex(drawingId)).map(toVersionSummary);
  }

  async getVersion(drawingId: string, versionId: string): Promise<VersionRecord | null> {
    if (!SAFE_ID.test(drawingId) || !SAFE_ID.test(versionId)) return null;
    const summary = (await this.readVersionIndex(drawingId)).find((v) => v.id === versionId);
    if (!summary) return null;
    const data = await readJson<VersionRecord['data']>(path.join(this.versionsDir(drawingId), `${versionId}.json`));
    return data ? { ...toVersionSummary(summary), data } : null;
  }

  createVersion(drawingId: string, input: CreateVersionInput): Promise<VersionSummaryRecord> {
    return this.exclusive(async () => {
      if (!this.summaries.has(drawingId)) throw new Error(`Drawing ${drawingId} not found`);
      const dir = this.versionsDir(drawingId);
      await fs.mkdir(dir, { recursive: true });
      const index = await this.readVersionIndex(drawingId);
      const newest = index[0] ? new Date(index[0].createdAt).getTime() : 0;
      const summary: StoredVersionSummary = {
        id: randomUUID(),
        drawingId,
        elementCount: input.elementCount,
        label: input.label,
        createdAt: new Date(Math.max(Date.now(), newest + 1)).toISOString(),
      };
      await writeJsonAtomic(path.join(dir, `${summary.id}.json`), input.data);
      await writeJsonAtomic(path.join(dir, 'index.json'), [summary, ...index]);
      return toVersionSummary(summary);
    });
  }

  pruneVersions(drawingId: string, keep: number): Promise<number> {
    return this.exclusive(async () => {
      const index = await this.readVersionIndex(drawingId);
      if (index.length <= keep) return 0;
      const dir = this.versionsDir(drawingId);
      const stale = index.slice(keep);
      await writeJsonAtomic(path.join(dir, 'index.json'), index.slice(0, keep));
      await Promise.all(stale.map((v) => fs.rm(path.join(dir, `${v.id}.json`), { force: true })));
      return stale.length;
    });
  }

  async getShareLink(id: string): Promise<ShareLinkRecord | null> {
    const link = this.shareLinks.find((l) => l.id === id);
    return link ? toShare(link) : null;
  }

  async findShareLink(drawingId: string, mode: ShareMode): Promise<ShareLinkRecord | null> {
    const link = this.shareLinks.find((l) => l.drawingId === drawingId && l.mode === mode);
    return link ? toShare(link) : null;
  }

  createShareLink(drawingId: string, mode: ShareMode): Promise<ShareLinkRecord> {
    return this.exclusive(async () => {
      if (!this.summaries.has(drawingId)) throw new Error(`Drawing ${drawingId} not found`);
      const link: StoredShareLink = { id: randomUUID(), drawingId, mode, createdAt: new Date().toISOString() };
      this.shareLinks = [...this.shareLinks, link];
      await writeJsonAtomic(this.shareFile, this.shareLinks);
      return toShare(link);
    });
  }
}
