// src/snap/SnapEngine.js — v2
// 7 snap types with priority ordering, screen-pixel thresholds,
// visual indicator metadata, and caching for intersections.

import { bus } from '../core/EventBus.js'

/* ── Snap type constants (priority order high → low) ── */
export const SNAP = {
  CLOSE_PATH:    'ClosePath',
  ENDPOINT:      'Endpoint',
  MIDPOINT:      'Midpoint',
  CENTER:        'Center',
  INTERSECTION:  'Intersection',
  PERPENDICULAR: 'Perpendicular',
  TANGENT:       'Tangent',
  ANGLE:         'Angle',
  GRID:          'Grid',
  NONE:          'None'
}

const SNAP_PRIORITY = [
  SNAP.CLOSE_PATH,   // highest priority — auto-close shape
  SNAP.ENDPOINT,
  SNAP.MIDPOINT,
  SNAP.CENTER,
  SNAP.INTERSECTION,
  SNAP.PERPENDICULAR,
  SNAP.TANGENT,
  SNAP.ANGLE,
  SNAP.GRID
]

const SNAP_COLORS = {
  [SNAP.CLOSE_PATH]:    0x00ffaa,  // bright aqua — "close shape" indicator
  [SNAP.ENDPOINT]:      0xffff00,  // yellow
  [SNAP.MIDPOINT]:      0x00ffff,  // cyan
  [SNAP.CENTER]:        0x00ff00,  // green
  [SNAP.INTERSECTION]:  0xff0000,  // red
  [SNAP.PERPENDICULAR]: 0xff00ff,  // magenta
  [SNAP.TANGENT]:       0xff8800,  // orange
  [SNAP.ANGLE]:         0x4488ff,  // blue
  [SNAP.GRID]:          0x64748b,  // slate
}

const EPS = 1e-8

export class SnapEngine {
  /**
   * @param {import('../core/CoordinateEngine.js').CoordinateEngine} coordEngine
   * @param {import('../store/GeometryStore.js').GeometryStore}       store
   */
  constructor(coordEngine, store) {
    this.coord = coordEngine
    this.store = store

    // Toggle map — user can disable individual types
    this.enabled = {}
    for (const t of SNAP_PRIORITY) this.enabled[t] = true

    // Angle increment in degrees
    this.angleIncrement = 15

    // Intersection cache — rebuilt when edges change
    this._cachedIntersections = []
    this._edgeVersion = -1

    // Active snap result for UI display
    this.activeSnap = { type: SNAP.NONE, point: null }

    // Drawing context — set by active tool
    this._drawOrigin = null  // start point of line being drawn

    // Path first-point — set by tools at path start for close-path snapping
    this._pathFirstPoint = null

    // External open-end provider (PathConnectivity)
    this._pathConnectivity = null
  }

  /** Tools call this when a "from" point is established */
  setDrawOrigin(p) { this._drawOrigin = p ? { x: p.x, y: p.y } : null }

  /** Tools call this at path start for close-path snap */
  setPathFirstPoint(p) { this._pathFirstPoint = p ? { x: p.x, y: p.y } : null }

  /** Inject PathConnectivity reference for open-end snapping */
  setPathConnectivity(pc) { this._pathConnectivity = pc }

  /** Main snap — takes raw world point, returns snapped point + metadata.
   *  @param {{ x: number, y: number }} world
   *  @param {{ shift?: boolean, alt?: boolean, ctrl?: boolean }} mods  keyboard modifiers
   *  @returns {{ x: number, y: number, snapped: boolean, snapType: string, snapColor: number }}
   */
  snap(world, mods = {}) {
    const threshold = this.coord.snapWorldThreshold()

    // Modifier overrides
    if (mods.ctrl)  return this._forceType(SNAP.ENDPOINT, world, threshold)
    if (mods.alt)   return this._gridSnap(world)
    if (mods.shift && this._drawOrigin) return this._angleSnap(world, threshold)

    // Standard priority scan
    for (const type of SNAP_PRIORITY) {
      if (!this.enabled[type]) continue
      const result = this._trySnap(type, world, threshold)
      if (result) {
        this.activeSnap = { type, point: result, color: SNAP_COLORS[type] }
        bus.emit('snapChanged', this.activeSnap)
        return { ...result, snapped: true, snapType: type, snapColor: SNAP_COLORS[type] }
      }
    }

    // No snap
    this.activeSnap = { type: SNAP.NONE, point: null }
    bus.emit('snapChanged', this.activeSnap)
    return { x: world.x, y: world.y, snapped: false, snapType: SNAP.NONE, snapColor: 0 }
  }

