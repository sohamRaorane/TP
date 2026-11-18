import type { ServerConfig } from '../config';
import type { DrawingRepository } from '../services/drawingRepository';
import { FileRepository } from '../services/fileRepository';
import { PostgresRepository } from '../services/postgresRepository';
import { preparePostgres } from './migrate';

const redact = (url: string) => url.replace(/\/\/([^:@/]+):[^@/]*@/, '//$1:***@');

/**
 * Picks the storage backend:
 *  - 'postgres': Postgres or fail
 *  - 'file':     JSON files under DATA_DIR
 *  - 'auto':     Postgres if reachable (migrations applied), else files
 */
export async function createRepository(
  config: Pick<ServerConfig, 'storage' | 'databaseUrl' | 'dataDir'>,
  log: (msg: string) => void = console.log,
): Promise<DrawingRepository> {
  if (config.storage !== 'file') {
    try {
      const applied = await preparePostgres(config.databaseUrl);
      const repo = new PostgresRepository(config.databaseUrl);
      await repo.init();
      log(`[storage] postgres at ${redact(config.databaseUrl)} (migrations: ${applied.join(', ') || 'none'})`);
      return repo;
    } catch (err) {
      if (config.storage === 'postgres') {
        throw new Error(`STORAGE=postgres but Postgres is unreachable: ${(err as Error).message}`);
      }
      console.warn(
        `[storage] WARNING: Postgres unreachable at ${redact(config.databaseUrl)} (${(err as Error).message}). ` +
          `Falling back to file storage in ${config.dataDir}. Set STORAGE=postgres to make this fatal.`,
      );
    }
  }
  const repo = new FileRepository(config.dataDir);
  await repo.init();
  log(`[storage] file storage in ${config.dataDir}`);
  return repo;
}
