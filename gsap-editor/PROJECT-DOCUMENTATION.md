# GSAP Editor — Project Structure, Logic & Maths Reference

This document describes the **whole project structure**, **logical implementation details**, and **all maths** used in the 2D shape editor (React + Three.js + Vite).

---

## 1. Project Structure

### 1.1 Directory Tree

```
(project root)
├── server/                     # Node.js + Express API (MySQL)
│   ├── index.js                # REST API: /api/health, /api/shapes (GET, POST, GET/:id, DELETE)
│   ├── setup.sql               # One-time DB setup (CREATE DATABASE gsap_editor; table auto-created by server)
│   ├── package.json
│   └── .env                    # DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME, PORT (from .env.example)
│
gsap-editor/
├── index.html
├── package.json
├── vite.config.js              # /api/* proxied to http://localhost:3001
├── eslint.config.js
├── .gitignore
├── TOOL-GUIDE.md
├── PROJECT-DOCUMENTATION.md     ← this file
└── src/
    ├── main.jsx
    ├── App.jsx
    ├── index.css
    ├── api/
    │   └── shapesApi.js        # saveShape(), listShapes(), getShape(), deleteShape(), checkServerHealth()
    ├── components/
    │   ├── Editor.jsx           # Main editor: canvas, toolbar, panels, export flow, toasts, save modal
    │   ├── Toolbar.jsx
    │   ├── ParameterPanel.jsx
    │   ├── ParameterRow.jsx
    │   ├── ExpressionInput.jsx
    │   ├── Toast.jsx            # Toaster + toast.success/error/info/loading (bottom-right)
    │   ├── SaveConfirmModal.jsx # "Saved to Database" — No thanks / Download JSON
    │   └── StatusBar.jsx
    ├── core/
    │   ├── EventBus.js         # Pub/sub for all layers
    │   ├── CommandHistory.js   # Undo/redo
    │   └── CoordinateEngine.js # Screen ↔ World, pan/zoom, grid, parseInput
    ├── store/
    │   ├── GeometryStore.js     # Edges (line/arc) CRUD, version
    │   └── ParameterStore.js   # Parameters, point expressions, edge services, metadata
    ├── snap/
    │   └── SnapEngine.js       # 7 snap types, intersections, perpendicular, tangent, angle
    ├── constraints/
    │   └── ConstraintEngine.js # H/V lock, fixed length/angle/radius, parallel
    ├── tools/
    │   ├── ToolManager.js      # Tool switch, shortcuts, cancel
    │   ├── SelectTool.js
    │   ├── LineTool.js
    │   ├── ArcTool.js
    │   ├── RectangleTool.js
    │   ├── CircleTool.js
    │   ├── MoveTool.js
    │   ├── TrimTool.js
    │   ├── OffsetTool.js
    │   ├── MeasureTool.js
    │   ├── DimensionTool.js
    │   ├── PointTagger.js
    │   └── EdgeTagger.js
    ├── render/
    │   ├── GridRenderer.js     # Adaptive grid (minor/major)
    │   └── AnnotationLayer.js  # Dimension lines, text sprites
    ├── three/
    │   ├── SceneManager.js     # Scene, orthographic camera, WebGL renderer
    │   └── PreviewLayer.js     # Preview lines/arcs, snap indicators
    ├── parameters/
    │   ├── ParameterTypes.js   # LINEAR, RADIUS, ANGLE, OFFSET, DERIVED, TRIM; Java id validation
    │   ├── ExpressionBuilder.js # Validate/evaluate expressions, extract shape points, topological sort
    │   └── ExpressionValidator.js # Full validation (missing expr, mismatch, circular refs)
    └── export/
        ├── ExportService.js    # getExportPayload(), downloadPayload(payload), JSON export (edges + optional parameters)
        └── ParameterSerializer.js # Serialize/deserialize parameter store + edges
```

### 1.2 Entry & Data Flow

