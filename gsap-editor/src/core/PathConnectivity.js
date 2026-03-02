// src/core/PathConnectivity.js
// Robust topology engine for path connectivity validation and auto-healing.
//
// Responsibilities:
// 1. Extract endpoints from all edge types (line, arc)
// 2. Build a vertex graph with epsilon-based matching
// 3. Validate single closed loop (every vertex degree == 2)
// 4. Auto-weld: snap nearby endpoints to exact same coords
// 5. Provide diagnostic info (which vertices are open, what's disconnected)
// 6. Find the "first point" of the current drawing session for auto-close

import { bus } from './EventBus.js'

// Tolerance in world units.  Dynamic epsilon is also available via setEpsilon().
const DEFAULT_EPSILON = 2.0

// Progressive heal passes — each wider than the last
const HEAL_PASSES = [2.0, 4.0, 6.0, 8.0]

export class PathConnectivity {
  constructor(geometryStore) {
    this.store = geometryStore
    this.epsilon = DEFAULT_EPSILON
  }

  /** Dynamically adjust epsilon (e.g. from zoom level) */
  setEpsilon(eps) {
    this.epsilon = eps > 0 ? eps : DEFAULT_EPSILON
  }

  /* ════════════════════════════════════════════════════════
   *  1. ENDPOINT EXTRACTION
   * ════════════════════════════════════════════════════════ */

  /** Get start/end world points for any edge */
  static edgeEndpoints(edge) {
    if (edge.type === 'line') {
      return {
        start: { x: edge.start.x, y: edge.start.y },
        end:   { x: edge.end.x,   y: edge.end.y }
      }
    }
    if (edge.type === 'arc') {
      return {
        start: {
          x: edge.center.x + edge.radius * Math.cos(edge.startAngle),
          y: edge.center.y + edge.radius * Math.sin(edge.startAngle)
        },
        end: {
          x: edge.center.x + edge.radius * Math.cos(edge.endAngle),
          y: edge.center.y + edge.radius * Math.sin(edge.endAngle)
        }
      }
    }
    return null
  }

  /* ════════════════════════════════════════════════════════
   *  2. VERTEX GRAPH
   * ════════════════════════════════════════════════════════ */

  /**
   * Build a vertex graph from all edges in the store.
   * Each vertex has: { x, y, degree, edgeRefs: [{ edgeId, which: 'start'|'end' }] }
   *
   * Vertices are merged when within this.epsilon of each other.
   */
  buildGraph(edges) {
    if (!edges) edges = this.store.getEdges()
    const vertices = []

    const findOrAdd = (x, y) => {
      for (const v of vertices) {
        if (Math.hypot(v.x - x, v.y - y) < this.epsilon) {
          v.degree++
          return v
        }
      }
      const v = { x, y, degree: 1, edgeRefs: [] }
      vertices.push(v)
      return v
    }

    for (const edge of edges) {
      const ep = PathConnectivity.edgeEndpoints(edge)
      if (!ep) continue
      const sv = findOrAdd(ep.start.x, ep.start.y)
      sv.edgeRefs.push({ edgeId: edge.id, which: 'start' })
      const ev = findOrAdd(ep.end.x, ep.end.y)
      ev.edgeRefs.push({ edgeId: edge.id, which: 'end' })
    }

    return vertices
  }

  /* ════════════════════════════════════════════════════════
   *  3. CLOSURE VALIDATION
   * ════════════════════════════════════════════════════════ */

