# Architecture

## Data model (`shared/element.ts`)

Every drawable is an immutable `SketchElement`. It has geometry (`x`, `y`, `width`, `height`, `angle`), style, a rough.js `seed`, and the sync metadata `version`, `versionNonce`, `updated`, `isDeleted` and `index`.

Linear and freedraw elements store `points` relative to `(x, y)`. Images reference a `fileId` in the scene's `files` map, which holds data URLs.

## Coordinates (`src/engine/coordinates`)

```
screenX = (sceneX + scrollX) * zoom        sceneX = screenX / zoom - scrollX
```

Elements live in scene units. `zoomAt` keeps the scene point under the cursor fixed, so zooming causes no drift.

## Store (`src/store/canvasStore.ts`)

Zustand holds:
- `elements`: in z-order, including tombstones.
- `elementsById`.
- `files`.
- `appState`.
- Two counters: `sceneNonce` triggers a redraw, and `localNonce` marks a local change for autosave and sync.

All mutations create new element objects and bump `version` and `versionNonce`.

Components subscribe through narrow selectors. The engine reads the store through `getState()` and `subscribe()`, never through React.

## Rendering (`src/engine/rendering`)

A requestAnimationFrame loop repaints only when the scene, viewport or collaboration state changes. It draws two stacked, high-DPI canvases:
1. **Static layer:** grid, then elements culled to the viewport. Each element's rough.js drawable is cached by `id` and `version`; freehand strokes use perfect-freehand.
2. **Interactive layer:** selection boxes and handles, the selection rectangle, snap lines, binding highlight, eraser trail, remote cursors and selections, and laser trails.

Dark mode applies `invert(93%) hue-rotate(180deg)` to the canvases, so stored colors stay theme-independent.

## Tools (`src/tools`)

The Canvas controller turns DOM pointer events into `CanvasPointerEvent`s (scene and screen coordinates, modifiers, pressure) and passes them to the active `Tool`.

Tools update the store freely during a gesture and call `commit()` once at the end, so one gesture becomes one undo entry.

## History (`src/store/historyStore.ts`)

`commit()` compares the scene against the last committed baseline by reference and records only the changed elements' `before` and `after`. Memory therefore scales with the size of each edit, not the scene.

Undo and redo re-apply those snapshots with a *higher* version, so collaborators accept them.

Remote changes go into the baseline without creating an entry, so you never undo someone else's work.

## Persistence (`src/services/persistence.ts`)

- **Local recovery:** a snapshot goes to `localStorage` 500 ms after a change.
- **Server autosave:** `PUT /api/drawings/:id` 1.5 s after a change, and at least every 10 s during continuous edits. It retries with backoff while offline.
- **Status:** shown in the top bar.
- **During collaboration:** the server persists the room instead.

## Collaboration (`src/services/collaboration.ts`, `server/src/sockets`)

1. **Joining:** a client joins a room (the drawing id, or a view-only share id) and receives `scene:init`.
2. **Sending changes:** local changes are compared against the versions last sent or received, and only the changed elements, including deletions, go out in a `scene:update`, throttled to 50 ms.
3. **Server:** it reconciles each element with `shouldAcceptRemote` (higher `version` wins; on a tie, lower `versionNonce` wins), rebroadcasts only the accepted ones, and persists the room with a debounce.
4. **Layer order:** each element has a fractional `index` key (`shared/fractionalIndex.ts`). Reordering rewrites only the moved elements' keys, and appends use time-ordered keys, so every client converges to the same order.
5. **Reconnect:** the client rejoins, asks for `scene:sync`, and resends any local elements newer than the server's.
6. **Pointers:** cursors, selections, viewports (for follow mode) and laser trails are relayed as volatile messages.
7. **View-only:** sockets with the view role cannot send updates.

## Server (`server/`)

- Express 5 REST API with zod validation (see `shared/protocol.ts`).
- Storage behind a repository interface: Postgres via Prisma 7 with `@prisma/adapter-pg`, or atomic JSON files.
- `STORAGE=auto` falls back to files when Postgres is unreachable.
- Migrations are plain idempotent SQL applied at startup.
- Version snapshots are taken at most every 5 minutes or after large changes, capped at 50 per drawing.