- **Entry:** `main.jsx` → `App.jsx` → `Editor.jsx`.
- **Editor** creates once: `SceneManager`, `GeometryStore`, `ParameterStore`, `CoordinateEngine`, `CommandHistory`, `SnapEngine`, `ConstraintEngine`, `ToolManager`, `PreviewLayer`, `AnnotationLayer`, `GridRenderer`, all tools, and `ExportService`. Renders `<Toaster />` and conditionally `SaveConfirmModal`.
- **Communication:** `EventBus` (`bus`) — tools and engines emit events; `Editor` subscribes and updates React state (tool status, cursor, selection, history, measure result, etc.).
- **Export flow:** "Generate JSON" or File → Export JSON → `ExportService.getExportPayload()` → `toast.loading('Saving to database…')` → `saveShape(name, payload)` (POST `/api/shapes`) → success: `toast.success`, open `SaveConfirmModal` with payload; failure: `toast.error`, still open modal so user can download locally. Modal: "No, thanks" closes; "Download JSON" calls `ExportService.downloadPayload(payload)` and closes.
- **Rendering:** Three.js scene; geometry edges as `THREE.Line` with `userData.edgeId`; `meshMap` maps `edgeId` → mesh for updates/deletes.

---

## 2. Logical Architecture (Layers)

| Layer | Role |
|-------|------|
| **CoordinateEngine** | Single source of truth for pan/zoom; Screen ↔ World transform; grid size; snap threshold in world units; command parsing (absolute, relative, polar, L/A/R). |
| **GeometryStore** | Edges only: `line` { start, end }, `arc` { center, radius, startAngle, endAngle, clockwise }. Validation (min length, arc sweep). |
| **SnapEngine** | Given world point + modifiers: returns snapped point by priority (Endpoint → Midpoint → Center → Intersection → Perpendicular → Tangent → Angle → Grid). Uses `CoordinateEngine` for threshold and grid. |
| **ConstraintEngine** | When a tool has an “origin” point: applies H-lock, V-lock, fixed length, fixed angle, parallel-to-edge, fixed radius (for arc/circle). |
| **CommandHistory** | Every mutation is `{ execute(), undo(), label }`. Max 200 undo steps; redo cleared on new command. |
| **ToolManager** | Registers tools; `setActive(name)`; Escape → cancel then select; Ctrl+Z/Y, Delete, Ctrl+A, F (zoom fit), Space (toggle snap), tool shortcuts. |

### 2.1 Command Input (CoordinateEngine.parseInput)

- **Absolute:** `100,80` → `{ x, y }`.
- **Relative:** `@50,30` → `relativeOrigin + (50, 30)`.
- **Polar:** `@100<45` → `relativeOrigin + 100 * (cos(45°), sin(45°))`.
- **Length constraint:** `L150` → `{ constraint: 'length', value: 150 }`.
- **Angle constraint:** `A45` → `{ constraint: 'angle', value: 45 }`.
- **Radius constraint:** `R75` → `{ constraint: 'radius', value: 75 }`.

`relativeOrigin` is set after each placed point (e.g. last point of line, arc center).

---

## 3. Implemented Features (Logic)

### 3.1 Drawing Tools

- **Line:** Multi-segment; each click adds segment from previous point; double-click or Esc finishes; snap + constraints applied; length/angle shown in tooltip.
- **Arc:** Two modes. **CRA:** center → radius point → end angle; **3-point:** three points on arc → center/radius/angles from perpendicular bisectors. Radius constraint supported (e.g. `R75`).
- **Rectangle:** Two opposite corners → four line edges (closed loop).
- **Circle:** Center → radius point; stored as full arc (0 to 2π); radius constraint supported.

### 3.2 Edit Tools

- **Select:** Click to select (toggle with Shift); hit-test by distance to edge (line segment or arc); Delete removes selected; highlights (hover + selected).
- **Move:** Uses selection from Select tool; base point → destination point; delta applied to all selected edges (line: start/end; arc: center); undo restores previous positions.
- **Trim:** Click near a **line** edge; find intersections with all other edges (line–line only in current TrimTool); pick closest intersection to click; trim line to that point (keep side opposite to click).
- **Offset:** Click a **line** edge; then type distance (e.g. `L20`); create parallel line offset by distance (perpendicular left).

### 3.3 Info Tools

- **Measure:** Two points → distance, angle (degrees), ΔX, ΔY; read-only; result in property panel.
- **Dimension:** Two points + label position → dimension line + text sprite on annotation layer (value in mm).

### 3.4 Parameter Mode (Draw vs Parameter)

