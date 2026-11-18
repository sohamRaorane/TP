# Sketchboard server

Express 5 + Socket.IO 4 backend for Sketchboard. It implements the REST and
real-time contract in [`../shared/protocol.ts`](../shared/protocol.ts) and
stores drawings in Postgres (Prisma 7) or, when Postgres is unavailable, in
JSON files.

## Quick start

```bash
cd server
npm install          # also runs `prisma generate`
npm run dev          # http://localhost:4000, restarts on change
```

With no database running the server still starts: it logs a warning and uses
file storage under `./data`.

## Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `4000` | HTTP + Socket.IO port |
| `HOST` | all interfaces | Bind address |
| `DATABASE_URL` | `postgresql://sketch:sketch@localhost:5432/sketchboard` | Postgres connection string |
| `STORAGE` | `auto` | `postgres`, `file` or `auto` (see below) |
| `DATA_DIR` | `./data` | Folder for file storage (relative to `server/`) |
| `CORS_ORIGIN` | any `http(s)://localhost:*` / `127.0.0.1:*` | Comma-separated origins, or `*` |
| `NODE_ENV` | `development` | `production` serves the built client from `CLIENT_DIST` |
| `CLIENT_DIST` | `../dist` | Built client folder (SPA fallback to `index.html`) |
| `LOG_REQUESTS` | on (off when `NODE_ENV=test`) | One log line per `/api` request |
| `PERSIST_DEBOUNCE_MS` | `2000` | Collaboration save debounce |
| `PERSIST_MAX_WAIT_MS` | `10000` | Longest a dirty room waits before it is saved |
| `ROOM_EVICT_MS` | `60000` | Empty rooms are dropped from memory after this |
| `MAX_UPDATES_PER_SECOND` | `60` | Per-socket `scene:update` rate limit (extra messages are dropped) |

A `.env` file in `server/` is loaded automatically.

## Storage modes

- `postgres`: connect, run `SELECT 1`, apply `prisma/migrations/*/migration.sql`
  (idempotent `IF NOT EXISTS` SQL), or exit with an error.
- `file`: JSON files in `DATA_DIR` (`drawings/<id>.json`,
  `versions/<drawingId>/…`, `share-links.json`). Writes are atomic (temp file
  and rename) and serialized in-process. Use one server process per folder.
- `auto` (default): Postgres if reachable, otherwise file storage with a warning.

Because migrations are applied on startup, a fresh database needs no Prisma
CLI. `npm run db:push` / `db:migrate` remain available when you change the schema.

`GET /api/health` returns `{ ok: true, db: boolean, storage: 'postgres' | 'file' }`.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | `tsx watch src/index.ts` |
| `npm start` | Run once with tsx (Ctrl-C flushes collaboration rooms first) |
| `npm test` | Vitest: REST suite against Postgres and files, Socket.IO, storage selection |
| `npm run typecheck` | `tsc --noEmit -p .` |
| `npm run generate` | `prisma generate` (output: `src/generated/prisma`, gitignored) |

Tests use `TEST_DATABASE_URL` (default
`postgresql://sketch:sketch@localhost:5432/sketchboard_test`) and truncate its
tables, so never point it at real data.

## REST API (`/api`)

Errors are always `{ error: string, details?: unknown }`: 400 for validation
errors (zod issues in `details`) or malformed JSON, 404, 409 for a revision
conflict (`details.currentRevision`), 413 for bodies over 25 MB, 500.

| Method and path | Body | Result |
|---|---|---|
| `GET /health` | | `{ ok, db, storage }` |
| `GET /drawings?search=&limit=50&offset=0` | | `{ drawings: DrawingSummary[], total }`, newest first; `search` is a case-insensitive substring match on name |
| `POST /drawings` | `{ name?, data?, thumbnail? }` | `201 Drawing` (empty scene by default) |
| `GET /drawings/:id` | | `Drawing` |
| `PUT /drawings/:id` | `{ name?, data?, thumbnail?, baseRevision? }` | `Drawing`; `revision` +1; 409 if `baseRevision` is stale |
| `DELETE /drawings/:id` | | `204` |
| `POST /drawings/:id/duplicate` | | `201 Drawing` named `"<name> (copy)"` |
| `GET /drawings/:id/versions` | | `{ versions: DrawingVersionSummary[] }`, newest first |
| `GET /drawings/:id/versions/:versionId` | | `DrawingVersion` |
| `POST /drawings/:id/versions/:versionId/restore` | | `Drawing` |
| `POST /drawings/:id/share` | `{ mode: 'edit' \| 'view' }` | `{ roomId, mode, url }` |

Notes:
- `elementCount` counts non-deleted elements.
- **Versions:** a snapshot is taken on save when the newest one is older than
  5 minutes or the element count moved by more than 20. At most 50 are kept per
  drawing, and the oldest are deleted first.
- **Restore** first saves the current state as a version labelled
  `Before restore`. Restored elements get versions above the current ones, and
  elements missing from the snapshot become tombstones, so live collaborators
  accept the restore.
- **Share:** `edit` returns `roomId = drawing id`. `view` creates, or reuses,
  an opaque `ShareLink` id. `url` is `<Origin>/?room=<roomId>`.

## Real-time collaboration (Socket.IO, namespace `/`)

- `room:join { roomId, user }` → ack `{ ok, role, drawingId }`, then
  `scene:init` to the joiner and `presence` to the room. A drawing id gives an
  `edit` role. A view `ShareLink` id gives a `view` role in the same room as the
  drawing. Any other id is an ad-hoc, memory-only room (`drawingId: null`).
- `scene:update` is validated (≤ 5000 elements) and reconciled with
  `shouldAcceptRemote`. Only the accepted elements are broadcast to the others
  with `from = socket.id`. New ids are appended, and existing elements keep their
  order. View-role sockets get `room:error`.
- `files:add` (≤ 10 MB per message, edit role only) is relayed to the others.
- `scene:sync` → `scene:init` with the full scene, including tombstones.
- `pointer:update` and `laser:update` are relayed as volatile messages.
- `user:update` updates the user's name and color and sends `presence`.
- Dirty rooms are saved with a 2 s debounce (10 s max wait), and right away when
  the last user leaves. The save merges with the stored drawing, keeps
  tombstones from the last hour, drops unreferenced files and bumps `revision`.
  Empty rooms are evicted after 60 s.
- REST updates to a drawing that has a live room are pushed to its clients as
  `scene:update` with `from: 'server'`.
- SIGINT and SIGTERM save every dirty room before the process exits.

## Docker

Build from the repository root, because the server imports `../shared`:

```bash
docker build -f server/Dockerfile -t sketchboard-server .
docker run -p 4000:4000 -e DATABASE_URL=postgresql://… sketchboard-server
```

File storage lives in the `/app/server/data` volume.
