# Sketchboard: team contracts and ownership

Sketchboard is an Excalidraw-style collaborative whiteboard. Several engineers (agents) build it in parallel, each on their own git branch and in their own folders. This file is the single source of truth for who owns what and how the parts talk to each other.

## Git flow
- `main` holds releases only. `develop` is the integration branch.
- Every agent works on its own `feature/<area>` branch in its own git worktree.
- Commit often with small, meaningful messages, using the `feat(engine): ...` / `fix(ui): ...` / `test(server): ...` style.
- The integrator (lead) merges into `develop` with `--no-ff`. **Never merge or rebase other branches yourself.**
- Every commit message ends with this trailer:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01WoLAKTHKM4YJFTxaDDNpoi
  ```

## Ownership: edit ONLY files you own
| Area | Owner | Paths |
|---|---|---|
| Shared contracts | lead | `shared/*`, `src/types/*`, `src/tools/types.ts`, `src/engine/coordinates/*`, `src/store/canvasStore.ts`, `src/store/historyStore.ts`, `src/store/collaborationStore.ts`, `src/engine/drawing/newElement.ts`, `docs/CONTRACTS.md`, root configs, `package.json` |
| Engine and tools | A | `src/engine/**` (except files marked lead), `src/tools/**` (except `types.ts`), `src/components/Canvas/**` |
| UI | B | `src/App.tsx`, `src/components/**` (except `Canvas/`), `src/styles/**` |
| State and services | C | `src/services/**`, `src/hooks/**`, `src/utils/**`, `src/store/libraryStore.ts` (new stores go in `src/store/<name>Store.ts`) |
| Backend | D | `server/**` |
| E2E | E | `e2e/**` |

If you need a change in a file you don't own (a contract bug or a missing field), **don't edit it**. Write the request in your final report under "CONTRACT REQUESTS"; the lead applies it. You may add new files inside your own folders freely.

**Do not install npm packages.** Already installed:
- Client: react 19, zustand 5, lucide-react, roughjs, perfect-freehand, socket.io-client, zod 4, uuid, @fontsource/kalam, tailwind 4, vitest, jsdom, @playwright/test.
- Server: express 5, socket.io, zod, prisma 7 with `@prisma/adapter-pg`, pg, dotenv, tsx, vitest, supertest, socket.io-client.

If you truly need another package, ask under CONTRACT REQUESTS.

## Core rules
1. **Elements are immutable.** Change them only through `useCanvasStore` actions (`addElements`, `updateElements`, `deleteElements`, `reorder`, `replaceScene`). These bump `version`/`versionNonce`, which history and sync depend on.
2. **One user interaction = one `commit()`.** During a drag, call `updateElements` on every move, then call `useCanvasStore.getState().commit()` once on pointerup. Actions in `src/services/actions.ts` call `commit()` at their end.
3. **Deleted elements stay in the array** with `isDeleted: true`. Use `selectors.visibleElements` for rendering and hit testing.
4. **Coordinates:** use `src/engine/coordinates` (`screenX = (sceneX + scrollX) * zoom`). Elements are stored in scene units. `angle` is in radians, clockwise, around the element's center. `points` of linear and freedraw elements are relative to `(x, y)` with `points[0] = [0, 0]`, and `width`/`height` equal the points' extent.
5. **The engine has no React.** `src/engine/**` and `src/tools/**` import no React and talk to state only via `useCanvasStore.getState()` / `setState` / `subscribe`.
6. **React components subscribe with narrow selectors** (`useCanvasStore(s => s.appState.zoom)`), never the whole store, to avoid re-renders.
7. **All user-level operations live in `actions`** (`src/services/actions.ts`, implemented by C). UI buttons, shortcuts, the context menu and the command palette call `actions.x()`. Engine tools may call store actions directly.
8. **Remote changes** go only through `applyRemoteElements` (reconciled by version, then a `versionNonce` tiebreak; see `shared/element.ts#shouldAcceptRemote`). Remote changes never enter local undo.
9. **Strict TypeScript**, no `any` unless justified in a comment. `npm run typecheck` must pass on your branch before you finish.

## Cross-agent APIs (signatures fixed; owner implements)
- **A (engine):**
  - `engine/rendering/index.ts`: `exportToCanvas(els, files, opts)`, `exportToSvg(els, files, opts)`.
  - `engine/hitTesting/index.ts`: `getElementAtPoint(x, y, els, tolerance)`, `getElementsInRect(rect, els)`.
  - `engine/transformations/bounds.ts`: `getElementBounds`, `getCommonBounds`, `boundsToRect`.
  - `engine/rendering/thumbnail.ts`: `renderThumbnail(els, files): string` (PNG data URL, max 320px).
  - `tools/index.ts`: `getTool(type): Tool`.
  - `components/Canvas/Canvas.tsx`: `export function Canvas()`.
- **C (state):**
  - `services/actions.ts` (the `actions` object; keep the keys, you may add more).
  - `hooks/useKeyboardShortcuts.ts`: `export function useKeyboardShortcuts(): void`, mounted once by `App`.
  - `services/collaboration.ts`: `export const collab = { connect(roomId), disconnect(), sendPointer(p), sendLaser(points) }`. It fills `useCollaborationStore`.
  - `services/persistence.ts`: `export function initPersistence(): () => void` (autosave and local recovery; App calls it once).
  - `store/libraryStore.ts`: `useLibraryStore` with `{ items: LibraryItem[]; add; remove }` (localStorage). `LibraryItem = { id; name; elements: SketchElement[]; created }`.
  - `services/api.ts`: a typed REST client for `shared/protocol.ts`.
  - `services/routing.ts`: reads `?room=<id>` and `#drawing=<id>` from the URL on startup.
- **D (server):** implements `shared/protocol.ts` (REST and Socket.IO) on port `PORT` (default 4000). The Vite dev server proxies `/api` and `/socket.io`.

## Collaboration model
- A room id equals the drawing id for edit links. View-only links use a `ShareLink` id, and the server rejects `scene:update` from view-role sockets.
- The client sends `scene:update` with only the elements whose `version` changed since the last broadcast, throttled to about 50 ms. On reconnect it calls `scene:sync`, gets `scene:init`, reconciles, then re-sends its local newer elements.
- The server keeps an in-memory room scene, reconciled with the same rule, and persists it to the Drawing row with a debounce of about 2 s.
- Pointers are throttled to about 30 ms, and lasers are sent as trails.

## Running locally (cloud workspace)
- Postgres: `postgresql://sketch:sketch@localhost:5432/sketchboard` (tests use `sketchboard_test`). The tables already exist; the migration SQL is in `server/prisma/migrations/0001_init`.
- Prisma CLI in this sandbox: `export PRISMA_SCHEMA_ENGINE_BINARY=/bin/true PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1` before `npx prisma generate`. `db push` and `migrate` are unavailable here, so apply the SQL with `psql` instead.
- Ports: each agent uses its own Vite port (`PORT=51xx npx vite`), given in the agent's brief. The backend dev port is 4000; agent D tests on 4100.
- Chrome is at `/usr/bin/google-chrome`. Playwright uses `channel: 'chrome'`.