  /* ───────── Individual snap type implementations ───────── */

  _trySnap(type, world, threshold) {
    switch (type) {
      case SNAP.CLOSE_PATH:    return this._closePathSnap(world, threshold)
      case SNAP.ENDPOINT:      return this._endpointSnap(world, threshold)
      case SNAP.MIDPOINT:      return this._midpointSnap(world, threshold)
      case SNAP.CENTER:        return this._centerSnap(world, threshold)
      case SNAP.INTERSECTION:  return this._intersectionSnap(world, threshold)
      case SNAP.PERPENDICULAR: return this._perpendicularSnap(world, threshold)
      case SNAP.TANGENT:       return this._tangentSnap(world, threshold)
      case SNAP.ANGLE:         return this._angleSnap(world, threshold)
      case SNAP.GRID:          return this._gridResult(world, threshold)
      default: return null
    }
  }

  /* ── 0. Close Path — highest priority ── */
  _closePathSnap(world, threshold) {
    // Use extended threshold for close-path (50% larger) to make it easier
    const closeThreshold = threshold * 1.5
    const candidates = []

    // 1. Path first-point set by the active tool
    if (this._pathFirstPoint) {
      candidates.push(this._pathFirstPoint)
    }

    // 2. Open endpoints from PathConnectivity (graph-based)
    if (this._pathConnectivity) {
      const openEnds = this._pathConnectivity.getOpenEndpointsForSnap()
      for (const pt of openEnds) {
        // Don't snap to ourselves — skip if same as drawOrigin
        if (this._drawOrigin &&
            Math.hypot(pt.x - this._drawOrigin.x, pt.y - this._drawOrigin.y) < 0.01) {
          continue
        }
        candidates.push(pt)
      }
    }

    if (candidates.length === 0) return null
    return this._closestCandidate(world, closeThreshold, candidates)
  }

  /* ── 1. Endpoint ── */
  _endpointSnap(world, threshold) {
    return this._closestCandidate(world, threshold, this._allEndpoints())
  }

  _allEndpoints() {
    const pts = []
    for (const e of this.store.getEdges()) {
      if (e.type === 'line') {
        pts.push(e.start, e.end)
      } else if (e.type === 'arc') {
        pts.push(this._arcStartPt(e), this._arcEndPt(e))
      }
    }
    return pts
  }

  /* ── 2. Midpoint ── */
  _midpointSnap(world, threshold) {
    const pts = []
    for (const e of this.store.getEdges()) {
      if (e.type === 'line') {
        pts.push({
          x: (e.start.x + e.end.x) / 2,
          y: (e.start.y + e.end.y) / 2
        })
      } else if (e.type === 'arc') {
        const midAngle = (e.startAngle + e.endAngle) / 2
        pts.push({
          x: e.center.x + e.radius * Math.cos(midAngle),
          y: e.center.y + e.radius * Math.sin(midAngle)
        })
      }
    }
    return this._closestCandidate(world, threshold, pts)
  }

  /* ── 3. Center ── */
  _centerSnap(world, threshold) {
    const pts = []
    for (const e of this.store.getEdges()) {
      if (e.type === 'arc') pts.push({ x: e.center.x, y: e.center.y })
    }
    return this._closestCandidate(world, threshold, pts)
  }

  /* ── 4. Intersection ── */
  _intersectionSnap(world, threshold) {
    this._rebuildIntersections()
    return this._closestCandidate(world, threshold, this._cachedIntersections)
  }

  _rebuildIntersections() {
    const ver = this.store.getEdgeCount()
    if (ver === this._edgeVersion) return
    this._edgeVersion = ver
    this._cachedIntersections = []

    const edges = this.store.getEdges()
    for (let i = 0; i < edges.length; i++) {
      for (let j = i + 1; j < edges.length; j++) {
        const pts = this._intersectEdges(edges[i], edges[j])
        this._cachedIntersections.push(...pts)
      }
    }
  }

  _intersectEdges(a, b) {
    if (a.type === 'line' && b.type === 'line') return this._intersectLineLine(a, b)
    if (a.type === 'line' && b.type === 'arc')  return this._intersectLineArc(a, b)
    if (a.type === 'arc'  && b.type === 'line')  return this._intersectLineArc(b, a)
    if (a.type === 'arc'  && b.type === 'arc')   return this._intersectArcArc(a, b)
    return []
  }

