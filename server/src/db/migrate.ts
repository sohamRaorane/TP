import fs from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { SERVER_ROOT } from '../config';

export const MIGRATIONS_DIR = path.join(SERVER_ROOT, 'prisma', 'migrations');

/**
 * Applies every prisma/migrations/<name>/migration.sql in name order. The SQL
 * files are written idempotently (CREATE ... IF NOT EXISTS), so this runs on
 * every startup and makes a fresh database usable without the Prisma CLI.
 */
export async function applyMigrations(client: pg.Pool | pg.Client, dir = MIGRATIONS_DIR): Promise<string[]> {
  let entries: string[];
  try {
    entries = (await fs.readdir(dir, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
  const applied: string[] = [];
  for (const name of entries) {
    const file = path.join(dir, name, 'migration.sql');
    let sql: string;
    try {
      sql = await fs.readFile(file, 'utf8');
    } catch {
      continue;
    }
    await client.query(sql);
    applied.push(name);
  }
  return applied;
}

/** Connects, runs `SELECT 1`, applies migrations. Throws if Postgres is unreachable. */
export async function preparePostgres(connectionString: string, timeoutMs = 3000): Promise<string[]> {
  const client = new pg.Client({ connectionString, connectionTimeoutMillis: timeoutMs });
  await client.connect();
  try {
    await client.query('SELECT 1');
    return await applyMigrations(client);
  } finally {
    await client.end().catch(() => undefined);
  }
}
