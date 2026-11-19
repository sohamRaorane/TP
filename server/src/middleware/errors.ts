import type { ErrorRequestHandler, RequestHandler } from 'express';
import { HttpError } from '../services/errors';

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({ error: `Not found: ${req.method} ${req.originalUrl.split('?')[0]}` });
};

interface BodyParserError extends Error {
  type?: string;
  status?: number;
  limit?: number;
}

export const errorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  if (res.headersSent) return next(err);
  if (err instanceof HttpError) {
    res.status(err.status).json(err.details === undefined ? { error: err.message } : { error: err.message, details: err.details });
    return;
  }
  const e = err as BodyParserError;
  if (e?.type === 'entity.too.large') {
    res.status(413).json({ error: 'Payload too large', details: { limit: e.limit } });
    return;
  }
  if (e?.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'Malformed JSON body' });
    return;
  }
  if (typeof e?.status === 'number' && e.status >= 400 && e.status < 500) {
    res.status(e.status).json({ error: e.message || 'Bad request' });
    return;
  }
  console.error('[http] unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
};

export const requestLogger: RequestHandler = (req, res, next) => {
  const start = performance.now();
  res.on('finish', () => {
    const ms = (performance.now() - start).toFixed(1);
    console.log(`[http] ${req.method} ${req.originalUrl} ${res.statusCode} ${ms}ms`);
  });
  next();
};