  _intersectLineLine(a, b) {
    const x1 = a.start.x, y1 = a.start.y, x2 = a.end.x, y2 = a.end.y
    const x3 = b.start.x, y3 = b.start.y, x4 = b.end.x, y4 = b.end.y

    const det = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4)
    if (Math.abs(det) < EPS) return []  // parallel

    const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / det
    const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / det

    if (t >= -EPS && t <= 1 + EPS && u >= -EPS && u <= 1 + EPS) {
      return [{ x: x1 + t * (x2 - x1), y: y1 + t * (y2 - y1) }]
    }
    return []
  }

  _intersectLineArc(line, arc) {
    const dx = line.end.x - line.start.x
    const dy = line.end.y - line.start.y
    const fx = line.start.x - arc.center.x
    const fy = line.start.y - arc.center.y

    const a = dx * dx + dy * dy
    const b = 2 * (fx * dx + fy * dy)
    const c = fx * fx + fy * fy - arc.radius * arc.radius

    let disc = b * b - 4 * a * c
    if (disc < 0) return []

    const pts = []
    disc = Math.sqrt(disc)
    for (const sign of [-1, 1]) {
      const t = (-b + sign * disc) / (2 * a)
      if (t >= -EPS && t <= 1 + EPS) {
        const px = line.start.x + t * dx
        const py = line.start.y + t * dy
        if (this._onArc(arc, px, py)) {
          pts.push({ x: px, y: py })
        }
      }
    }
    return pts
  }

  _intersectArcArc(a, b) {
    const dx = b.center.x - a.center.x
    const dy = b.center.y - a.center.y
    const d = Math.hypot(dx, dy)

    if (d > a.radius + b.radius + EPS) return []
    if (d < Math.abs(a.radius - b.radius) - EPS) return []
    if (d < EPS) return []

    const aa = (a.radius * a.radius - b.radius * b.radius + d * d) / (2 * d)
    const h2 = a.radius * a.radius - aa * aa
    if (h2 < 0) return []
    const h = Math.sqrt(Math.max(0, h2))

    const mx = a.center.x + aa * dx / d
    const my = a.center.y + aa * dy / d

    const pts = []
    if (h < EPS) {
      if (this._onArc(a, mx, my) && this._onArc(b, mx, my)) pts.push({ x: mx, y: my })
    } else {
      const p1 = { x: mx + h * dy / d, y: my - h * dx / d }
      const p2 = { x: mx - h * dy / d, y: my + h * dx / d }
      if (this._onArc(a, p1.x, p1.y) && this._onArc(b, p1.x, p1.y)) pts.push(p1)
      if (this._onArc(a, p2.x, p2.y) && this._onArc(b, p2.x, p2.y)) pts.push(p2)
    }
    return pts
  }

  _onArc(arc, px, py) {
    const angle = Math.atan2(py - arc.center.y, px - arc.center.x)
    return this._angleInSweep(angle, arc.startAngle, arc.endAngle, arc.clockwise)
  }

  _angleInSweep(angle, start, end, cw) {
    const normalize = a => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
    const a = normalize(angle)
    const s = normalize(start)
    const e = normalize(end)

    if (!cw) {
      if (e >= s) return a >= s - EPS && a <= e + EPS
      return a >= s - EPS || a <= e + EPS
    } else {
      if (s >= e) return a <= s + EPS && a >= e - EPS
      return a <= s + EPS || a >= e - EPS
    }
  }

  /* ── 5. Perpendicular ── */
  _perpendicularSnap(world, threshold) {
    if (!this._drawOrigin) return null
    const pts = []
    for (const e of this.store.getEdges()) {
      if (e.type === 'line') {
        const foot = this._perpFoot(this._drawOrigin, e.start, e.end)
        if (foot) pts.push(foot)
      }
    }
    return this._closestCandidate(world, threshold, pts)
  }

  _perpFoot(origin, ls, le) {
    const dx = le.x - ls.x, dy = le.y - ls.y
    const lenSq = dx * dx + dy * dy
    if (lenSq < EPS) return null

    const t = ((origin.x - ls.x) * dx + (origin.y - ls.y) * dy) / lenSq
    if (t < -EPS || t > 1 + EPS) return null
    const tc = Math.max(0, Math.min(1, t))
    return { x: ls.x + tc * dx, y: ls.y + tc * dy }
  }

  /* ── 6. Tangent ── */
  _tangentSnap(world, threshold) {
    if (!this._drawOrigin) return null
    const pts = []
    for (const e of this.store.getEdges()) {
      if (e.type === 'arc') {
        const tps = this._tangentPoints(this._drawOrigin, e)
        pts.push(...tps)
      }
    }
    return this._closestCandidate(world, threshold, pts)
  }

  _tangentPoints(P, arc) {
    const dx = P.x - arc.center.x
    const dy = P.y - arc.center.y
    const d = Math.hypot(dx, dy)
    if (d <= arc.radius + EPS) return []

    const a = Math.acos(arc.radius / d)
    const b = Math.atan2(dy, dx)
    const pts = []
    for (const sign of [-1, 1]) {
      const angle = b + sign * a
      const px = arc.center.x + arc.radius * Math.cos(angle)
      const py = arc.center.y + arc.radius * Math.sin(angle)
      if (this._onArc(arc, px, py)) pts.push({ x: px, y: py })
    }
    return pts
  }

  /* ── 7. Angle increment ── */
  _angleSnap(world, _threshold) {
    if (!this._drawOrigin) return null
    const dx = world.x - this._drawOrigin.x
    const dy = world.y - this._drawOrigin.y
    const dist = Math.hypot(dx, dy)
    if (dist < EPS) return null

    const rawDeg = Math.atan2(dy, dx) * 180 / Math.PI
    const inc = this.angleIncrement
    const snapDeg = Math.round(rawDeg / inc) * inc

    const rad = snapDeg * Math.PI / 180
    const p = {
      x: this._drawOrigin.x + dist * Math.cos(rad),
      y: this._drawOrigin.y + dist * Math.sin(rad)
    }
    this.activeSnap = { type: SNAP.ANGLE, point: p, color: SNAP_COLORS[SNAP.ANGLE], angle: snapDeg }
    bus.emit('snapChanged', this.activeSnap)
    return { ...p, snapped: true, snapType: SNAP.ANGLE, snapColor: SNAP_COLORS[SNAP.ANGLE], angle: snapDeg }
  }

  /* ── Grid (lowest priority) ── */
  _gridSnap(world) {
    const p = this._gridResult(world, Infinity)
    if (p) {
      this.activeSnap = { type: SNAP.GRID, point: p, color: SNAP_COLORS[SNAP.GRID] }
      bus.emit('snapChanged', this.activeSnap)
      return { ...p, snapped: true, snapType: SNAP.GRID, snapColor: SNAP_COLORS[SNAP.GRID] }
    }
    return { ...world, snapped: false, snapType: SNAP.NONE, snapColor: 0 }
  }

  _gridResult(world, threshold) {
    const g = this.coord.gridSize()
    const gx = Math.round(world.x / g) * g
    const gy = Math.round(world.y / g) * g
    const d = Math.hypot(gx - world.x, gy - world.y)
    if (d <= threshold) return { x: this.coord.round(gx), y: this.coord.round(gy) }
    return null
  }

  /* ── Force to specific type (modifier keys) ── */
  _forceType(type, world, threshold) {
    const result = this._trySnap(type, world, threshold)
    if (result) {
      this.activeSnap = { type, point: result, color: SNAP_COLORS[type] }
      bus.emit('snapChanged', this.activeSnap)
      return { ...result, snapped: true, snapType: type, snapColor: SNAP_COLORS[type] }
    }
    return { ...world, snapped: false, snapType: SNAP.NONE, snapColor: 0 }
  }

  /* ── Helpers ── */
  _closestCandidate(world, threshold, candidates) {
    let best = null, bestDist = Infinity
    for (const c of candidates) {
      const d = Math.hypot(c.x - world.x, c.y - world.y)
      if (d < threshold && d < bestDist) {
        best = c
        bestDist = d
      }
    }
    return best
  }

  _arcStartPt(e) {
    return { x: e.center.x + e.radius * Math.cos(e.startAngle), y: e.center.y + e.radius * Math.sin(e.startAngle) }
  }

  _arcEndPt(e) {
    return { x: e.center.x + e.radius * Math.cos(e.endAngle), y: e.center.y + e.radius * Math.sin(e.endAngle) }
  }

  /* ── Snap indicator visual metadata ── */
  static colors = SNAP_COLORS
}
