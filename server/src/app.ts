import cors from 'cors';
import express, { type Express } from 'express';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { Server } from 'socket.io';
import { loadConfig, type ServerConfig, type StorageMode } from './config';
import { createRepository } from './db/storage';
import { errorHandler, notFoundHandler, requestLogger } from './middleware/errors';
import { apiRouter } from './routes';
import type { DrawingRepository } from './services/drawingRepository';
import { DrawingService } from './services/drawingService';
import { CollaborationHub, type CollabServer } from './sockets/collaboration';

export const JSON_LIMIT = '25mb';
/** Socket.IO message cap: 10MB of files + base64/JSON overhead. */
export const SOCKET_MAX_BUFFER = 16 * 1024 * 1024;

export function createApp(service: DrawingService, config: ServerConfig): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
  if (config.logRequests) app.use('/api', requestLogger);
  app.use('/api', cors({ origin: config.corsOrigin }));
  app.use('/api', express.json({ limit: JSON_LIMIT }));
  app.use('/api', apiRouter(service));
  app.use('/api', notFoundHandler);

  const indexHtml = path.join(config.clientDist, 'index.html');
  if (config.nodeEnv === 'production' && fs.existsSync(indexHtml)) {
    app.use(express.static(config.clientDist, { index: false, maxAge: '1h' }));
    // SPA fallback for client-side routes
    app.use((req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      if (req.path.startsWith('/socket.io')) return next();
      res.sendFile(indexHtml);
    });
  }
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

export interface CreateServerOptions extends Partial<ServerConfig> {
  storage?: StorageMode;
  /** inject a ready repository (skips storage selection) */
  repository?: DrawingRepository;
  /** suppress startup logs */
  quiet?: boolean;
}

export interface RunningServer {
  app: Express;
  httpServer: http.Server;
  io: CollabServer;
  hub: CollaborationHub;
  service: DrawingService;
  repo: DrawingRepository;
  config: ServerConfig;
  port: number;
  url: string;
  close(): Promise<void>;
}

/** Builds storage, Express, Socket.IO and starts listening (port 0 = ephemeral). */
export async function createServer(options: CreateServerOptions = {}): Promise<RunningServer> {
  const { repository, quiet, ...overrides } = options;
  const config: ServerConfig = { ...loadConfig(), ...overrides };
  const log = quiet ? () => undefined : (msg: string) => console.log(msg);

  const repo = repository ?? (await createRepository(config, log));
  const service = new DrawingService(repo, config);
  const app = createApp(service, config);
  const httpServer = http.createServer(app);
  const io: CollabServer = new Server(httpServer, {
    cors: { origin: config.corsOrigin },
    maxHttpBufferSize: SOCKET_MAX_BUFFER,
  });
  const hub = new CollaborationHub(io, service, config);

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(config.port, config.host, () => {
      httpServer.off('error', reject);
      resolve();
    });
  });
  const port = (httpServer.address() as AddressInfo).port;
  const displayHost = !config.host || config.host === '0.0.0.0' || config.host === '::' ? 'localhost' : config.host;
  const url = `http://${displayHost}:${port}`;
  log(`[server] listening on ${url} (storage: ${repo.kind})`);

  let closing: Promise<void> | null = null;
  const close = () =>
    (closing ??= (async () => {
      await hub.close();
      await new Promise<void>((resolve) => io.close(() => resolve()));
      httpServer.closeAllConnections?.();
      await repo.close();
    })());

  return { app, httpServer, io, hub, service, repo, config, port, url, close };
}
