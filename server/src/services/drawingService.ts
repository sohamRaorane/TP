import { EventEmitter } from 'node:events';
import { sortByIndex } from '../../../shared/fractionalIndex';
import type { BinaryFiles, SceneData, SketchElement } from '../../../shared/element';
import type {
  Drawing,
  DrawingSummary,
  DrawingVersion,
  DrawingVersionSummary,
} from '../../../shared/protocol';
import type { ServerConfig } from '../config';
import {
  RevisionConflict,
  type DrawingRecord,
  type DrawingRepository,
  type DrawingSummaryRecord,
  type ShareMode,
  type VersionRecord,
  type VersionSummaryRecord,
} from './drawingRepository';
import { ConflictError, NotFoundError } from './errors';
import {
  buildRestoredScene,
  countVisible,
  emptyScene,
  pruneTombstones,
  reconcileElements,
  referencedFiles,
} from './scene';

export const DEFAULT_DRAWING_NAME = 'Untitled drawing';

export type ChangeSource = 'rest' | 'room';

export interface DrawingServiceEvents {
  /** a drawing's scene was replaced through REST (update / restore) */
  changed: [drawingId: string, data: SceneData, source: ChangeSource];
  deleted: [drawingId: string];
}

export type ServiceOptions = Pick<
  ServerConfig,
  'snapshotIntervalMs' | 'snapshotElementDelta' | 'maxVersions' | 'tombstoneTtlMs'
>;

// ------------------------------------------------------------- DTO mappers
export const toSummaryDto = (d: DrawingSummaryRecord): DrawingSummary => ({
  id: d.id,
  name: d.name,
  thumbnail: d.thumbnail,
  elementCount: d.elementCount,
  createdAt: d.createdAt.toISOString(),
  updatedAt: d.updatedAt.toISOString(),
});
export const toDrawingDto = (d: DrawingRecord): Drawing => ({
  ...toSummaryDto(d),
  data: d.data,
  revision: d.revision,
});
export const toVersionSummaryDto = (v: VersionSummaryRecord): DrawingVersionSummary => ({
  id: v.id,
  createdAt: v.createdAt.toISOString(),
  elementCount: v.elementCount,
  label: v.label,
});
export const toVersionDto = (v: VersionRecord): DrawingVersion => ({ ...toVersionSummaryDto(v), data: v.data });

export interface CreateInput {
  name?: string;
  data?: SceneData;
  thumbnail?: string | null;
}
export interface UpdateInput extends CreateInput {
  baseRevision?: number;
}

/** Business rules on top of a DrawingRepository (shared by both storage backends). */
export class DrawingService extends EventEmitter<DrawingServiceEvents> {
  constructor(
    readonly repo: DrawingRepository,
    private readonly opts: ServiceOptions,
  ) {
    super();
  }

  list(q: { search?: string; limit: number; offset: number }) {
    return this.repo.list(q);
  }

  async get(id: string): Promise<DrawingRecord> {
    const d = await this.repo.get(id);
    if (!d) throw new NotFoundError('Drawing');
    return d;
  }

  async create(input: CreateInput): Promise<DrawingRecord> {
    const data = input.data ?? emptyScene();
    const d = await this.repo.create({
      name: input.name ?? DEFAULT_DRAWING_NAME,
      data,
      thumbnail: input.thumbnail ?? null,
      elementCount: countVisible(data.elements),
    });
    if (data.elements.length > 0) await this.snapshot(d.id, data, null);
    return d;
  }

  async update(id: string, input: UpdateInput, source: ChangeSource = 'rest'): Promise<DrawingRecord> {
    let updated: DrawingRecord | null;
    try {
      updated = await this.repo.update(
        id,
        {
          name: input.name,
          data: input.data,
          thumbnail: input.thumbnail,
          elementCount: input.data ? countVisible(input.data.elements) : undefined,
        },
        input.baseRevision,
      );
    } catch (err) {
      if (err instanceof RevisionConflict) {
        throw new ConflictError('Drawing was modified by someone else', { currentRevision: err.currentRevision });
      }
      throw err;
    }
    if (!updated) throw new NotFoundError('Drawing');
    if (input.data) {
      await this.maybeSnapshot(updated);
      this.emit('changed', id, updated.data, source);
    }
    return updated;
  }