  /**
   * Check if the current set of edges forms a single closed loop.
   * Returns { closed, vertices, openVertices, diagnostics }
   */
  validate(edges) {
    if (!edges) edges = this.store.getEdges()
    console.log(`[PathConnectivity.validate] ${edges.length} edges, epsilon=${this.epsilon}`)
    if (edges.length < 2) {
      return {
        closed: false,
        vertices: [],
        openVertices: [],
        diagnostics: 'Need at least 2 edges to form a closed shape.'
      }
    }

    const vertices = this.buildGraph(edges)
    const openVertices = vertices.filter(v => v.degree !== 2)

    if (openVertices.length === 0 && vertices.length >= 2) {
      console.log(`[PathConnectivity.validate] ✓ CLOSED — ${vertices.length} vertices, all degree 2`)
      return { closed: true, vertices, openVertices: [], diagnostics: '' }
    }

    console.log(`[PathConnectivity.validate] ✗ NOT CLOSED — ${openVertices.length} open vertices:`)
    openVertices.forEach(v => {
      console.log(`  vertex (${v.x.toFixed(4)}, ${v.y.toFixed(4)}) degree=${v.degree}, refs: ${v.edgeRefs.map(r => `${r.edgeId}:${r.which}`).join(', ')}`)
    })

    // Build diagnostic message
    const parts = []
    const degree1 = openVertices.filter(v => v.degree === 1)
    const degree3Plus = openVertices.filter(v => v.degree >= 3)

    if (degree1.length > 0) {
      parts.push(`${degree1.length} open endpoint(s) — these edges don't connect to anything`)
    }
    if (degree3Plus.length > 0) {
      parts.push(`${degree3Plus.length} junction(s) with ${degree3Plus.map(v => v.degree).join(',')} connections — edges overlap or branch`)
    }

    // Check if it's "almost closed" — only 2 open endpoints close to each other
    let almostClosed = false
    let gap = Infinity
    if (degree1.length === 2 && degree3Plus.length === 0) {
      gap = Math.hypot(degree1[0].x - degree1[1].x, degree1[0].y - degree1[1].y)
      if (gap < 12.0) {
        almostClosed = true
        parts.push(`Gap of ${gap.toFixed(2)} mm between endpoints — auto-heal can fix this`)
      }
    }

    return {
      closed: false,
      vertices,
      openVertices,
      almostClosed,
      gap,
      diagnostics: `${edges.length} edges, ${vertices.length} vertices. ${parts.join('. ')}.`
    }
  }

  /* ════════════════════════════════════════════════════════
   *  4. AUTO-WELD (endpoint merging / healing)
   * ════════════════════════════════════════════════════════
   *
   * For each pair of endpoints within epsilon, force them to share
   * the exact same coordinates (average of the two).
   *
   * This mutates edges in the store directly.
   * Returns number of welds performed.
   */

  autoWeld() {
    const edges = this.store.getEdges()
    if (edges.length < 2) return 0
    console.log(`[PathConnectivity.autoWeld] Checking ${edges.length} edges, epsilon=${this.epsilon}`)

    // Collect all endpoints with references back to edges
    const points = [] // { x, y, edgeId, which: 'start'|'end' }
    for (const e of edges) {
      const ep = PathConnectivity.edgeEndpoints(e)
      if (!ep) continue
      points.push({ x: ep.start.x, y: ep.start.y, edgeId: e.id, which: 'start' })
      points.push({ x: ep.end.x,   y: ep.end.y,   edgeId: e.id, which: 'end' })
    }

    let welds = 0
    const visited = new Set()

    for (let i = 0; i < points.length; i++) {
      if (visited.has(i)) continue
      const cluster = [i]

      // Find all points within epsilon of point i
      for (let j = i + 1; j < points.length; j++) {
        if (visited.has(j)) continue
        // Don't weld both ends of the same edge together
        if (points[i].edgeId === points[j].edgeId) continue
        const d = Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y)
        if (d < this.epsilon) {
          cluster.push(j)
        }
      }

      if (cluster.length < 2) continue

      // Compute average position
      let ax = 0, ay = 0
      for (const idx of cluster) { ax += points[idx].x; ay += points[idx].y }
      ax /= cluster.length
      ay /= cluster.length

      // Round to 4 dp
      ax = Math.round(ax * 10000) / 10000
      ay = Math.round(ay * 10000) / 10000

      // Apply weld
      for (const idx of cluster) {
        const pt = points[idx]
        if (Math.abs(pt.x - ax) < 1e-6 && Math.abs(pt.y - ay) < 1e-6) continue // already exact

        const edge = this.store.getEdgeById(pt.edgeId)
        if (!edge) continue

        if (edge.type === 'line') {
          if (pt.which === 'start') {
            edge.start.x = ax; edge.start.y = ay
          } else {
            edge.end.x = ax; edge.end.y = ay
          }
          this.store.replaceEdge(pt.edgeId, edge)
          welds++
        } else if (edge.type === 'arc') {
          // For arcs, we adjust the angle to match the welded point precisely
          if (pt.which === 'start') {
            edge.startAngle = Math.atan2(ay - edge.center.y, ax - edge.center.x)
          } else {
            edge.endAngle = Math.atan2(ay - edge.center.y, ax - edge.center.x)
          }
          this.store.replaceEdge(pt.edgeId, edge)
          welds++
        }

        visited.add(idx)
      }
      // Mark first point visited too
      visited.add(cluster[0])
    }

    if (welds > 0) {
      console.log(`[PathConnectivity.autoWeld] Performed ${welds} weld(s)`)
      bus.emit('geometryHealed', { welds })
    } else {
      console.log(`[PathConnectivity.autoWeld] No welds needed`)
    }

