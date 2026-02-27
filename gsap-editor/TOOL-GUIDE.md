## GSAP Parametric Shape Editor – Tool Guide

This guide explains how to use the editor to:

- **Draw a 2D shape**
- **Turn it into a parametric shape** using named dimensions like `L`, `H`, `R1`
- **Export JSON** for your downstream code generators

You do **not** need to be a programmer, but you do need to think in terms of **dimensions** (width, height, radii) and how they relate to the points of your shape.

---

## 1. Interface tour

### 1.1 Main layout

- **Top bar**
  - Left: app name `GSAP Editor`.
  - Middle: mode switch buttons: **Draw** / **Parameters**.
  - Right: **File / Edit / View / Tools** menus.

- **Left sidebar (toolbox)**
  - In **Draw Mode**:
    - **DRAW**: Line, Arc, Rectangle, Circle
    - **EDIT**: Select, Move, Trim, Offset
    - **INFO**: Measure, Dimension
  - In **Parameter Mode**:
    - **TAG**: Tag Edges, Tag Points

- **Center (canvas)**
  - The Three.js view where you draw the shape and see points and edges.
  - You can pan/zoom and interact with points and edges.

- **Right sidebar**
  - In **Draw Mode**: `PROPERTIES` – shows geometric info for the current selection.
  - In **Parameter Mode**: `PARAMETERS` – the parametric control panel (Parameters / Points / Services / Metadata tabs).

- **Bottom**
  - **Command line** (currently only used in Draw Mode).
  - **Status bar**: current coordinates, snap status, active tool, edge count, and in Parameter Mode, parameter/point coverage info.

---

## 2. Draw Mode – creating the base shape

You must first draw a closed shape before you can define parameters.

### 2.1 Start a new shape

- Top bar → **File → New** to clear the canvas.

### 2.2 Drawing tools

- **Select tool**: pick/drag edges, delete them.
- **Line tool**:
  - Click to place the first point, click again to place the end.
  - Snapping helps you hit endpoints and intersections cleanly.
- **Rectangle tool**:
  - Click and drag to create an axis-aligned rectangle.
- **Arc tool**:
  - Different modes to create circular arcs, used for rounded corners.

You can always use the **Select** tool to move or delete edges.

### 2.3 Pan, zoom, snapping

- **Pan**: middle-mouse drag.
- **Zoom**:
  - Mouse wheel, or
  - View → Zoom In / Zoom Out, or
  - `+` / `-` keys.
- **Zoom to fit**:
  - View → **Zoom to Fit** or press **F**.

Snapping is always on by default (endpoints, midpoints, intersections, etc.) so lines and arcs connect precisely.

### 2.4 Shape must be closed

Before you can switch to Parameter Mode:

- The shape must be **closed** – the last edge must end exactly where the first edge starts.
- Use the **Line** or **Rectangle** tools with snapping so that the final point snaps onto the start point.

If the shape is not closed:

- The **Parameters** button in the top toolbar is disabled.
- Hovering over it will show a tooltip:  
  **“Shape must be closed before defining parameters”**.

Once the shape is closed, you can move on to defining parameters.

---

## 3. Switching to Parameter Mode

After drawing and closing your shape:

1. Click the **Parameters** button in the top toolbar.
2. The UI changes:
   - Left toolbox switches to **Tag Edges** and **Tag Points**.
   - Right sidebar changes to the **Parameter Panel** with four tabs:
     - **Parameters**
     - **Points**
     - **Services**
     - **Metadata**

You are now working on the **parametric definition** of the shape (semantic meaning), not the raw geometry.

---

## 4. Parameters tab – defining named dimensions

The **Parameters** tab is where you define human-readable dimensions (like `L`, `H`, `R1`) that will be used in point expressions and in the generated code.

Each parameter has:

- **Name** (e.g. `L`, `H`, `R1`)
- **Type**:
  - `LINEAR` – distances in mm (width, height, offsets)
  - `RADIUS` – arc radii in mm
  - `ANGLE` – angles in degrees
- **Default value** – numeric value (e.g. 200)
- **Description** – optional text for humans (e.g. “Overall width”)

### 4.1 Adding a parameter

1. Go to the **Parameters** tab in the right panel.
2. Click **`+ Add`**.
3. In the inline form:
   - **Name**:  
     - `L` – overall width  
     - `H` – overall height  
     - `R1` / `R2` / `R3` / `R4` – corner radii, etc.
   - **Type**:
     - Choose `LINEAR`, `RADIUS`, or `ANGLE`.
   - **Default value**: numeric, e.g. `200` for 200 mm.
   - **Description**: e.g. “Width of the panel”.
4. Press **Enter** or click **Add**.

The parameter appears in the list. Example:

- `↔  L   Width of the shape   200mm`
- `↔  H   Height of the shape  150mm`
- `◠  R1  Bottom-left radius   15mm`

### 4.2 Editing parameters

- Double-click a row or click the **pencil** icon.
- Change name, type, value, or description.
- Press **Enter** to save, **Esc** to cancel.

The editor automatically:

- Prevents invalid Java identifiers (names must be something Java can use as a variable).
- Prevents duplicate parameter names.
- Renames parameter references in point expressions if you rename a parameter.

### 4.3 Deleting parameters

- Click the **trash** icon.
- If the parameter is used in any point expressions, delete is disabled and a tooltip tells you where it is used.

This prevents you from accidentally breaking point expressions by deleting a parameter that is in use.

### 4.4 Seeing where a parameter is used

Each parameter row shows a small usage hint:

- **“Used in: p2, p4, p6”**  
  or  
- **“Not used in any point yet”**

Additionally:

- Clicking a parameter row **highlights**:
  - That row itself, and
  - All points in the **Points** tab that use this parameter (yellow background).

This answers the question: **“What does H actually control?”**  
You can see directly which points (and therefore which parts of the shape) depend on that parameter.

---

## 5. Points – assigning expressions to shape points

Each important geometric point in your shape is labeled `p0`, `p1`, `p2`, etc.

### 5.1 Point markers and status colors

In **Parameter Mode**, with **Tag Points** tool active:

- Every corner relevant to the shape has:
  - A small circle marker
  - A label (`p0`, `p1`, …)
- Color meanings:
  - **Red hollow**: no expression assigned yet.
  - **Yellow hollow**: has expressions but not fully verified.
  - **Green solid**: expression matches the drawn coordinates (within tolerance).
  - **Red solid**: expression has errors or does not match the drawn point.

This gives you an instant overview of progress and correctness.

### 5.2 Special point `p0` – the trim origin

`p0` is special and always represents the trim origin:

- **X expression**: `trimLeft`
- **Y expression**: `trimBottom`

You cannot edit `p0`’s expressions. This matches how existing production code expects shapes to be anchored: all other points are defined relative to the trim origin.

### 5.3 Editing a point via the floating popup

1. Make sure **Tag Points** is active (in the left toolbox under TAG).
2. Hover over a point to see its label and position.
3. Click the point.
4. A **popup appears near the point** on the canvas showing:
   - Point name and drawn coordinates.
   - Two expression fields:
     - **X expression**
     - **Y expression**
   - Suggested expressions for each (chips you can click).

Example suggestions for a point on the bottom edge:

- **X suggestions**:
  - `p0.x + L`
  - `p0.x + L - R1`
  - `200.00` (literal)
- **Y suggestions**:
  - `p0.y`
  - `p0.y + R1`

You can:

- Click a suggestion to fill the corresponding field, or
- Manually type your own expression.

Press **Save** or hit **Enter** to commit.

### 5.4 Real-time validation

As you type or after you save:

- Expressions are checked for:
  - Unknown identifiers (e.g. `HH` if you meant `H`).
  - Basic syntax problems.
- The editor evaluates the expressions using current parameter default values and compares the result to the drawn coordinate:
  - If they match within a small epsilon:
    - The point turns **green**.
  - If not:
    - The point turns **red**, and the popup shows how far off it is (e.g. “Expected 200.00, got 185.00”).

### 5.5 Points tab – overview and navigation

In the **Points** tab of the right panel:

- You see a list of all points:
  - Status icon (red/yellow/green).
  - `pN` name and coordinates.
  - Short preview of X/Y expressions if set.
- Clicking a row:
  - Highlights the point on the canvas.
  - Focuses its expression in the floating popup if Tag Points is active.

If you clicked a parameter in the Parameters tab, points using that parameter are highlighted here (yellow background), which helps you understand its impact.

---

## 6. Edge services and trim (advanced)

**You can skip this section initially** if you only care about basic dimensions.  
Edge services are used for mapping edges to service offsets (E1–E8), as used in production code.

### 6.1 Services tab

In the **Services** tab:

- You see every edge in a table:
  - Edge ID (e.g. `edge_1`, `edge_2`).
  - Type (line or arc).
  - Length.
  - Service label: `None`, `E1` … `E8`.

You can change the service label via a dropdown for each row.

### 6.2 Tagging edges on the canvas

Alternatively, use the **Tag Edges** tool:

1. Select **Tag Edges** in the left sidebar.
2. Hover an edge:
   - It highlights.
   - A tooltip shows the current service label if there is one.
3. Click the edge:
   - A small popup appears at the cursor.
   - Choose a service label (`E1`…`E8`) or `None`.

Edges are recolored based on their service label to give quick visual feedback.

### 6.3 Trim definition