- **Draw mode:** Standard tools; shape built from edges.
- **Parameter mode:** Enabled only when shape is “closed” (first edge start ≈ last edge end within 0.5 mm). Tools: **Edge Tagger** (assign service E1–E8 to edges), **Point Tagger** (assign X/Y expressions to shape points p0, p1, …).
- **Shape points:** Extracted from geometry (line start; arc start point only); ordered; ids `p0`, `p1`, …; p0 = trim origin (expressions `trimLeft`, `trimBottom`).
- **Export:** JSON includes edges (with ids in param mode), parameters, point expressions, edge services, shape metadata, trim definition. Export flow: build payload → save to MySQL via API → toast notifications → "Saved to Database" modal with option to download JSON (or download only if backend unreachable).

### 3.5 Validation (ExpressionValidator)

- All shape points have expressions; expressions valid (no unknown identifiers); evaluated coordinates match drawn (within 0.1 mm); at least one LINEAR parameter; no self-reference in DERIVED; class name and shape number set; optional warnings (radius if arcs, edge services, etc.).

---

## 4. Maths Reference

### 4.1 CoordinateEngine (Screen ↔ World)

- **Convention:** Document = World; 1 unit = 1 mm. Orthographic camera: pan `(_panX, _panY)`, zoom `_zoom`, base half-height `_baseHalfH = 500`.

**Screen → World:**

1. Canvas rect, aspect = width/height.
2. Half height in world: `halfH = _baseHalfH / _zoom`, `halfW = halfH * aspect`.
3. NDC: `ndcX = (sx - rect.left) / rect.width * 2 - 1`, `ndcY = -((sy - rect.top) / rect.height) * 2 + 1`.
4. World: `wx = _panX + ndcX * halfW`, `wy = _panY + ndcY * halfH`.
5. Round to 4 d.p.: `round(v) = round(v * 10^4) / 10^4`.

**World → Screen:** Inverse of above (world − pan, divide by half extents, NDC to pixel).

**Pixel size (world units per pixel):** `(2 * halfH) / rect.height`.

**Snap threshold (world):** `snapScreenPx * pixelSize()` (default 12 px).

**Zoom to cursor (wheel):** `before = screenToWorld(cursor)`; apply zoom factor; `after = screenToWorld(cursor)`; pan += `before - after`.

**Pan (middle/right drag):** Delta in screen pixels × pixelSize; pan -= dx*pixelSize, pan += dy*pixelSize (Y flipped).

**Grid size:** Target ~40 cells along viewport height; choose from preset list so grid ≤ target; major = 10× minor.

---

### 4.2 SnapEngine — Geometry

**Closest candidate:** Among points within `threshold`, return one with minimum Euclidean distance.

**Endpoints:** For each edge: line → start, end; arc → `center + radius*(cos(startAngle), sin(startAngle))` and same for endAngle.

**Midpoints:** Line: average of start/end. Arc: `midAngle = (startAngle + endAngle)/2`, point on circle at midAngle.

**Center:** Arc centers only.

**Line–Line intersection (parametric):**

- Line 1: `P(t) = (x1,y1) + t*(x2-x1, y2-y1)`, t ∈ [0,1].
- Line 2: `Q(u) = (x3,y3) + u*(x4-x3, y4-y3)`, u ∈ [0,1].
- Solve `P(t) = Q(u)`:
  - `det = (x1-x2)(y3-y4) - (y1-y2)(x3-x4)`. If |det| < ε → parallel.
  - `t = ((x1-x3)(y3-y4) - (y1-y3)(x3-x4)) / det`
  - `u = -((x1-x2)(y1-y3) - (y1-y2)(x1-x3)) / det`
- If t,u ∈ [0,1]: intersection = `(x1 + t*(x2-x1), y1 + t*(y2-y1))`.

**Line–Arc intersection:**

- Line: `P(t) = line.start + t*(line.end - line.start)`, t ∈ [0,1].
- Circle: `|P - center|² = radius²`.
- Substitute P(t), get quadratic in t: `a*t² + b*t + c = 0` where  
  `a = dx²+dy²`, `b = 2*(fx*dx+fy*dy)`, `c = fx²+fy² - R²`, with `(fx,fy) = line.start - center`, `(dx,dy) = line.end - line.start`.
- Discriminant `D = b² - 4ac`. If D < 0, no hit.
- `t = (-b ± √D) / (2a)`; keep t ∈ [0,1]; check point lies on arc sweep (angle in [startAngle, endAngle] with clockwise flag).

