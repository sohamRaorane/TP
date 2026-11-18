# TP: Sketchboard

Sketchboard is a collaborative, hand-drawn-style whiteboard modelled on [Excalidraw](https://excalidraw.com). It runs on an infinite canvas with a real drawing engine, autosave to PostgreSQL, PNG/SVG/JSON export, and live multi-user collaboration over WebSockets.

All code and assets are our own; Excalidraw is only the visual and functional reference.

---

## Quick start (Windows, macOS, Linux)

You need **Node.js 20+**. PostgreSQL is optional: without it, the server stores drawings in local JSON files.

```bash
npm run setup      # installs client + server dependencies
npm run dev:all    # starts API server (:4000) and client (:5173)
```

Open **http://localhost:5173**.

To collaborate, click **Share → Start session** and open the link in another browser window (or another device on your network; see [LAN](#collaborate-from-other-devices)).

### Using PostgreSQL
1. Create a database, for example in `psql`:
   ```sql
   CREATE USER sketch WITH PASSWORD 'sketch';
   CREATE DATABASE sketchboard OWNER sketch;
   ```
   Or run `docker compose up -d db`.
2. Copy `server/.env.example` to `server/.env` and set `DATABASE_URL` if your credentials differ.
3. Start as usual. Tables are created automatically on startup, and `GET /api/health` shows `"storage": "postgres"`.

### Docker (everything)
```bash
docker compose up --build     # http://localhost:4000 (client served by the API)
```

### Collaborate from other devices
Start the client with `npm run dev -- --host` and the server with `npm --prefix server run dev`, then share the link using your machine's LAN IP.

---

## Features

**Drawing:**
- Rectangle, diamond, ellipse, arrow, line, freehand (pressure-aware) and text.
- Image insertion, eraser, frames, laser pointer and a hand (pan) tool.
- Hand-drawn rendering with rough.js; strokes smoothed with perfect-freehand.
- Arrows bind to shapes and follow them. Double-click a shape to add a label.

**Editing:**
- Select with click, Shift-click or a selection box.
- Move, resize (Shift keeps aspect, Alt resizes from center), rotate (Shift snaps to 15°), flip, align and distribute.
- Group and ungroup, lock, layer order, duplicate, and copy/cut/paste (also images and text from other apps).
- Snapping guides and grid.

**Styling:** stroke and background color, fill style (hachure, cross-hatch, solid, zigzag), stroke width and style, sloppiness, edges, arrowheads, font family, size and alignment, and opacity.

**Canvas:**
- Infinite canvas: wheel, trackpad and pinch zoom centered on the cursor.
- Pan with Space+drag or the middle mouse button.
- Zoom to fit or to the selection; minimap.

**History:** delta-based undo/redo, one entry per completed interaction. Remote edits are never undone by you.

**Persistence:**
- Debounced autosave to the server with a saved/saving/offline status.
- Crash recovery from browser storage.
- Dashboard of recent drawings (open, rename, duplicate, delete) and version history with restore.

**Export and import:**
- PNG (1x/2x/3x, transparent or dark; the scene is embedded so the PNG can be re-imported).
- SVG (font embedded).
- JSON save/open (validated with zod). Copy as PNG.

**Real-time collaboration:**
- Share links, plus view-only links.
- Live cursors with names, selections and presence avatars; follow a collaborator's viewport.
- Laser pointer visible to everyone.
- Incremental sync of changed elements only. Conflicts resolve by version with a deterministic tiebreak, layer order uses fractional keys, and clients resync on reconnect.

**Extras:**
- Dark mode, command palette (`Ctrl+K`), shape library, text-to-diagram (Mermaid-style flowcharts).
- Smart shape recognition: hold still at the end of a freehand stroke to turn it into a clean shape.
- Presentation mode (frames become slides), zen mode, view mode, stats panel.

## Keyboard shortcuts (selection)

| Tools | | Editor | | View | |
|---|---|---|---|---|---|
| Select | `V` / `1` | Undo / Redo | `Ctrl+Z` / `Ctrl+Shift+Z` | Zoom in / out | `Ctrl+=` / `Ctrl+-` |
| Rectangle | `R` / `2` | Copy / Paste | `Ctrl+C` / `Ctrl+V` | Reset zoom | `Ctrl+0` |
| Diamond | `D` / `3` | Duplicate | `Ctrl+D` | Zoom to fit | `Shift+1` |
| Ellipse | `O` / `4` | Delete | `Del` / `Backspace` | Pan | `Space`+drag |
| Arrow | `A` / `5` | Select all | `Ctrl+A` | Grid | `Ctrl+'` |
| Line | `L` / `6` | Group / Ungroup | `Ctrl+G` / `Ctrl+Shift+G` | Dark mode | `Alt+Shift+D` |
| Freehand | `P` / `7` | Bring forward / back | `Ctrl+]` / `Ctrl+[` | Command palette | `Ctrl+K` |
| Text | `T` / `8` | Lock | `Ctrl+Shift+L` | Help | `?` |
| Eraser | `E` / `0` | Cancel | `Esc` | | |

The full list is in the in-app Help dialog (`?`).

---

## Project structure

```
shared/             element model, zod schemas, REST + Socket.IO protocol, fractional index
src/
  engine/           framework-free drawing engine
    coordinates/    scene <-> screen transforms
    rendering/      rAF renderer, rough.js shapes, interactive layer, PNG/SVG export, minimap
    hitTesting/     per-type geometry hit tests
    transformations/ bounds, handles, resize, rotate, flip, snapping
    drawing/        element factories, arrow binding, text measure, shape recognition
  tools/            one folder per tool (selection, rectangle, ... eraser, laser, frame)
  store/            canvasStore (scene), historyStore (undo), collaborationStore, libraryStore
  services/         actions, persistence/autosave, collaboration client, api, clipboard, text-to-diagram
  hooks/            keyboard shortcuts
  components/       Canvas, TopBar, Toolbar, PropertiesPanel, ContextMenu, Dialogs, Footer, Overlays
server/
  src/              Express app, routes/controllers, Socket.IO collaboration, Postgres + file repositories
  prisma/           schema + SQL migration
e2e/                Playwright end-to-end tests
docs/               ARCHITECTURE.md, CONTRACTS.md
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how the engine, history and sync work.

## Scripts

| Command | Description |
|---|---|
| `npm run setup` | Install client and server dependencies |
| `npm run dev:all` | Start server and client together |
| `npm run dev` / `npm run server` | Start the client only / the server only |
| `npm run build` | Typecheck and build the client to `dist/` |
| `npm test` | Client unit tests (Vitest) |
| `npm --prefix server test` | Server tests (needs Postgres for the Postgres suite) |
| `npm run e2e` | Playwright tests against a running app (`E2E_BASE_URL`, default :5173) |

## Git workflow

This project uses git flow:
- `main` holds releases.
- `develop` is the integration branch.
- `feature/*` branches were merged with `--no-ff` (engine, ui, state, server, e2e and more).