At the bottom of the Services tab:

- **Trim Bottom service**
- **Trim Left service**

These typically default to `E1` and `E7` (but can be changed).

This is used when generating code so the runtime can apply service offsets to the trim origin.

---

## 7. Metadata & generating output

In the **Metadata** tab:

- **Class Name**  
  Example: `ShapeTransformer_139`
- **Shape Number**  
  Example: `139`
- **Package Name**  
  Example: `com.core.shape.transformer.impl`

These are forwarded to the JSON as `shapeMetadata` and later used by your Java side code generator.

### 7.1 Validate

At the bottom of the Parameter Panel:

- Click **Validate**:
  - The editor runs a full consistency check:
    - All points have both X and Y expressions.
    - All expressions are syntactically valid.
    - Expressions evaluate to coordinates that match the drawn geometry within tolerance.
    - At least one LINEAR parameter exists.
    - If there are arcs, at least one RADIUS parameter exists.
    - No obvious circular references in derived parameters.
  - The result appears in a panel:
    - **Green** header if everything is OK.
    - **Red** header with a list of errors if something is wrong.
    - **Yellow** warnings if there are minor issues that don’t block export.

You should fix all **errors** before generating.

### 7.2 Generate JSON

Once validation passes with **no errors**:

- The **Generate** button becomes enabled.
- Clicking **Generate**:
  - Assembles a JSON payload with:
    - Original edges.
    - `shapeMetadata`
    - `parameters`
    - `pointExpressions`
    - `edgeServices`
  - Downloads a `.json` file.
  - The file name is based on the **Class Name** if set, otherwise it falls back to a default name.

You can then feed this JSON into your backend/Java generator to create a `ShapeTransformer_XXX.java` file.

---

## 8. Worked example – rectangle with width `L` and height `H`

This example walks through a simple axis-aligned rectangle driven by two parameters: width `L` and height `H`.

### 8.1 Draw the rectangle

1. In **Draw Mode**, use the **Rectangle** tool to draw a rectangle.
2. Make sure it is closed (the tool does this automatically).

### 8.2 Switch to Parameter Mode

- Click **Parameters** in the top bar.

### 8.3 Define `L` and `H`

In the **Parameters** tab:

- Add:
  - `L`:
    - Type: `LINEAR`
    - Default value: `200`
    - Description: `Width of the shape`
  - `H`:
    - Type: `LINEAR`
    - Default value: `150`
    - Description: `Height of the shape`

### 8.4 Assign point expressions

Assume points are laid out as:

- `p0`: bottom-left (origin, auto `trimLeft`, `trimBottom`)
- `p1`: bottom-right
- `p2`: top-right
- `p3`: top-left

Use **Tag Points**:

- `p0`:
  - Already set to:
    - X: `trimLeft`
    - Y: `trimBottom`

- `p1` (bottom-right):
  - Click point, then in popup:
    - X: `p0.x + L`
    - Y: `p0.y`

- `p2` (top-right):
  - X: `p0.x + L`
  - Y: `p0.y + H`

- `p3` (top-left):
  - X: `p0.x`
  - Y: `p0.y + H`

All four points should now validate as green if the rectangle was drawn consistently with those sizes.

### 8.5 Validate and generate

- Click **Validate**:
  - You should see all points assigned & matching.
- Click **Generate**:
  - Save the resulting `.json` file.

Now you have a clean parametric rectangle defined by `L` and `H`.

---

## 9. Tips and troubleshooting

### 9.1 Generate button is disabled

Check the following:

- In the **Points** tab:
  - Any points with red or yellow status?
- In the validation result area:
  - Any errors like:
    - “Point p3 has no expression assigned”
    - “Unknown identifier: HH”
    - “Computed point differs from drawn point by 20mm”

Fix those expressions or parameters and run **Validate** again.

### 9.2 A parameter says “Not used in any point yet”

This means:

- You defined the parameter (for example `H`), but you haven’t used it in any point expressions.

To fix:

- Click the parameter row (it will highlight).
- Go to the **Points** tab and choose a point you expect this parameter to control.
- Edit the X or Y expression to include the parameter name (e.g. `p0.y + H`).

### 9.3 Recommended learning path

1. Practice drawing and closing simple shapes (rectangles, L-shapes, basic cut-outs).
2. Start with just two parameters:
   - `L` for width, `H` for height.
3. Add corner radii (`R1`, `R2`, …) only after you’re comfortable with basic dimensions.
4. When in doubt:
   - Click a parameter row to see **where it is used** on the shape.
   - Use the Tag Points tool to visually inspect and adjust point expressions.

With this workflow, you can gradually move from beginner usage (simple rectangles) to advanced shapes with many parameters, while the tool keeps your definitions consistent and verifiable.