  async delete(id: string): Promise<void> {
    if (!(await this.repo.delete(id))) throw new NotFoundError('Drawing');
    this.emit('deleted', id);
  }

  async duplicate(id: string): Promise<DrawingRecord> {
    const src = await this.get(id);
    return this.create({ name: `${src.name} (copy)`, data: src.data, thumbnail: src.thumbnail });
  }

  async listVersions(id: string): Promise<VersionSummaryRecord[]> {
    await this.get(id);
    return this.repo.listVersions(id);
  }

  async getVersion(id: string, versionId: string): Promise<VersionRecord> {
    await this.get(id);
    const v = await this.repo.getVersion(id, versionId);
    if (!v) throw new NotFoundError('Version');
    return v;
  }

  async restore(id: string, versionId: string): Promise<DrawingRecord> {
    const current = await this.get(id);
    const version = await this.getVersion(id, versionId);
    await this.snapshot(id, current.data, 'Before restore');
    const data = buildRestoredScene(current.data, version.data);
    return this.update(id, { data });
  }

  async share(id: string, mode: ShareMode): Promise<{ roomId: string; mode: ShareMode }> {
    await this.get(id);
    if (mode === 'edit') return { roomId: id, mode };
    const link = (await this.repo.findShareLink(id, 'view')) ?? (await this.repo.createShareLink(id, 'view'));
    return { roomId: link.id, mode: 'view' };
  }

  /** Maps a collaboration room id to a drawing and role; null for ad-hoc rooms. */
  async resolveRoom(roomId: string): Promise<{ drawingId: string; role: ShareMode } | null> {
    const drawing = await this.repo.get(roomId);
    if (drawing) return { drawingId: drawing.id, role: 'edit' };
    const link = await this.repo.getShareLink(roomId);
    if (link) return { drawingId: link.drawingId, role: link.mode };
    return null;
  }

  /**
   * Persists a collaboration room's scene. Reconciles with what is stored
   * (so REST edits made meanwhile are not lost), drops old tombstones and
   * unreferenced files, keeps the stored appState. Returns null if the
   * drawing no longer exists.
   */
  async saveRoomScene(
    drawingId: string,
    elements: readonly SketchElement[],
    files: BinaryFiles,
  ): Promise<DrawingRecord | null> {
    const current = await this.repo.get(drawingId);
    if (!current) return null;
    const merged = reconcileElements(current.data.elements, elements).elements;
    // keep room order first, then elements only known to the stored copy
    const byId = new Map(merged.map((el) => [el.id, el]));
    const ordered: SketchElement[] = [];
    for (const el of elements) {
      const m = byId.get(el.id);
      if (m) {
        ordered.push(m);
        byId.delete(el.id);
      }
    }
    ordered.push(...byId.values());
    const kept = pruneTombstones(sortByIndex(ordered), this.opts.tombstoneTtlMs);
    const data: SceneData = {
      ...current.data,
      elements: kept,
      files: referencedFiles(kept, { ...current.data.files, ...files }),
    };
    try {
      return await this.update(drawingId, { data }, 'room');
    } catch (err) {
      if (err instanceof NotFoundError) return null;
      throw err;
    }
  }

  // ------------------------------------------------------------ versions
  private async snapshot(id: string, data: SceneData, label: string | null) {
    await this.repo.createVersion(id, { data, elementCount: countVisible(data.elements), label });
    await this.repo.pruneVersions(id, this.opts.maxVersions);
  }

  /** Snapshot if the newest one is old enough or the element count moved a lot. */
  private async maybeSnapshot(d: DrawingRecord) {
    const [latest] = await this.repo.listVersions(d.id);
    const due =
      !latest ||
      Date.now() - latest.createdAt.getTime() >= this.opts.snapshotIntervalMs ||
      Math.abs(d.elementCount - latest.elementCount) > this.opts.snapshotElementDelta;
    if (due) await this.snapshot(d.id, d.data, null);
  }
}