**Arc–Arc intersection:**

- Centers C1, C2; radii R1, R2; d = |C2−C1|.
- If d > R1+R2 or d < |R1−R2| or d ≈ 0 → no intersection or degenerate.
- Chord from circle 1: distance from C1 to chord = `a = (R1² - R2² + d²) / (2d)`; half-chord `h² = R1² - a²` (h ≥ 0).
- Midpoint of chord: `M = C1 + (a/d)*(C2−C1)`.
- Two points: `M ± (h/d)*perpendicular(C2−C1)`; perpendicular = `(dy, -dx)`.
- Filter by both arc sweeps (angle in range for each arc).

**Angle in arc sweep:** Angles normalized to [0, 2π); then check if angle lies between start and end according to `clockwise` (handling wrap).

**Perpendicular foot (point to segment):**

- Segment (A, B); point P. Vector `d = B - A`, `lenSq = |d|²`.
- `t = (P - A)·d / lenSq`. Clamp t ∈ [0,1].
- Foot = `A + t*d`.

**Tangent from point to circle:**

- Point P, center C, radius R; d = |P−C|. If d ≤ R, no tangent.
- Angle from center to tangent point: `α = acos(R/d)`; direction from C to P: `β = atan2(P.y−C.y, P.x−C.x)`.
- Two tangent points at angles `β ± α`; filter by arc sweep.

**Angle snap (increment degrees):** From draw origin to cursor: distance and angle; `snapDeg = round(angleDeg / increment) * increment`; point = origin + distance * (cos(snapRad), sin(snapRad)).

**Grid snap:** `gx = round(world.x / gridSize) * gridSize`, same for y; if distance to (gx, gy) ≤ threshold, return (gx, gy).

---

### 4.3 ConstraintEngine

- **Horizontal lock:** y = origin.y.
- **Vertical lock:** x = origin.x.
- **Fixed angle θ (degrees):**  
  `dist = fixedLen ?? distance(candidate, origin)`  
  `x = origin.x + dist*cos(θ°)`, `y = origin.y + dist*sin(θ°)`.
- **Parallel to edge:** Unit vector along edge `u = (e.end − e.start) / |e.end − e.start|`; project `(candidate − origin)` onto u: `proj = (dx,dy)·u`; point = origin + proj*u.
- **Fixed length (no fixed angle):** Scale vector from origin to current point to length L: `scale = L / distance`, point = origin + (point − origin)*scale.

Order: H/V and angle first, then parallel, then fixed length so length overrides distance.

---

### 4.4 Arc from Three Points (ArcTool)

- Points P1, P2, P3. Midpoints: M12 = (P1+P2)/2, M23 = (P2+P3)/2.
- Perpendicular directions: d1 = (−(P2.y−P1.y), P2.x−P1.x), d2 = (−(P3.y−P2.y), P3.x−P2.x).
- Center C = intersection of line (M12, d1) and (M23, d2):  
  Parametric: M12 + t*d1 = M23 + s*d2. Solve for t:  
  `det = d1x*d2y - d1y*d2x`; if |det| < ε, collinear → no circle.  
  `t = ((M23−M12)·(d2y, -d2x)) / det` → C = M12 + t*d1.
- Radius R = |P1−C|.
- Angles: a1 = atan2(P1−C), a3 = atan2(P3−C).
- Clockwise: cross product (P2−P1)×(P3−P1) < 0 → clockwise.

---

### 4.5 Distance to Edge (Hit-Test / Trim / Offset / Select)

**Point to line segment (A, B):**

- `d = B − A`, `lenSq = d·d`. If lenSq < ε, return distance to A.
- `t = (P−A)·d / lenSq`, clamp t ∈ [0,1].
- Closest point = A + t*d; return |P − closest|.

**Point to arc:**

- Radial distance = | |P−center| − radius |.
- If angle of P (from center) lies inside arc sweep → return radial distance.
- Else return min(distance to arc start point, distance to arc end point).

---

### 4.6 TrimTool — Which Side to Trim

- Click C, intersection I on line from A to B.
- Parameter: `t_click = (C−A)·(B−A) / lenSq`, `t_int = (I−A)·(B−A) / lenSq`.
- If `t_click < t_int`: keep [I, B], so new start = I, new end = B.
- Else: keep [A, I], so new start = A, new end = I.

---

### 4.7 Offset (Line)

