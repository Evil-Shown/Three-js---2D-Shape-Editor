// src/parameters/GeometryAnalyzer.js
//
// Reads the drawn geometry and extracts meaningful shape dimensions automatically.
// "Drawing IS parameter definition" — when a user draws a 200×150 rectangle,
// L=200 and H=150 are already known. This module detects them.
//
// Shape detection:
//   RECTANGLE        — 4 lines, 0 arcs, all right angles
//   ROUNDED_RECTANGLE — 4 lines, 4 arcs with the same radius
//   L_SHAPE          — 6 lines, 0 arcs, 1 concave corner
//   T_SHAPE          — 8 lines, 0 arcs
//   U_CHANNEL        — 6 lines, 0 arcs, opening on one side
//   SLOT             — 2 lines, 2 arcs (stadium shape)
//   CIRCLE           — 0 lines, 1+ arcs forming a full circle
//   CUSTOM           — anything else
//
// Always extracts: bounding box, L (width), H (height).
// Also extracts: R values from arcs, sub-dimensions from intermediate vertices.

import { ParameterType } from './ParameterTypes.js'

const EPSILON = 1.5   // coordinate match tolerance (mm)
const ANGLE_EPSILON = 3 // degrees

export class GeometryAnalyzer {

  /**
   * Analyze drawn geometry and return detected dimensions + shape type.
   *
   * @param {object} geometryStore
   * @returns {{
   *   shapeType: string,
   *   boundingBox: { minX, minY, maxX, maxY, width, height },
   *   dimensions: Array<{ name, type, value, description, confidence }>,
   *   radii: Array<{ name, value, description }>,
   *   angles: Array<{ name, value, description }>,
   *   suggestedParams: Array<{ name, type, defaultValue, description }>
   * }}
   */
  analyze(geometryStore) {
    const edges = geometryStore.getEdges()
    if (edges.length === 0) {
      return this._empty()
    }

    // Separate edge types
    const lines = edges.filter(e => e.type === 'line')
    const arcs  = edges.filter(e => e.type === 'arc')

    // Compute bounding box
    const bb = this._boundingBox(edges)

    // Compute all unique vertices (endpoints)
    const vertices = this._extractVertices(edges)

    // Detect shape type
    const shapeType = this._detectShape(lines, arcs, vertices, bb)

    // Extract dimensions based on shape type
    const dimensions = []
    const radii = []
    const angles = []

    // --- Always extract L (width) and H (height) from bounding box ---
    dimensions.push({
      name: 'L', type: ParameterType.LINEAR,
      value: parseFloat(bb.width.toFixed(4)),
      description: 'Overall width',
      confidence: 1.0,
    })
    dimensions.push({
      name: 'H', type: ParameterType.LINEAR,
      value: parseFloat(bb.height.toFixed(4)),
      description: 'Overall height',
      confidence: 1.0,
    })

    // --- Extract radii from arcs ---
    const uniqueRadii = this._uniqueRadii(arcs)
    uniqueRadii.forEach((r, idx) => {
      const name = uniqueRadii.length === 1 ? 'R1' : `R${idx + 1}`
      radii.push({
        name,
        value: parseFloat(r.toFixed(4)),
        description: uniqueRadii.length === 1 ? 'Corner radius' : `Radius ${idx + 1}`,
      })
    })

    // --- Extract sub-dimensions for complex shapes ---
    if (shapeType === 'L_SHAPE' || shapeType === 'T_SHAPE' || shapeType === 'U_CHANNEL') {
      const subDims = this._extractSubDimensions(vertices, bb)
      dimensions.push(...subDims)
    }

    // --- Extract non-axis-aligned angles ---
    const lineAngles = this._extractAngles(lines)
    lineAngles.forEach((a, idx) => {
      angles.push({
        name: `A${idx + 1}`,
        value: parseFloat(a.toFixed(2)),
        description: `Angle ${idx + 1} from horizontal`,
      })
    })

    // --- Build suggested parameters (the final output for one-click add) ---
    const suggestedParams = []

    for (const d of dimensions) {
      suggestedParams.push({
        name: d.name,
        type: d.type,
        defaultValue: d.value,
        description: d.description,
      })
    }

    for (const r of radii) {
      suggestedParams.push({
        name: r.name,
        type: ParameterType.RADIUS,
        defaultValue: r.value,
        description: r.description,
      })
    }

    for (const a of angles) {
      suggestedParams.push({
        name: a.name,
        type: ParameterType.ANGLE,
        defaultValue: a.value,
        description: a.description,
      })
    }

    return {
      shapeType,
      boundingBox: bb,
      dimensions,
      radii,
      angles,
      suggestedParams,
    }
  }

