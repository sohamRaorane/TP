import { createServer } from './app';

const server = await createServer().catch((err: unknown) => {
  console.error('[server] failed to start:', err instanceof Error ? err.message : err);
  process.exit(1);
});

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[server] ${signal} received, flushing rooms and shutting down`);
  const force = setTimeout(() => {
    console.error('[server] shutdown timed out, exiting');
    process.exit(1);
  }, 10_000);
  force.unref();
  try {
    await server.close();
    process.exit(0);
  } catch (err) {
    console.error('[server] error during shutdown:', err);
    process.exit(1);
  }
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
