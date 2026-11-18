import type { SceneData } from '../../../shared/element';
import { createPrismaClient, type PrismaClient } from '../db/prisma';
import type { Prisma } from '../generated/prisma/client';
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

const summarySelect = {
  id: true,
  name: true,
  thumbnail: true,
  elementCount: true,
  createdAt: true,
  updatedAt: true,
} as const;

const versionSummarySelect = {
  id: true,
  drawingId: true,
  elementCount: true,
  label: true,
  createdAt: true,
} as const;

// Prisma's JSON input type is structural; SceneData is plain JSON by contract.
const toJson = (data: SceneData) => data as unknown as Prisma.InputJsonValue;
const fromJson = (data: unknown) => data as SceneData;

type DrawingRow = Omit<DrawingRecord, 'data'> & { data: unknown };
const toDrawing = (row: DrawingRow): DrawingRecord => ({ ...row, data: fromJson(row.data) });
const toShare = (row: { id: string; drawingId: string; mode: string; createdAt: Date }): ShareLinkRecord => ({
  ...row,
  mode: row.mode === 'edit' ? 'edit' : 'view',
});

export class PostgresRepository implements DrawingRepository {
  readonly kind = 'postgres' as const;
  readonly prisma: PrismaClient;

  constructor(connectionString: string) {
    this.prisma = createPrismaClient(connectionString);
  }

  async init(): Promise<void> {
    await this.prisma.$connect();
    await this.prisma.$queryRaw`SELECT 1`;
  }

  async ping(): Promise<boolean> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    await this.prisma.$disconnect();
  }

  async list(q: ListQuery): Promise<{ drawings: DrawingSummaryRecord[]; total: number }> {
    const where: Prisma.DrawingWhereInput = q.search
      ? { name: { contains: q.search, mode: 'insensitive' } }
      : {};
    const [drawings, total] = await this.prisma.$transaction([
      this.prisma.drawing.findMany({
        where,
        select: summarySelect,
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        take: q.limit,
        skip: q.offset,
      }),
      this.prisma.drawing.count({ where }),
    ]);
    return { drawings, total };
  }

  async create(input: CreateDrawingInput): Promise<DrawingRecord> {
    const row = await this.prisma.drawing.create({
      data: {
        name: input.name,
        data: toJson(input.data),
        thumbnail: input.thumbnail,
        elementCount: input.elementCount,
      },
    });
    return toDrawing(row);
  }

  async get(id: string): Promise<DrawingRecord | null> {
    const row = await this.prisma.drawing.findUnique({ where: { id } });
    return row ? toDrawing(row) : null;
  }

  async update(id: string, patch: UpdateDrawingInput, baseRevision?: number): Promise<DrawingRecord | null> {
    const data: Prisma.DrawingUpdateManyMutationInput = { revision: { increment: 1 } };
    if (patch.name !== undefined) data.name = patch.name;
    if (patch.data !== undefined) data.data = toJson(patch.data);
    if (patch.thumbnail !== undefined) data.thumbnail = patch.thumbnail;
    if (patch.elementCount !== undefined) data.elementCount = patch.elementCount;

    // updateMany with a revision guard makes the optimistic check atomic.
    const where: Prisma.DrawingWhereInput = { id };
    if (baseRevision !== undefined) where.revision = baseRevision;
    const { count } = await this.prisma.drawing.updateMany({ where, data });
    if (count === 0) {
      const current = await this.prisma.drawing.findUnique({ where: { id }, select: { revision: true } });
      if (!current) return null;
      throw new RevisionConflict(current.revision);
    }
    return this.get(id);
  }

  async delete(id: string): Promise<boolean> {
    const { count } = await this.prisma.drawing.deleteMany({ where: { id } });
    return count > 0;
  }

  async listVersions(drawingId: string): Promise<VersionSummaryRecord[]> {
    return this.prisma.drawingVersion.findMany({
      where: { drawingId },
      select: versionSummarySelect,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  }

  async getVersion(drawingId: string, versionId: string): Promise<VersionRecord | null> {
    const row = await this.prisma.drawingVersion.findFirst({ where: { id: versionId, drawingId } });
    return row ? { ...row, data: fromJson(row.data) } : null;
  }

  async createVersion(drawingId: string, input: CreateVersionInput): Promise<VersionSummaryRecord> {
    return this.prisma.drawingVersion.create({
      data: { drawingId, data: toJson(input.data), elementCount: input.elementCount, label: input.label },
      select: versionSummarySelect,
    });
  }

  async pruneVersions(drawingId: string, keep: number): Promise<number> {
    const stale = await this.prisma.drawingVersion.findMany({
      where: { drawingId },
      select: { id: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: keep,
    });
    if (stale.length === 0) return 0;
    const { count } = await this.prisma.drawingVersion.deleteMany({
      where: { id: { in: stale.map((v) => v.id) } },
    });
    return count;
  }

  async getShareLink(id: string): Promise<ShareLinkRecord | null> {
    const row = await this.prisma.shareLink.findUnique({ where: { id } });
    return row ? toShare(row) : null;
  }

  async findShareLink(drawingId: string, mode: ShareMode): Promise<ShareLinkRecord | null> {
    const row = await this.prisma.shareLink.findFirst({ where: { drawingId, mode }, orderBy: { createdAt: 'asc' } });
    return row ? toShare(row) : null;
  }

  async createShareLink(drawingId: string, mode: ShareMode): Promise<ShareLinkRecord> {
    return toShare(await this.prisma.shareLink.create({ data: { drawingId, mode } }));
  }
}
