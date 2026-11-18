import type { SceneData } from '../../../shared/element';

export type StorageKind = 'postgres' | 'file';
export type ShareMode = 'edit' | 'view';

export interface DrawingSummaryRecord {
  id: string;
  name: string;
  thumbnail: string | null;
  elementCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface DrawingRecord extends DrawingSummaryRecord {
  data: SceneData;
  revision: number;
}

export interface VersionSummaryRecord {
  id: string;
  drawingId: string;
  elementCount: number;
  label: string | null;
  createdAt: Date;
}

export interface VersionRecord extends VersionSummaryRecord {
  data: SceneData;
}

export interface ShareLinkRecord {
  id: string;
  drawingId: string;
  mode: ShareMode;
  createdAt: Date;
}

export interface ListQuery {
  search?: string;
  limit: number;
  offset: number;
}

export interface CreateDrawingInput {
  name: string;
  data: SceneData;
  thumbnail: string | null;
  elementCount: number;
}

export interface UpdateDrawingInput {
  name?: string;
  data?: SceneData;
  thumbnail?: string | null;
  elementCount?: number;
}

export interface CreateVersionInput {
  data: SceneData;
  elementCount: number;
  label: string | null;
}

/** Thrown by `update` when `baseRevision` does not match the stored revision. */
export class RevisionConflict extends Error {
  constructor(public readonly currentRevision: number) {
    super('Revision conflict');
  }
}

/**
 * Storage abstraction. Implementations: PostgresRepository (Prisma) and
 * FileRepository (JSON files). Business rules (snapshots, restore, duplicate)
 * live in DrawingService so both behave identically.
 */
export interface DrawingRepository {
  readonly kind: StorageKind;
  init(): Promise<void>;
  /** true if the backing store is reachable */
  ping(): Promise<boolean>;
  close(): Promise<void>;

  list(q: ListQuery): Promise<{ drawings: DrawingSummaryRecord[]; total: number }>;
  create(input: CreateDrawingInput): Promise<DrawingRecord>;
  get(id: string): Promise<DrawingRecord | null>;
  /**
   * Updates the given fields and increments `revision`. Returns null if the
   * drawing does not exist. Throws RevisionConflict if `baseRevision` is
   * given and differs from the stored revision.
   */
  update(id: string, patch: UpdateDrawingInput, baseRevision?: number): Promise<DrawingRecord | null>;
  delete(id: string): Promise<boolean>;

  /** newest first */
  listVersions(drawingId: string): Promise<VersionSummaryRecord[]>;
  getVersion(drawingId: string, versionId: string): Promise<VersionRecord | null>;
  createVersion(drawingId: string, input: CreateVersionInput): Promise<VersionSummaryRecord>;
  /** keeps the newest `keep` versions, deletes the rest; returns number deleted */
  pruneVersions(drawingId: string, keep: number): Promise<number>;

  getShareLink(id: string): Promise<ShareLinkRecord | null>;
  findShareLink(drawingId: string, mode: ShareMode): Promise<ShareLinkRecord | null>;
  createShareLink(drawingId: string, mode: ShareMode): Promise<ShareLinkRecord>;
}
