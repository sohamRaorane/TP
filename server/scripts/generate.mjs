// Runs `prisma generate`. Prisma 7's client needs no native engine, but the CLI
// tries to download its schema engine first; on networks that block
// binaries.prisma.sh we retry with that download skipped.
import { spawnSync } from 'node:child_process';

const run = (env) =>
  spawnSync('npx', ['prisma', 'generate'], { stdio: 'inherit', shell: process.platform === 'win32', env: { ...process.env, ...env } });

let res = run({});
if (res.status !== 0) {
  console.warn('[generate] prisma engine download failed; retrying without it (client generation does not need it)');
  res = run({ PRISMA_SCHEMA_ENGINE_BINARY: process.execPath, PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING: '1' });
}
process.exit(res.status ?? 1);
