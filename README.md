# GSAP Editor (2D Shape Editor)

A modern 2D shape editor built with React, Three.js, and Vite. Create, edit, and export 2D geometric shapes with snapping, constraints, parameterized expressions, annotations, and real-time Three.js preview. Exported shapes can be saved to a MySQL database and optionally downloaded as JSON.

## Features

- **Shape tools**: Lines (multi-segment), arcs (center–radius or 3-point), rectangles, circles.
- **Edit tools**: Select, Move, Trim (line–line), Offset (parallel line by distance).
- **Snapping**: Endpoint, midpoint, center, intersection (line–line, line–arc, arc–arc), perpendicular, tangent, angle increment, grid.
- **Constraints**: Horizontal/vertical lock, fixed length/angle/radius, parallel to edge.
- **Parameter mode** (when shape is closed): Edge Tagger (E1–E8), Point Tagger (X/Y expressions for p0, p1, …), expression validation, topological sort for point dependencies.
- **Info**: Measure (distance, angle, ΔX, ΔY), Dimension (annotation line + text).
- **Export**: Build JSON from canvas → save to MySQL → toast notifications → optional download. JSON includes edges, optional parameters, point expressions, edge services, shape metadata, trim definition.
- **Undo/Redo**: Command history (max 200 steps).
- **Preview**: Real-time rendering via Three.js orthographic camera; adaptive grid.

## Project structure

- **`gsap-editor/`** — React + Vite frontend (editor UI, tools, export).
- **`server/`** — Node.js + Express API; connects to MySQL; auto-creates `shapes` table on first run.

Frontend (`gsap-editor/`):

- `src/components/` — Editor, Toolbar, ParameterPanel, Toast, SaveConfirmModal, StatusBar, …
- `src/api/` — `shapesApi.js` (saveShape, listShapes, getShape, deleteShape, checkServerHealth)
- `src/core/` — EventBus, CommandHistory, CoordinateEngine
- `src/store/` — GeometryStore, ParameterStore
- `src/snap/`, `src/constraints/`, `src/tools/`, `src/render/`, `src/three/`, `src/parameters/`, `src/export/`

See **`gsap-editor/PROJECT-DOCUMENTATION.md`** for full structure, logic, and maths. See **`gsap-editor/TOOL-GUIDE.md`** for tool usage and the export flow.

## Getting started

### Prerequisites

- Node.js (v16+)
- npm
- MySQL (for saving shapes to the database)

### 1. Database setup

1. Create the database: open MySQL Workbench (or CLI) and run **once** the statements in **`server/setup.sql`** (create database `gsap_editor`, use it). The server auto-creates the `shapes` table on first run.
2. In **`server/`**, copy `.env.example` to `.env` and set your MySQL password (e.g. `DB_PASSWORD=your_password_here`).

### 2. Install and run

**Option A — one command (recommended):** From the project root, install dependencies once (root + `server/` + `gsap-editor/`), then run both in one terminal:

```sh
cd "Three js - 2D Shape Editor"
npm install
cd server
npm install
cd ../gsap-editor
npm install
cd ..
npm run dev
```

This starts the backend (http://localhost:3001) and frontend (http://localhost:5173) together with prefixed logs (`[server]` / `[frontend]`).

**Option B — two terminals:**  
Terminal 1: `cd server` → `npm install` → `npm run dev`.  
Terminal 2: `cd gsap-editor` → `npm install` → `npm run dev`.  
Open the frontend URL (e.g. http://localhost:5173). Vite proxies `/api/*` to the backend.

### Export flow (Generate JSON / File → Export JSON)

1. Payload is built from the canvas geometry (and parameters if in Parameter Mode).
2. **"Saving to database…"** loading toast appears.
3. Shape is POSTed to MySQL via `/api/shapes`.
4. **"shape saved to database!"** success toast (bottom-right, auto-dismisses).
5. **"Saved to Database"** modal: **No, thanks** (close; JSON only in DB) or **⬇ Download JSON** (download file and close).
6. If the backend is unreachable, an error is toasted and the modal still opens so you can download the JSON locally.

## Scripts

**From project root:**

- `npm run dev` — Run backend + frontend together (concurrently)
- `npm run dev:server` — Backend only (`server/`)
- `npm run dev:frontend` — Frontend only (`gsap-editor/`)

**Frontend (`gsap-editor/`):** `npm run dev` | `npm run build` | `npm run preview`

**Backend (`server/`):** `npm run dev` (nodemon) | `npm start` (node)

## Technologies

- [React](https://react.dev/) (React 19)
- [Three.js](https://threejs.org/) — orthographic scene, lines/arcs, text sprites
- [Vite](https://vitejs.dev/) — build and dev server (proxy to API)
- Node.js, Express, MySQL (backend)

*(The name “GSAP Editor” is legacy; GSAP is not used in the current codebase.)*

## License

MIT.
