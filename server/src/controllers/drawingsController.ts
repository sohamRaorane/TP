import type { Request, Response } from 'express';
import type { SceneData } from '../../../shared/element';
import { parseOr400 } from '../middleware/validate';
import {
  toDrawingDto,
  toSummaryDto,
  toVersionDto,
  toVersionSummaryDto,
  type DrawingService,
} from '../services/drawingService';
import {
  createDrawingSchema,
  idParams,
  listQuerySchema,
  shareSchema,
  updateDrawingSchema,
  versionParams,
} from './schemas';

/** Origin used to build share URLs: the browser's Origin, else this host. */
function publicOrigin(req: Request): string {
  const origin = req.get('origin');
  if (origin && /^https?:\/\/[^/\s]+$/.test(origin)) return origin;
  return `${req.protocol}://${req.get('host') ?? 'localhost'}`;
}

export function drawingsController(service: DrawingService) {
  return {
    async list(req: Request, res: Response) {
      const q = parseOr400(listQuerySchema, req.query, 'query');
      const { drawings, total } = await service.list({ search: q.search || undefined, limit: q.limit, offset: q.offset });
      res.json({ drawings: drawings.map(toSummaryDto), total });
    },

    async create(req: Request, res: Response) {
      const body = parseOr400(createDrawingSchema, req.body ?? {}, 'body');
      const d = await service.create({ ...body, data: body.data as SceneData | undefined });
      res.status(201).json(toDrawingDto(d));
    },

    async get(req: Request, res: Response) {
      const { id } = parseOr400(idParams, req.params, 'params');
      res.json(toDrawingDto(await service.get(id)));
    },

    async update(req: Request, res: Response) {
      const { id } = parseOr400(idParams, req.params, 'params');
      const body = parseOr400(updateDrawingSchema, req.body ?? {}, 'body');
      const d = await service.update(id, { ...body, data: body.data as SceneData | undefined });
      res.json(toDrawingDto(d));
    },

    async remove(req: Request, res: Response) {
      const { id } = parseOr400(idParams, req.params, 'params');
      await service.delete(id);
      res.status(204).end();
    },

    async duplicate(req: Request, res: Response) {
      const { id } = parseOr400(idParams, req.params, 'params');
      res.status(201).json(toDrawingDto(await service.duplicate(id)));
    },

    async listVersions(req: Request, res: Response) {
      const { id } = parseOr400(idParams, req.params, 'params');
      res.json({ versions: (await service.listVersions(id)).map(toVersionSummaryDto) });
    },

    async getVersion(req: Request, res: Response) {
      const { id, versionId } = parseOr400(versionParams, req.params, 'params');
      res.json(toVersionDto(await service.getVersion(id, versionId)));
    },

    async restoreVersion(req: Request, res: Response) {
      const { id, versionId } = parseOr400(versionParams, req.params, 'params');
      res.json(toDrawingDto(await service.restore(id, versionId)));
    },

    async share(req: Request, res: Response) {
      const { id } = parseOr400(idParams, req.params, 'params');
      const { mode } = parseOr400(shareSchema, req.body ?? {}, 'body');
      const link = await service.share(id, mode);
      res.json({ ...link, url: `${publicOrigin(req)}/?room=${encodeURIComponent(link.roomId)}` });
    },
  };
}
