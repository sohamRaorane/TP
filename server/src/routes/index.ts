import { Router } from 'express';
import { drawingsController } from '../controllers/drawingsController';
import type { DrawingService } from '../services/drawingService';

export function apiRouter(service: DrawingService): Router {
  const c = drawingsController(service);
  const r = Router();

  r.get('/health', async (_req, res) => {
    const storage = service.repo.kind;
    const db = storage === 'postgres' ? await service.repo.ping() : false;
    res.json({ ok: true, db, storage });
  });

  r.get('/drawings', c.list);
  r.post('/drawings', c.create);
  r.get('/drawings/:id', c.get);
  r.put('/drawings/:id', c.update);
  r.delete('/drawings/:id', c.remove);
  r.post('/drawings/:id/duplicate', c.duplicate);
  r.get('/drawings/:id/versions', c.listVersions);
  r.get('/drawings/:id/versions/:versionId', c.getVersion);
  r.post('/drawings/:id/versions/:versionId/restore', c.restoreVersion);
  r.post('/drawings/:id/share', c.share);
  return r;
}