  // ── Shape Detection ──────────────────────────────────────────────────────

  _detectShape(lines, arcs, vertices, bb) {
    const nLines = lines.length
    const nArcs  = arcs.length

    // Circle: only arcs, no lines, and total sweep ≈ 2π
    if (nLines === 0 && nArcs >= 1) {
      const totalSweep = arcs.reduce(
        (sum, a) => sum + Math.abs(a.endAngle - a.startAngle), 0
      )
      if (Math.abs(totalSweep - 2 * Math.PI) < 0.1) return 'CIRCLE'
    }

    // Slot: 2 lines, 2 arcs
    if (nLines === 2 && nArcs === 2) return 'SLOT'

    // Rounded rectangle: 4 lines, 4 arcs
    if (nLines === 4 && nArcs === 4) {
      const uniqueR = this._uniqueRadii(arcs)
      if (uniqueR.length === 1) return 'ROUNDED_RECTANGLE'
      return 'ROUNDED_RECTANGLE' // even with different radii
    }

    // Rectangle: 4 lines, 0 arcs, all right angles
    if (nLines === 4 && nArcs === 0) {
      if (this._allRightAngles(lines)) return 'RECTANGLE'
    }

    // L-shape: 6 lines, 0 arcs
    if (nLines === 6 && nArcs === 0) return 'L_SHAPE'

    // T-shape: 8 lines, 0 arcs
    if (nLines === 8 && nArcs === 0) return 'T_SHAPE'

    // U-channel: 6 lines, 0 arcs (different vertex pattern from L)
    // Note: L_SHAPE is caught above, this handles the case with arcs
    if (nLines === 6 && nArcs === 0) return 'U_CHANNEL'

    // More complex shapes with rounded corners
    if (nArcs > 0 && nLines > 0) {
      if (nLines === 6 && nArcs >= 1) return 'L_SHAPE'
      if (nLines === 8 && nArcs >= 1) return 'T_SHAPE'
    }

    return 'CUSTOM'
  }

  // ── Bounding Box ─────────────────────────────────────────────────────────

  _boundingBox(edges) {
    let minX = Infinity, maxX = -Infinity
    let minY = Infinity, maxY = -Infinity

    for (const e of edges) {
      if (e.type === 'line') {
        minX = Math.min(minX, e.start.x, e.end.x)
        maxX = Math.max(maxX, e.start.x, e.end.x)
        minY = Math.min(minY, e.start.y, e.end.y)
        maxY = Math.max(maxY, e.start.y, e.end.y)
      } else if (e.type === 'arc') {
        // Conservative: use center ± radius
        minX = Math.min(minX, e.center.x - e.radius)
        maxX = Math.max(maxX, e.center.x + e.radius)
        minY = Math.min(minY, e.center.y - e.radius)
        maxY = Math.max(maxY, e.center.y + e.radius)
      }
    }

    return {
      minX, minY, maxX, maxY,
      width:  maxX - minX,
      height: maxY - minY,
    }
  }

  // ── Vertex Extraction ────────────────────────────────────────────────────

  _extractVertices(edges) {
    const vertices = []
    const seen = new Set()

    const addVtx = (x, y) => {
      const key = `${Math.round(x * 10)}:${Math.round(y * 10)}`
      if (seen.has(key)) return
      seen.add(key)
      vertices.push({ x, y })
    }

    for (const e of edges) {
      if (e.type === 'line') {
        addVtx(e.start.x, e.start.y)
        addVtx(e.end.x, e.end.y)
      } else if (e.type === 'arc') {
        const sx = e.center.x + e.radius * Math.cos(e.startAngle)
        const sy = e.center.y + e.radius * Math.sin(e.startAngle)
        const ex = e.center.x + e.radius * Math.cos(e.endAngle)
        const ey = e.center.y + e.radius * Math.sin(e.endAngle)
        addVtx(sx, sy)
        addVtx(ex, ey)
      }
    }

    return vertices
  }