- Edge vector d = end − start; length L = |d|.
- Left normal (perpendicular): n = (−dy/L, dx/L) * distance.
- New segment: start' = start + n, end' = end + n.

---

### 4.8 Shape Closure (Editor)

- First edge start S0, last edge end E_last.  
- For line: start/end; for arc: center + radius*(cos(startAngle), sin(startAngle)) and same for endAngle.  
- Closed if `|S0 − E_last| < 0.5`.

---

### 4.9 ExpressionBuilder — Point Extraction & Evaluation

- **Extract shape points:** Iterate edges in order; for line add start; for arc add start point only (center + radius*(cos(startAngle), sin(startAngle))). Deduplicate by rounded (x*100, y*100); ids p0, p1, …
- **Evaluate expression:** Replace `Math.toRadians(x)` → `(x)*π/180`, `Math.toDegrees(x)` → `(x)*180/π`; build scope from parameter values and computed point coords (p0, p1, … with .x, .y); `new Function(…keys, 'return (' + expr + ')')`.
- **Topological sort:** Point expressions may reference other points (e.g. p1.x = p0.x + L); build dependency graph from `p\d+\.(x|y)` refs; sort so dependencies evaluated first; detect cycles.

---

## 5. File-to-Responsibility Summary

| File | Responsibility |
|------|----------------|
| **CoordinateEngine.js** | Screen↔World, pan/zoom, grid, snap threshold, parseInput (coords + constraints). |
| **SnapEngine.js** | All snap types; line/line, line/arc, arc/arc intersections; perpendicular foot; tangent points; angle and grid snap. |
| **ConstraintEngine.js** | H/V lock, fixed length/angle/radius, parallel; apply(origin, candidate) → constrained point. |
| **GeometryStore.js** | Edge list, add/remove/replace/moveEdge; validation; version. |
| **CommandHistory.js** | execute(cmd), undo(), redo(); max 200; notify. |
| **EventBus.js** | on/off/emit; singleton `bus`. |
| **ToolManager.js** | Register tool, setActive, cancel; keyboard (Escape, Delete, Ctrl+Z/Y, Ctrl+A, F, +/-, Space, tool keys). |
| **LineTool / ArcTool / …** | Click/move handlers; snap + constraint; history.execute for mutations; preview layer. |
| **TrimTool.js** | Line–line intersection; closest intersection to click; trim side by parameter t. |
| **OffsetTool.js** | Perpendicular offset of line by typed distance. |
| **SelectTool.js** | Hit-test (dist to line/arc); selection set; delete selected; highlights. |
| **MoveTool.js** | Delta from base to destination; moveEdge for each selected. |
| **GridRenderer.js** | Visible bounds; minor/major grid lines in world. |
| **PreviewLayer.js** | Temporary lines/arcs and snap indicators (shapes by type). |
| **AnnotationLayer.js** | Dimension line + text sprite at label position. |
| **ExpressionBuilder.js** | Validate/evaluate expressions; extractShapePoints; topological sort; toJavaExpression. |
| **ExpressionValidator.js** | Full validation (missing/invalid/mismatch/circular/metadata). |
| **ExportService.js** | getExportPayload(), downloadPayload(payload); JSON: edges, optional parameters, point expressions, edge services, metadata. |
| **ParameterSerializer.js** | Serialize/deserialize parameter store + edges. |
| **shapesApi.js** | saveShape(), listShapes(), getShape(), deleteShape(), checkServerHealth(); frontend client for `/api/shapes`. |
| **Toast.jsx** | Toaster (portal bottom-right); toast.success/error/info/loading. |
| **SaveConfirmModal.jsx** | Modal after save: "Saved to Database", No thanks / Download JSON. |

---

## 6. Technologies

- **React 19** — UI (Editor, Toolbar, ParameterPanel, Toast, SaveConfirmModal, StatusBar).
- **Three.js** — Scene, OrthographicCamera, WebGLRenderer; Line, BufferGeometry, EllipseCurve; Sprites for text.
- **Vite** — Build and dev server; proxies `/api` to backend.
- **Backend** — Node.js, Express, MySQL (mysql2); `server/index.js`; REST API for shapes (GET/POST/DELETE).
- **No GSAP** in current codebase (name “GSAP Editor” is legacy).

---

*End of PROJECT-DOCUMENTATION.md*