    return welds
  }

  /* ════════════════════════════════════════════════════════
   *  5. PROGRESSIVE AUTO-HEAL
   * ════════════════════════════════════════════════════════
   *
   * Runs multiple autoWeld passes with increasing epsilon.
   * After each pass, re-validates. Stops as soon as the shape is closed.
   * Returns { healed: boolean, totalWelds: number, passesUsed: number }
   */

  autoHealGaps() {
    const edges = this.store.getEdges()
    if (edges.length < 2) return { healed: false, totalWelds: 0, passesUsed: 0 }

    let totalWelds = 0
    let passesUsed = 0
    const savedEpsilon = this.epsilon

    for (const eps of HEAL_PASSES) {
      // Quick check — already closed?
      const check = this.validate(edges)
      if (check.closed) {
        this.epsilon = savedEpsilon
        return { healed: totalWelds > 0, totalWelds, passesUsed }
      }

      passesUsed++
      this.epsilon = eps
      const welds = this.autoWeld()
      totalWelds += welds

      if (welds > 0) {
        console.log(`[autoHealGaps] Pass ${passesUsed} (eps=${eps}): ${welds} weld(s)`)
      }
    }

    this.epsilon = savedEpsilon

    // Final verification
    const final = this.validate(this.store.getEdges())
    return { healed: final.closed && totalWelds > 0, totalWelds, passesUsed }
  }

  /**
   * Targeted heal — when only 2 open endpoints remain and they're
   * within `maxGap`, force-weld them together (even if > normal epsilon).
   * This catches the common "almost closed" case.
   */
  healAlmostClosed(maxGap = 10.0) {
    const edges = this.store.getEdges()
    if (edges.length < 2) return false

    const result = this.validate(edges)
    if (result.closed) return false
    if (!result.almostClosed) return false
    if (result.gap > maxGap) return false

    const openVerts = result.openVertices.filter(v => v.degree === 1)
    if (openVerts.length !== 2) return false

    // Compute average merge target
    const ax = Math.round((openVerts[0].x + openVerts[1].x) / 2 * 10000) / 10000
    const ay = Math.round((openVerts[0].y + openVerts[1].y) / 2 * 10000) / 10000

    console.log(`[healAlmostClosed] Closing gap of ${result.gap.toFixed(4)} mm → (${ax}, ${ay})`)

    let welds = 0
    for (const vert of openVerts) {
      for (const ref of vert.edgeRefs) {
        const edge = this.store.getEdgeById(ref.edgeId)
        if (!edge) continue

        if (edge.type === 'line') {
          if (ref.which === 'start') {
            edge.start.x = ax; edge.start.y = ay
          } else {
            edge.end.x = ax; edge.end.y = ay
          }
          this.store.replaceEdge(ref.edgeId, edge)
          welds++
        } else if (edge.type === 'arc') {
          if (ref.which === 'start') {
            edge.startAngle = Math.atan2(ay - edge.center.y, ax - edge.center.x)
          } else {
            edge.endAngle = Math.atan2(ay - edge.center.y, ax - edge.center.x)
          }
          this.store.replaceEdge(ref.edgeId, edge)
          welds++
        }
      }
    }

    if (welds > 0) {
      console.log(`[healAlmostClosed] Welded ${welds} endpoint(s) to close shape`)
      bus.emit('geometryHealed', { welds })
    }

    return welds > 0
  }

  /* ════════════════════════════════════════════════════════
   *  6. PATH FIRST / LAST POINT DETECTION
   * ════════════════════════════════════════════════════════
   *
   * Find the "open" endpoints of the current path — useful for
   * auto-close snapping. Returns { firstPoint, lastPoint } or null.
   */

  getOpenEnds() {
    const edges = this.store.getEdges()
    if (edges.length === 0) return null

    const vertices = this.buildGraph(edges)
    const openVerts = vertices.filter(v => v.degree === 1)

    if (openVerts.length === 0) return null  // already closed
    if (openVerts.length === 2) {
      return { firstPoint: openVerts[0], lastPoint: openVerts[1] }
    }
    // More than 2 open ends — multiple paths, return the first pair
    return { firstPoint: openVerts[0], lastPoint: openVerts[1] }
  }

  /**
   * Get ALL open endpoints as snap candidates — the SnapEngine
   * will use these for "close-path" snapping.
   */
  getOpenEndpointsForSnap() {
    const edges = this.store.getEdges()
    if (edges.length === 0) return []

    const vertices = this.buildGraph(edges)
    return vertices
      .filter(v => v.degree === 1)
      .map(v => ({ x: v.x, y: v.y, _isOpenEnd: true }))
  }
}