  // ── Unique Radii ─────────────────────────────────────────────────────────

  _uniqueRadii(arcs) {
    const radii = []
    for (const a of arcs) {
      const existing = radii.find(r => Math.abs(r - a.radius) < EPSILON)
      if (!existing) radii.push(a.radius)
    }
    return radii.sort((a, b) => a - b)
  }

  // ── Right Angle Detection ────────────────────────────────────────────────

  _allRightAngles(lines) {
    if (lines.length < 2) return false

    for (let i = 0; i < lines.length; i++) {
      const a = lines[i]
      const b = lines[(i + 1) % lines.length]

      // Check if they share an endpoint
      const shared = this._sharedEndpoint(a, b)
      if (!shared) continue

      const angA = Math.atan2(a.end.y - a.start.y, a.end.x - a.start.x) * 180 / Math.PI
      const angB = Math.atan2(b.end.y - b.start.y, b.end.x - b.start.x) * 180 / Math.PI
      let diff = Math.abs(angA - angB) % 180
      if (diff > 90) diff = 180 - diff
      if (Math.abs(diff - 90) > ANGLE_EPSILON) return false
    }

    return true
  }

  _sharedEndpoint(lineA, lineB) {
    const pts = [
      [lineA.start, lineB.start],
      [lineA.start, lineB.end],
      [lineA.end, lineB.start],
      [lineA.end, lineB.end],
    ]
    for (const [a, b] of pts) {
      if (Math.hypot(a.x - b.x, a.y - b.y) < EPSILON) return a
    }
    return null
  }

  // ── Sub-Dimensions (for L/T/U shapes) ────────────────────────────────────

  _extractSubDimensions(vertices, bb) {
    const subDims = []

    // Find unique X and Y values (excluding the bounding box min/max)
    const uniqueX = this._uniqueCoords(vertices.map(v => v.x))
      .filter(x => Math.abs(x - bb.minX) > EPSILON && Math.abs(x - bb.maxX) > EPSILON)
    const uniqueY = this._uniqueCoords(vertices.map(v => v.y))
      .filter(y => Math.abs(y - bb.minY) > EPSILON && Math.abs(y - bb.maxY) > EPSILON)

    // Sub-width(s)
    uniqueX.forEach((x, idx) => {
      const distFromLeft = x - bb.minX
      if (distFromLeft > EPSILON && distFromLeft < bb.width - EPSILON) {
        subDims.push({
          name: `L${idx + 2}`,
          type: ParameterType.LINEAR,
          value: parseFloat(distFromLeft.toFixed(4)),
          description: `Sub-width ${idx + 1} (from left edge)`,
          confidence: 0.85,
        })
      }
    })

    // Sub-height(s)
    uniqueY.forEach((y, idx) => {
      const distFromBottom = y - bb.minY
      if (distFromBottom > EPSILON && distFromBottom < bb.height - EPSILON) {
        subDims.push({
          name: `H${idx + 2}`,
          type: ParameterType.LINEAR,
          value: parseFloat(distFromBottom.toFixed(4)),
          description: `Sub-height ${idx + 1} (from bottom edge)`,
          confidence: 0.85,
        })
      }
    })

    return subDims
  }

  _uniqueCoords(values) {
    const unique = []
    for (const v of values) {
      if (!unique.some(u => Math.abs(u - v) < EPSILON)) {
        unique.push(v)
      }
    }
    return unique.sort((a, b) => a - b)
  }

  // ── Angle Extraction (non-axis-aligned lines) ───────────────────────────

  _extractAngles(lines) {
    const angles = []
    for (const line of lines) {
      const angle = Math.abs(
        Math.atan2(line.end.y - line.start.y, line.end.x - line.start.x) * 180 / Math.PI
      )
      // Skip axis-aligned lines (0°, 90°, 180°, 270°)
      const mod = angle % 90
      if (mod > ANGLE_EPSILON && mod < 90 - ANGLE_EPSILON) {
        if (!angles.some(a => Math.abs(a - angle) < ANGLE_EPSILON)) {
          angles.push(angle)
        }
      }
    }
    return angles
  }

  // ── Empty result ─────────────────────────────────────────────────────────

  _empty() {
    return {
      shapeType: 'NONE',
      boundingBox: { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 },
      dimensions: [],
      radii: [],
      angles: [],
      suggestedParams: [],
    }
  }
}
