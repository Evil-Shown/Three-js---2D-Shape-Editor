# Three.js 2D Shape Editor

Browser-based CAD-like 2D editor for designing parametric glass shapes.  
It combines a React + Three.js frontend with a Node.js backend, supports snapping and constraints, and exports shape JSON to both local file and database workflows.

## Overview

This repository contains two applications:

- `gsap-editor` - frontend editor built with React, Vite, and Three.js
- `server` - backend API built with Express + MySQL, with optional Redis/BullMQ integration

The frontend communicates with the backend through `/api/*` (proxied by Vite in development).  
The backend stores and serves shape definitions, and supports downstream processing queue integration.

## Core Capabilities

### Geometry authoring

- Draw lines (including chained segments), arcs, rectangles, and circles
- Select and move existing geometry
- Trim and offset edges
- Real-time visual rendering in an orthographic Three.js scene

### Precision controls

- Snapping modes: endpoint, midpoint, center, intersection, perpendicular, tangent, angle increment, grid
- Constraint tools: horizontal/vertical, fixed dimensions/angles/radius, parallel relationships
- Command history with undo/redo

### Parametric workflow

- Parameter mode for closed shapes
- Edge tagging (`E1`, `E2`, ...), point tagging, expression-based point coordinates
- Dependency-safe expression evaluation (topological ordering)

### Measurement and annotation

- Distance/angle/delta inspection
- Dimension line annotations

### Export and persistence

- Export generated shape JSON
- Save to MySQL via backend API
- Optional direct JSON download from UI modal
- User feedback via toasts and status modals

## Repository Layout

```text
Three js - 2D Shape Editor/
|- README.md
|- package.json                 # Root dev orchestration (concurrently)
|- gsap-editor/                 # React + Vite frontend
|  |- src/
|  |  |- components/
|  |  |- tools/
|  |  |- constraints/
|  |  |- snap/
|  |  |- export/
|  |  |- api/
|  |  `- three/
|  `- package.json
`- server/                      # Express API + MySQL (+ optional Redis/BullMQ)
   |- config/
   |- db/
   |- routes/
   |- services/
   `- package.json
```

Additional docs:

- `gsap-editor/PROJECT-DOCUMENTATION.md`
- `gsap-editor/TOOL-GUIDE.md`

## Technology Stack

- Frontend: React 19, Three.js, Vite
- Backend: Node.js, Express, MySQL (`mysql2`)
- Queue/async support: Redis + BullMQ (used by backend services)
- Tooling: ESLint, nodemon, concurrently

Note: `GSAP` remains in naming for legacy reasons, but animation tooling is not the core of this project.

## Prerequisites

- Node.js 18+ recommended
- npm
- MySQL 8+ running locally or remotely
- Redis (optional, for queue-based processing features)

## Local Setup

### 1) Install dependencies

From repo root:

```bash
npm install
cd server && npm install
cd ../gsap-editor && npm install
cd ..
```

### 2) Configure backend environment

Create `server/.env` and set at least database credentials:

```env
NODE_ENV=development
PORT=3001
CORS_ORIGIN=http://localhost:5173

DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_password_here
DB_NAME=gsap_editor
DB_POOL_LIMIT=10

# Optional auth/claims
AUTH_DISABLED=true
JWT_SECRET=
JWT_CLAIM_USER_ID=sub
JWT_CLAIM_ORG_ID=organization_id
JWT_CLAIM_PROJECT_ID=project_id

# Optional queue settings
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_URL=redis://127.0.0.1:6379
SHAPE_JOB_LIST_KEY=gsap:shape-processing:jobs
BULLMQ_ENABLE_ACK_WORKER=true
BULLMQ_SHAPE_QUEUE=shape-processing
```

### 3) Initialize database

- Create database `gsap_editor` if it does not exist
- Run SQL in `server/setup.sql` if you are starting from scratch
- On startup, the backend also runs migration/bootstrap logic for required tables

## Running the Project

### Recommended: run both services together

```bash
npm run dev
```

This starts:

- Backend API on `http://localhost:3001`
- Frontend app on `http://localhost:5173`

### Run services separately

Backend:

```bash
cd server
npm run dev
```

Frontend:

```bash
cd gsap-editor
npm run dev
```

## Available Scripts

### Root

- `npm run dev` - run frontend + backend together
- `npm run dev:server` - run backend only
- `npm run dev:frontend` - run frontend only

### Frontend (`gsap-editor`)

- `npm run dev` - start Vite dev server
- `npm run build` - production build
- `npm run preview` - preview build
- `npm run lint` - run ESLint

### Backend (`server`)

- `npm run dev` - run with nodemon
- `npm start` - run with Node.js
- `npm test` - run Jest tests

## API and Export Flow

Typical export flow from the editor:

1. User creates geometry on canvas
2. App generates normalized JSON payload
3. Frontend `POST`s payload to `/api/shapes`
4. Backend validates and writes shape data to MySQL
5. UI shows success/failure toast and export modal
6. User can optionally download JSON locally

If backend is unavailable, local JSON download still supports offline workflow.

## Development Notes

- Vite dev proxy forwards `/api` to `http://localhost:3001`
- Backend startup checks and initializes database prerequisites
- In production mode, set `JWT_SECRET` unless auth is explicitly disabled
- If API port conflicts, change `PORT` in `server/.env`

## Troubleshooting

- **Frontend cannot reach API**: verify backend is running and `PORT` matches Vite proxy target
- **Database connection fails**: verify `DB_*` env values and MySQL server status
- **Port already in use**: change `PORT` in `server/.env`, restart server
- **CORS issues**: confirm `CORS_ORIGIN` includes your frontend URL

## Roadmap Ideas

- Additional CAD operations (fillet/chamfer/boolean tools)
- Richer parametric expression authoring UI
- Batch export and shape templates
- Improved collaboration/versioning workflow

## License

MIT
