// src/export/ExportService.js
// Exports geometry + parameters as JSON for Java shape generation.
// Key responsibilities:
//   1. Chain-order edges so end→start connectivity is valid.
//   2. Build a PARAMETRIC edge chain where edges reference point IDs
//      and arc radii reference parameter names — enabling Java code
//      generators to produce parametric code (like hand-written shapes).

import { ExpressionBuilder } from '../parameters/ExpressionBuilder.js'
import { PreviewSVGBuilder } from './PreviewSVGBuilder.js'

export class ExportService {
  constructor(store, paramStore) {
    this.store = store
    this.paramStore = paramStore || null
    this._exprBuilder = new ExpressionBuilder()
    this._previewBuilder = new PreviewSVGBuilder()
  }

  exportJSON(meta = { name: 'shape', thickness: 1 }) {
    if (this.store.getEdgeCount() === 0) {
      alert('Nothing to export')
      return
    }

    const rawEdges = this.store.getEdges()
    const hasParams = this.paramStore && this.paramStore.getExportPayload().parameters.length > 0

    // Chain-order edges so Java validator sees end→start connectivity
    const cleanEdges = rawEdges
      .map(e => hasParams ? this._cleanEdgeWithId(e) : this._cleanEdge(e))
      .filter(e => this._isValid(e))

    const chainedEdges = this._chainOrderEdges(cleanEdges)
    this._weldChainGaps(chainedEdges)

    // `edges` stays in the editor's native Y-up math space — the editor gallery
    // preview (`shapePayloadToSvg`) and round-trip import (`applyShapePayloadToStores`)
    // both rely on that. The shapes-service side mirrors Y when handing the payload
    // to the runtime engine (which expects SVG-style Y-down geometry).
    const payload = {
      name: meta.name,
      version: '2.0',
      unit: 'mm',
      thickness: meta.thickness,
      edges: chainedEdges,
    }

    if (hasParams) {
      const paramPayload = this.paramStore.getExportPayload()
      payload.shapeMetadata = paramPayload.shapeMetadata
      payload.parameters = paramPayload.parameters
      payload.edgeServices = paramPayload.edgeServices
      payload.pointExpressions = this._remapPointExpressions(
        rawEdges, chainedEdges, paramPayload.pointExpressions
      )

      // ── Parametric edge chain (v2.0) ─────────────────────────────────────
      // Edges reference point IDs and parameter names instead of absolute
      // coordinates, enabling Java code generators to produce parametric code.
      this._enrichWithParametricChain(payload, chainedEdges)
    }

    if (payload.edges.length === 0) {
      alert('No valid edges to export')
      return
    }

    // ── Debug: log final export chain ──
    console.group('📦 ExportService — Final Export')
    this._logEdgeChain(payload.edges, 'Exported edge chain')
    if (payload.pointExpressions) {
      console.log('Point expressions:', JSON.parse(JSON.stringify(payload.pointExpressions)))
    }
    console.groupEnd()

    const blob = new Blob(
      [JSON.stringify(payload, null, 2)],
      { type: 'application/json' }
    )

    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url

    const fileName = this.paramStore
      ? (this.paramStore.getShapeMetadata().className || meta.name)
      : meta.name
    a.download = `${fileName}.json`
    a.click()
    URL.revokeObjectURL(url)

    return payload
  }

  getExportPayload(meta = { name: 'shape', thickness: 1 }) {
    const rawEdges = this.store.getEdges()
    const hasParams = this.paramStore && this.paramStore.getExportPayload().parameters.length > 0

    const cleanEdges = rawEdges
      .map(e => hasParams ? this._cleanEdgeWithId(e) : this._cleanEdge(e))
      .filter(e => this._isValid(e))

    const chainedEdges = this._chainOrderEdges(cleanEdges)
    this._weldChainGaps(chainedEdges)

    // Keep `edges` in editor-native Y-up coordinates — see note in exportJSON().
    const payload = {
      name: meta.name,
      version: '2.0',
      unit: 'mm',
      thickness: meta.thickness,
      edges: chainedEdges,
    }

    if (hasParams) {
      const paramPayload = this.paramStore.getExportPayload()
      payload.shapeMetadata = paramPayload.shapeMetadata
      payload.parameters = paramPayload.parameters
      payload.edgeServices = paramPayload.edgeServices
      payload.pointExpressions = this._remapPointExpressions(
        rawEdges, chainedEdges, paramPayload.pointExpressions
      )

      // ── Parametric edge chain (v2.0) ─────────────────────────────────────
      this._enrichWithParametricChain(payload, chainedEdges)
    }

    return payload
  }

  /**
   * Trigger a browser download for an already-built payload object.
   * @param {object} payload  — result of getExportPayload()
   */
  downloadPayload(payload) {
    if (!payload) return
    const blob = new Blob(
      [JSON.stringify(payload, null, 2)],
      { type: 'application/json' }
    )
    const url = URL.createObjectURL(blob)
    const a   = document.createElement('a')
    a.href     = url
    a.download = `${payload.name || 'shape'}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  /* ════════════════════════════════════════════════════════════════════
   *  CHAIN ORDERING — sort edges into a connected loop
   * ════════════════════════════════════════════════════════════════════
   *
   * The Java shape validator expects edges in order where:
   *   edge[i].end ≈ edge[i+1].start   AND   edge[last].end ≈ edge[0].start
   *
   * Edges drawn in arbitrary order / direction get sorted + reversed here.
   */

  _chainOrderEdges(edges, epsilon = 1.5) {
    if (edges.length <= 1) return edges

    // Annotate each edge with computed start/end world coordinates
    const annotated = edges.map((e, i) => {
      const ep = this._edgeEndpoints(e)
      return { edge: e, idx: i, start: ep.start, end: ep.end }
    })

    console.group('🔗 Chain ordering edges')
    console.log(`Input: ${annotated.length} edges`)
    annotated.forEach((a, i) => {
      console.log(`  [${i}] ${a.edge.type} ${a.edge.id || ''}: (${a.start.x.toFixed(2)}, ${a.start.y.toFixed(2)}) → (${a.end.x.toFixed(2)}, ${a.end.y.toFixed(2)})`)
    })

    const used = new Set()
    const chain = []

    // Start with the first edge
    chain.push(annotated[0])
    used.add(0)
    let currentEnd = annotated[0].end
    console.log(`Start chain with edge[0], currentEnd=(${currentEnd.x.toFixed(2)}, ${currentEnd.y.toFixed(2)})`)

    // Greedy walk: find closest connecting edge
    while (chain.length < annotated.length) {
      let bestIdx = -1
      let bestReverse = false
      let bestDist = Infinity

      for (let i = 0; i < annotated.length; i++) {
        if (used.has(i)) continue
        const a = annotated[i]
        const d1 = Math.hypot(currentEnd.x - a.start.x, currentEnd.y - a.start.y)
        const d2 = Math.hypot(currentEnd.x - a.end.x, currentEnd.y - a.end.y)
        if (d1 < bestDist) { bestIdx = i; bestReverse = false; bestDist = d1 }
        if (d2 < bestDist) { bestIdx = i; bestReverse = true; bestDist = d2 }
      }

      if (bestIdx === -1) break

      used.add(bestIdx)
      const chosen = annotated[bestIdx]

      if (bestReverse) {
        // Reverse the edge so its end becomes start
        const reversed = this._reverseEdge(chosen.edge)
        const rep = this._edgeEndpoints(reversed)
        console.log(`  → edge[${bestIdx}] REVERSED (dist=${bestDist.toFixed(4)}): (${rep.start.x.toFixed(2)}, ${rep.start.y.toFixed(2)}) → (${rep.end.x.toFixed(2)}, ${rep.end.y.toFixed(2)})`)
        chain.push({ edge: reversed, idx: bestIdx, start: rep.start, end: rep.end })
        currentEnd = rep.end
      } else {
        console.log(`  → edge[${bestIdx}] forward  (dist=${bestDist.toFixed(4)}): (${chosen.start.x.toFixed(2)}, ${chosen.start.y.toFixed(2)}) → (${chosen.end.x.toFixed(2)}, ${chosen.end.y.toFixed(2)})`)
        chain.push(chosen)
        currentEnd = chosen.end
      }
    }

    // Append any unreachable edges at end
    for (let i = 0; i < annotated.length; i++) {
      if (!used.has(i)) {
        console.warn(`  ⚠ edge[${i}] unreachable — appending as-is`)
        chain.push(annotated[i])
      }
    }

    // Validate final chain
    const result = chain.map(c => c.edge)
    this._logEdgeChain(result, 'Chain result (before weld)')
    console.groupEnd()

    return result
  }

  /* ════════════════════════════════════════════════════════════════════
   *  CHAIN GAP WELDING — force exact end→start connectivity
   * ════════════════════════════════════════════════════════════════════
   *
   * After chain-ordering, tiny gaps may remain between consecutive edges
   * because arc endpoints are constrained to lie ON the circle. This pass
   * forces exact connectivity by choosing a "winner" for each junction:
   *
   *   • Arc endpoints WIN — they're computed from center+radius*cos/sin
   *     and the Java validator does the same computation, so changing
   *     the arc's angle is the only way to move its endpoint.
   *   • Line endpoints are FREE — their start/end can be set to any coord.
   *
   * Strategy per junction:
   *   arc→arc  : let curr arc's endpoint define the shared point; adjust next
   *   arc→line : arc end is truth; move line start to match
   *   line→arc : arc start is truth; move line end to match
   *   line→line: average, then set both
   */

  _weldChainGaps(edges, maxGap = 8.0) {
    if (edges.length < 2) return

    console.group('🔧 Welding chain gaps')
    let welded = 0

    for (let i = 0; i < edges.length; i++) {
      const curr = edges[i]
      const next = edges[(i + 1) % edges.length]

      const currEp = this._edgeEndpoints(curr)
      const nextEp = this._edgeEndpoints(next)

      const gap = Math.hypot(currEp.end.x - nextEp.start.x, currEp.end.y - nextEp.start.y)
      if (gap < 0.0001) continue  // already exact
      if (gap > maxGap) {
        console.warn(`  ⚠ Gap ${gap.toFixed(4)} too large to weld at [${i}]→[${(i + 1) % edges.length}]`)
        continue
      }

      let target

      if (curr.type === 'arc' && next.type === 'arc') {
        // Both arcs: current arc's on-circle endpoint wins
        target = { x: currEp.end.x, y: currEp.end.y }
        // Adjust next arc's startAngle to point toward current arc's endpoint
        const newAngle = Math.atan2(target.y - next.center.y, target.x - next.center.x)
        next.startAngle = newAngle
        // Recompute actual position (will be on next arc's circle, slight residual possible)
        const actual = {
          x: next.center.x + next.radius * Math.cos(newAngle),
          y: next.center.y + next.radius * Math.sin(newAngle)
        }
        console.log(`  [${i}]→[${(i + 1) % edges.length}] arc→arc gap=${gap.toFixed(4)}: target=(${target.x.toFixed(4)}, ${target.y.toFixed(4)}), residual=${Math.hypot(actual.x - target.x, actual.y - target.y).toFixed(6)}`)

      } else if (curr.type === 'arc') {
        // Arc→line: arc endpoint is truth, move line start
        target = { x: currEp.end.x, y: currEp.end.y }
        this._forceLineEndpoint(next, 'start', target)
        console.log(`  [${i}]→[${(i + 1) % edges.length}] arc→line gap=${gap.toFixed(4)}: line start → (${target.x.toFixed(4)}, ${target.y.toFixed(4)})`)

      } else if (next.type === 'arc') {
        // Line→arc: arc startpoint is truth, move line end
        target = { x: nextEp.start.x, y: nextEp.start.y }
        this._forceLineEndpoint(curr, 'end', target)
        console.log(`  [${i}]→[${(i + 1) % edges.length}] line→arc gap=${gap.toFixed(4)}: line end → (${target.x.toFixed(4)}, ${target.y.toFixed(4)})`)

      } else {
        // Both lines: average
        target = {
          x: Math.round((currEp.end.x + nextEp.start.x) / 2 * 10000) / 10000,
          y: Math.round((currEp.end.y + nextEp.start.y) / 2 * 10000) / 10000
        }
        this._forceLineEndpoint(curr, 'end', target)
        this._forceLineEndpoint(next, 'start', target)
        console.log(`  [${i}]→[${(i + 1) % edges.length}] line→line gap=${gap.toFixed(4)}: both → (${target.x.toFixed(4)}, ${target.y.toFixed(4)})`)
      }

      welded++
    }

    if (welded > 0) {
      this._logEdgeChain(edges, `Chain after welding ${welded} gap(s)`)
    } else {
      console.log('No gaps to weld — chain is already exact')
    }
    console.groupEnd()
  }

  /** Move a line's start or end to an exact target position */
  _forceLineEndpoint(edge, which, target) {
    if (edge.type !== 'line') return // safety — arcs handled separately
    if (which === 'start') {
      edge.start.x = target.x
      edge.start.y = target.y
    } else {
      edge.end.x = target.x
      edge.end.y = target.y
    }
  }

  /* ── Reverse an edge (flip direction) ── */

  _reverseEdge(edge) {
    if (edge.type === 'line') {
      return {
        ...edge,
        start: { x: edge.end.x, y: edge.end.y },
        end: { x: edge.start.x, y: edge.start.y },
      }
    }
    if (edge.type === 'arc') {
      return {
        ...edge,
        startAngle: edge.endAngle,
        endAngle: edge.startAngle,
        clockwise: !edge.clockwise,
      }
    }
    return edge
  }

  /* ── Compute start/end world coords for any edge ── */

  _edgeEndpoints(edge) {
    if (edge.type === 'line') {
      return {
        start: { x: edge.start.x, y: edge.start.y },
        end: { x: edge.end.x, y: edge.end.y },
      }
    }
    if (edge.type === 'arc') {
      return {
        start: {
          x: edge.center.x + edge.radius * Math.cos(edge.startAngle),
          y: edge.center.y + edge.radius * Math.sin(edge.startAngle),
        },
        end: {
          x: edge.center.x + edge.radius * Math.cos(edge.endAngle),
          y: edge.center.y + edge.radius * Math.sin(edge.endAngle),
        },
      }
    }
    return { start: { x: 0, y: 0 }, end: { x: 0, y: 0 } }
  }

  /* ════════════════════════════════════════════════════════════════════
   *  POINT EXPRESSION REMAPPING
   * ════════════════════════════════════════════════════════════════════
   *
   * When chain-ordering changes edge order, the point labels (p0, p1, ...)
   * change because extractShapePoints iterates edges sequentially.
   * We must remap pointExpression keys AND all pN references in expressions.
   */

  _remapPointExpressions(originalEdges, chainedEdges, pointExprs) {
    if (!pointExprs || Object.keys(pointExprs).length === 0) return pointExprs

    // Extract points in original order
    const oldPoints = this._extractPointsFromEdges(originalEdges)
    // Extract points in chain order
    const newPoints = this._extractPointsFromEdges(chainedEdges)

    console.group('🔄 Point remapping')
    console.log('Old points:', oldPoints.map(p => `${p.id}(${p.x.toFixed(2)},${p.y.toFixed(2)})`).join(', '))
    console.log('New points:', newPoints.map(p => `${p.id}(${p.x.toFixed(2)},${p.y.toFixed(2)})`).join(', '))

    // Build coordinate→oldLabel and coordinate→newLabel maps
    // Then compute old→new label mapping using CLOSEST match (not first)
    const MATCH_EPS = 3.0
    const remap = {} // oldLabel → newLabel

    for (const oldPt of oldPoints) {
      let bestNewId = null
      let bestDist = Infinity
      for (const newPt of newPoints) {
        const d = Math.hypot(oldPt.x - newPt.x, oldPt.y - newPt.y)
        if (d < MATCH_EPS && d < bestDist) {
          // Also check this newPt isn't already claimed by a closer oldPt
          bestDist = d
          bestNewId = newPt.id
        }
      }

      if (bestNewId) {
        remap[oldPt.id] = bestNewId
      } else {
        console.warn(`  ⚠ No match for old ${oldPt.id}(${oldPt.x.toFixed(2)},${oldPt.y.toFixed(2)})`)
        remap[oldPt.id] = oldPt.id // keep as-is
      }
    }

    // Resolve collisions: if multiple old points map to the same new point,
    // keep the closest one and try to find alternates for the rest
    const newToOld = {} // newId → [{oldId, dist}]
    for (const [oldId, newId] of Object.entries(remap)) {
      if (!newToOld[newId]) newToOld[newId] = []
      const oldPt = oldPoints.find(p => p.id === oldId)
      const newPt = newPoints.find(p => p.id === newId)
      const dist = oldPt && newPt ? Math.hypot(oldPt.x - newPt.x, oldPt.y - newPt.y) : Infinity
      newToOld[newId].push({ oldId, dist })
    }

    for (const [newId, mappings] of Object.entries(newToOld)) {
      if (mappings.length <= 1) continue
      // Sort by distance — closest keeps this mapping
      mappings.sort((a, b) => a.dist - b.dist)
      console.log(`  Collision on ${newId}: ${mappings.map(m => `${m.oldId}(d=${m.dist.toFixed(2)})`).join(', ')}`)
      // The closest keeps the mapping; others try to find next-closest unused newPt
      const usedNewIds = new Set(Object.values(remap))
      for (let k = 1; k < mappings.length; k++) {
        const oldPt = oldPoints.find(p => p.id === mappings[k].oldId)
        if (!oldPt) continue
        let altBestId = null
        let altBestDist = Infinity
        for (const newPt of newPoints) {
          if (newPt.id === newId) continue // skip the contested one
          // Check if this newPt already has a closer claimant
          const existingClaims = Object.entries(remap).filter(([, v]) => v === newPt.id)
          if (existingClaims.length > 0) {
            const claimant = oldPoints.find(p => p.id === existingClaims[0][0])
            if (claimant) {
              const claimDist = Math.hypot(claimant.x - newPt.x, claimant.y - newPt.y)
              const myDist = Math.hypot(oldPt.x - newPt.x, oldPt.y - newPt.y)
              if (claimDist < myDist) continue  // existing claimant is closer
            }
          }
          const d = Math.hypot(oldPt.x - newPt.x, oldPt.y - newPt.y)
          if (d < MATCH_EPS && d < altBestDist) {
            altBestDist = d
            altBestId = newPt.id
          }
        }
        if (altBestId) {
          console.log(`    ${mappings[k].oldId} reassigned → ${altBestId} (dist=${altBestDist.toFixed(2)})`)
          remap[mappings[k].oldId] = altBestId
        } else {
          console.warn(`    ${mappings[k].oldId} has no alternate — keeping ${newId}`)
        }
      }
    }

    // Check if any remapping is actually needed
    const needsRemap = Object.entries(remap).some(([k, v]) => k !== v)
    if (!needsRemap) {
      console.log('No remapping needed — point order unchanged')
      console.groupEnd()
      return pointExprs
    }

    console.log('Remap:', JSON.stringify(remap))

    // Apply remapping to point expressions
    const remapped = {}
    for (const [oldKey, expr] of Object.entries(pointExprs)) {
      const newKey = remap[oldKey] || oldKey
      remapped[newKey] = {
        x: this._remapExprString(expr.x, remap),
        y: this._remapExprString(expr.y, remap),
      }
      if (oldKey !== newKey || expr.x !== remapped[newKey].x || expr.y !== remapped[newKey].y) {
        console.log(`  ${oldKey} → ${newKey}: x="${expr.x}" → "${remapped[newKey].x}", y="${expr.y}" → "${remapped[newKey].y}"`)
      }
    }

    console.groupEnd()
    return remapped
  }

  /** Replace all pN references in an expression string using the remap */
  _remapExprString(expr, remap) {
    if (!expr) return expr
    // Use placeholder pass to avoid double-rename (p3→p5 then p5→p3)
    let result = expr
    const placeholders = {}
    for (const [oldLabel, newLabel] of Object.entries(remap)) {
      if (oldLabel === newLabel) continue
      const ph = `__PH_${oldLabel}__`
      placeholders[ph] = newLabel
      // Replace p3.x, p3.y, or standalone p3
      result = result.replace(new RegExp(`\\b${oldLabel}\\b`, 'g'), ph)
    }
    for (const [ph, newLabel] of Object.entries(placeholders)) {
      result = result.replace(new RegExp(ph.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), newLabel)
    }
    return result
  }

  /** Extract unique points from an edge array (same algo as ExpressionBuilder.extractShapePoints) */
  _extractPointsFromEdges(edges) {
    const points = []
    const seen = new Set()

    const addPoint = (x, y) => {
      const key = `${Math.round(x * 100)}:${Math.round(y * 100)}`
      if (seen.has(key)) return
      seen.add(key)
      points.push({ id: `p${points.length}`, x, y })
    }

    for (const edge of edges) {
      const ep = this._edgeEndpoints(edge)
      addPoint(ep.start.x, ep.start.y)
      addPoint(ep.end.x, ep.end.y)
    }

    return points
  }

  /* ── Debug logging ── */

  _logEdgeChain(edges, label) {
    console.log(`${label} (${edges.length} edges):`)
    for (let i = 0; i < edges.length; i++) {
      const e = edges[i]
      const ep = this._edgeEndpoints(e)
      const next = edges[(i + 1) % edges.length]
      const nep = this._edgeEndpoints(next)
      const gap = Math.hypot(ep.end.x - nep.start.x, ep.end.y - nep.start.y)
      const gapStr = gap < 0.01 ? '✓' : `⚠ gap=${gap.toFixed(4)}`
      console.log(
        `  [${i}] ${e.type} ${e.id || ''}: (${ep.start.x.toFixed(4)}, ${ep.start.y.toFixed(4)}) → (${ep.end.x.toFixed(4)}, ${ep.end.y.toFixed(4)})  → next: ${gapStr}`
      )
    }
  }

  /* ── Edge cleaning ── */

  _cleanPoint(p) {
    return { x: p.x, y: p.y }
  }

  _cleanEdge(edge) {
    if (edge.type === 'line') {
      return {
        type: 'line',
        start: this._cleanPoint(edge.start),
        end: this._cleanPoint(edge.end)
      }
    }
    if (edge.type === 'arc') {
      return {
        type: 'arc',
        center: this._cleanPoint(edge.center),
        radius: edge.radius,
        startAngle: edge.startAngle,
        endAngle: edge.endAngle,
        clockwise: edge.clockwise
      }
    }
    return edge
  }

  _cleanEdgeWithId(edge) {
    const clean = this._cleanEdge(edge)
    clean.id = edge.id
    return clean
  }

  _isValid(edge) {
    if (edge.type === 'line') {
      if (!edge.start || !edge.end) return false
      return Math.hypot(edge.end.x - edge.start.x, edge.end.y - edge.start.y) > 0.01
    }
    if (edge.type === 'arc') {
      if (!edge.center || !edge.radius || edge.radius <= 0) return false
      return Math.abs(edge.endAngle - edge.startAngle) >= 0.001
    }
    return false
  }

  /* ════════════════════════════════════════════════════════════════════════════
   *  PARAMETRIC EDGE CHAIN (v2.0)
   * ════════════════════════════════════════════════════════════════════════════
   *
   * The parametric chain re-expresses the raw edge chain using:
   *   • Point IDs       — instead of absolute {x, y} coordinates
   *   • Parameter names  — instead of hardcoded arc radius values
   *   • Arc SVG flags    — largeArc / sweep for endpoint-based arc format
   *   • Arc center expressions — how arc centers relate to parameters
   *
   * This enables Java code generators to produce:
   *     .straightEdge(p2)
   *     .arcEdge(R1, false, false, p3)
   *   instead of:
   *     .arcEdge(center0, 10000.0183, 0.0000, 1.5708, false)
   *
   * The raw "edges" array is kept for backward compatibility.
   */

  /**
   * Enrich the payload with parametric chain, topology, and completeness info.
   * Mutates `payload` in place.
   */
  _enrichWithParametricChain(payload, chainedEdges) {
    const shapePoints = this._exprBuilder.extractShapePoints({
      getEdges: () => chainedEdges,
    })

    payload.parametricEdges = this._buildParametricChain(
      chainedEdges, shapePoints,
      payload.parameters || [],
      payload.pointExpressions || {},
      payload.edgeServices || {}
    )
    payload.topology = this._buildTopology(chainedEdges, shapePoints)
    payload.parametricCompleteness = this._assessCompleteness(
      payload.parametricEdges, payload.pointExpressions || {}, shapePoints
    )

    // ── Shape preview SVG data ─────────────────────────────────────────
    // Generates SVGBuilder-compatible command sequences for thumbnail
    // and preview SVGs that the Java code generator uses to produce
    // the shape library preview code (SVGBuilder / SVGBuilder2).
    payload.preview = this._previewBuilder.build(
      chainedEdges,
      payload.parametricEdges,
      shapePoints,
      payload.parameters || [],
      payload.pointExpressions || {},
      payload.topology
    )

    // Log parametric chain for debugging
    console.group('🔮 Parametric Edge Chain')
    for (const pe of payload.parametricEdges) {
      if (pe.type === 'line') {
        console.log(`  LINE  ${pe.startPoint} → ${pe.endPoint}  [${pe.serviceLabel || 'no service'}]`)
      } else {
        const rLabel = pe.radiusParam || `raw:${pe.radiusValue.toFixed(2)}`
        console.log(`  ARC   ${pe.startPoint} → ${pe.endPoint}  R=${rLabel}  largeArc=${pe.largeArc} sweep=${pe.sweep}  [${pe.serviceLabel || 'no service'}]`)
        if (pe.centerExpression) {
          console.log(`        center: (${pe.centerExpression.x}, ${pe.centerExpression.y})`)
        }
      }
    }
    console.log('Topology:', JSON.stringify(payload.topology))
    console.log('Completeness:', JSON.stringify(payload.parametricCompleteness))
    if (payload.preview) {
      console.log('Preview thumbnail commands:', payload.preview.thumbnail?.commands?.length || 0)
      console.log('Preview dimensions:', payload.preview.preview?.dimensions?.length || 0)
    }
    console.groupEnd()
  }

  /**
   * Build the parametric edge chain.
   *
   * For each edge in the chain:
   *   LINE → { type, startPoint, endPoint, edgeId, serviceLabel }
   *   ARC  → { type, startPoint, endPoint, radiusParam, radiusValue,
   *            largeArc, sweep, edgeId, serviceLabel, centerExpression }
   */
  _buildParametricChain(chainedEdges, shapePoints, params, pointExprs, edgeServiceMap) {
    const parametricEdges = []

    for (let i = 0; i < chainedEdges.length; i++) {
      const edge = chainedEdges[i]
      const ep = this._edgeEndpoints(edge)

      const startPt = this._findClosestPoint(ep.start.x, ep.start.y, shapePoints)
      const endPt   = this._findClosestPoint(ep.end.x, ep.end.y, shapePoints)

      const serviceLabel = edgeServiceMap[edge.id] || null

      if (edge.type === 'line') {
        parametricEdges.push({
          type: 'line',
          edgeId: edge.id || null,
          startPoint: startPt ? startPt.id : null,
          endPoint:   endPt ? endPt.id : null,
          serviceLabel,
        })
      } else if (edge.type === 'arc') {
        const radiusMatch = this._matchRadiusToParam(edge.radius, params)
        const flags       = this._computeArcFlags(edge)
        const centerExpr  = this._computeCenterExpression(
          edge.center.x, edge.center.y,
          shapePoints, params, pointExprs
        )

        parametricEdges.push({
          type: 'arc',
          edgeId: edge.id || null,
          startPoint: startPt ? startPt.id : null,
          endPoint:   endPt ? endPt.id : null,
          radiusParam: radiusMatch ? radiusMatch.name : null,
          radiusValue: parseFloat(edge.radius.toFixed(4)),
          largeArc: flags.largeArc,
          sweep: flags.sweep,
          serviceLabel,
          centerExpression: centerExpr,
        })
      }
    }

    return parametricEdges
  }

  /* ── Point matching ────────────────────────────────────────────────────────
   * Find the closest shape point to a given coordinate.
   * Uses 2mm tolerance — covers arc endpoint cos/sin floating-point drift.
   */
  _findClosestPoint(x, y, shapePoints) {
    const TOLERANCE = 2.0
    let best = null, bestDist = Infinity

    for (const pt of shapePoints) {
      const d = Math.hypot(pt.x - x, pt.y - y)
      if (d < TOLERANCE && d < bestDist) {
        bestDist = d
        best = pt
      }
    }

    return best
  }

  /* ── Arc radius → parameter matching ───────────────────────────────────────
   *
   * Strategy (by priority):
   *   1. Exact match to a RADIUS-type parameter           (tolerance 0.5mm)
   *   2. Exact match to any parameter's defaultValue       (tolerance 0.5mm)
   *   3. Match to a parameter combination:
   *        L/2, H/2, L-R1, H-R1, etc.                     (tolerance 1.0mm)
   *
   * Returns { name, value } of the matching parameter, or null.
   */
  _matchRadiusToParam(radius, params) {
    const TIGHT = 0.5
    const LOOSE = 1.0
    if (radius <= 0 || params.length === 0) return null

    // Pass 1: RADIUS-type parameters — exact match
    const radiusParams = params.filter(p =>
      p.type === 'RADIUS' || /^R\d+$/.test(p.name)
    )
    for (const p of radiusParams) {
      if (Math.abs(p.defaultValue - radius) < TIGHT) {
        return { name: p.name, value: p.defaultValue }
      }
    }

    // Pass 2: Any parameter — exact match
    for (const p of params) {
      if (Math.abs(p.defaultValue - radius) < TIGHT) {
        return { name: p.name, value: p.defaultValue }
      }
    }

    // Pass 3: Simple expressions (L/2, H/2, etc.)
    for (const p of params) {
      if (p.defaultValue === 0) continue
      if (Math.abs(p.defaultValue / 2 - radius) < LOOSE) {
        return { name: `${p.name} / 2`, value: p.defaultValue / 2 }
      }
    }

    // Pass 4: Two-parameter combos (L - R1, H - R1, etc.)
    for (const a of params) {
      for (const b of params) {
        if (a === b || a.defaultValue === 0 || b.defaultValue === 0) continue
        if (Math.abs(a.defaultValue - b.defaultValue - radius) < LOOSE) {
          return { name: `${a.name} - ${b.name}`, value: a.defaultValue - b.defaultValue }
        }
        if (Math.abs(a.defaultValue + b.defaultValue - radius) < LOOSE) {
          return { name: `${a.name} + ${b.name}`, value: a.defaultValue + b.defaultValue }
        }
      }
    }

    return null
  }

  /* ── Arc SVG flags computation ─────────────────────────────────────────────
   *
   * Converts editor's arc representation {startAngle, endAngle, clockwise}
   * to SVG / Java EdgeBuilder flags:
   *   largeArc: true if the arc sweeps > 180°
   *   sweep:    SVG-space sweep flag (Y-down)
   *
   * Editor geometry is Y-up (math space), while SVG/preview is Y-down. Because
   * of that axis flip, sweep must be inverted from the editor's clockwise flag.
   * Keeping this aligned with PreviewSVGBuilder avoids arc-only mirror/flip
   * mismatches between thumbnail preview and generated shape geometry.
   */
  _computeArcFlags(arc) {
    // Compute the net sweep angle
    let sweep
    if (arc.clockwise) {
      sweep = arc.startAngle - arc.endAngle
      if (sweep <= 0) sweep += 2 * Math.PI
    } else {
      sweep = arc.endAngle - arc.startAngle
      if (sweep <= 0) sweep += 2 * Math.PI
    }

    return {
      largeArc: sweep > Math.PI,
      sweep: !!arc.clockwise,
    }
  }

  /* ── Arc center expression computation ─────────────────────────────────────
   *
   * Expresses the arc's center as parametric expressions relative to p0.
   * Uses the same delta-matching approach as SmartSuggestionEngine.
   *
   * This is needed for Java's resize2() which computes offset arc centers
   * for cutting/coating edges.
   *
   * Returns { x: expression, y: expression }.
   * Falls back to numeric-safe expressions when no parameter match is found.
   */
  _computeCenterExpression(cx, cy, shapePoints, params, pointExprs) {
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) {
      return { x: '0.0', y: '0.0' }
    }

    const p0 = Array.isArray(shapePoints) && shapePoints.length > 0
      ? shapePoints[0]
      : null

    if (!p0) {
      return {
        x: this._formatNumberLiteral(cx),
        y: this._formatNumberLiteral(cy),
      }
    }

    const dx = cx - p0.x
    const dy = cy - p0.y

    const hasParams = Array.isArray(params) && params.length > 0
    const xExpr = hasParams ? this._matchDeltaToExpression(dx, 'x', params) : null
    const yExpr = hasParams ? this._matchDeltaToExpression(dy, 'y', params) : null

    if (xExpr && yExpr) {
      return { x: xExpr, y: yExpr }
    }

    return {
      x: this._buildFallbackCenterExpression(dx, 'x'),
      y: this._buildFallbackCenterExpression(dy, 'y'),
    }
  }

  _buildFallbackCenterExpression(delta, axis) {
    const absDelta = Math.abs(delta)
    if (absDelta < 1e-9) return `p0.${axis}`

    const op = delta >= 0 ? '+' : '-'
    return `p0.${axis} ${op} ${this._formatNumberLiteral(absDelta)}`
  }

  _formatNumberLiteral(value) {
    const rounded = Math.round(value * 10000) / 10000
    return Number(rounded).toString()
  }

  /**
   * Match a single-axis delta from p0 to a parametric expression.
   * Tries increasingly complex combos until a match is found.
   */
  _matchDeltaToExpression(delta, axis, params) {
    const eps = 1.5
    const dimParam = axis === 'x'
      ? params.find(p => p.name === 'L')
      : params.find(p => p.name === 'H')
    const otherDimParam = axis === 'x'
      ? params.find(p => p.name === 'H')
      : params.find(p => p.name === 'L')
    const dim     = dimParam ? dimParam.defaultValue : null
    const dimName = dimParam ? dimParam.name : null
    const otherDim     = otherDimParam ? otherDimParam.defaultValue : null
    const otherDimName = otherDimParam ? otherDimParam.name : null

    const candidates = []

    // Origin
    candidates.push({ value: 0, expr: `p0.${axis}` })

    // Single parameter
    for (const p of params) {
      const v = p.defaultValue
      if (v === 0) continue
      candidates.push(
        { value: v,  expr: `p0.${axis} + ${p.name}` },
        { value: -v, expr: `p0.${axis} - ${p.name}` },
      )
    }

    // Dim ± param
    if (dim != null) {
      candidates.push(
        { value: dim,  expr: `p0.${axis} + ${dimName}` },
        { value: -dim, expr: `p0.${axis} - ${dimName}` },
      )
      for (const p of params) {
        if (p.name === dimName || p.defaultValue === 0) continue
        candidates.push(
          { value: dim - p.defaultValue,     expr: `p0.${axis} + ${dimName} - ${p.name}` },
          { value: dim + p.defaultValue,     expr: `p0.${axis} + ${dimName} + ${p.name}` },
          { value: -(dim - p.defaultValue),  expr: `p0.${axis} - ${dimName} + ${p.name}` },
          { value: dim - 2 * p.defaultValue, expr: `p0.${axis} + ${dimName} - 2 * ${p.name}` },
        )
      }
    }

    // Other dimension ± param
    if (otherDim != null && dimName && Math.abs(dim - otherDim) > eps) {
      candidates.push(
        { value: otherDim,  expr: `p0.${axis} + ${otherDimName}` },
        { value: -otherDim, expr: `p0.${axis} - ${otherDimName}` },
      )
      for (const p of params) {
        if (p.name === otherDimName || p.defaultValue === 0) continue
        candidates.push(
          { value: otherDim - p.defaultValue, expr: `p0.${axis} + ${otherDimName} - ${p.name}` },
          { value: otherDim + p.defaultValue, expr: `p0.${axis} + ${otherDimName} + ${p.name}` },
        )
      }
    }

    // Half dimension
    if (dim != null) {
      candidates.push(
        { value: dim / 2, expr: `p0.${axis} + ${dimName} / 2` },
      )
      for (const p of params) {
        if (p.name === dimName || p.defaultValue === 0) continue
        candidates.push(
          { value: dim / 2 + p.defaultValue, expr: `p0.${axis} + ${dimName} / 2 + ${p.name}` },
          { value: dim / 2 - p.defaultValue, expr: `p0.${axis} + ${dimName} / 2 - ${p.name}` },
        )
      }
    }

    // Two-parameter combos (no dim)
    for (let i = 0; i < params.length; i++) {
      for (let j = i + 1; j < params.length; j++) {
        const a = params[i], b = params[j]
        if (a.defaultValue === 0 || b.defaultValue === 0) continue
        candidates.push(
          { value: a.defaultValue + b.defaultValue,  expr: `p0.${axis} + ${a.name} + ${b.name}` },
          { value: a.defaultValue - b.defaultValue,  expr: `p0.${axis} + ${a.name} - ${b.name}` },
          { value: -(a.defaultValue - b.defaultValue), expr: `p0.${axis} - ${a.name} + ${b.name}` },
          { value: -(a.defaultValue + b.defaultValue), expr: `p0.${axis} - ${a.name} - ${b.name}` },
        )
      }
    }

    // Find best match
    let best = null, bestErr = Infinity
    for (const c of candidates) {
      const err = Math.abs(delta - c.value)
      if (err < eps && err < bestErr) {
        bestErr = err
        best = c
      }
    }

    return best ? best.expr : null
  }

  /* ── Topology metadata ─────────────────────────────────────────────────────
   * Provides shape structure info for the Java code generator.
   */
  _buildTopology(chainedEdges, shapePoints) {
    const lines = chainedEdges.filter(e => e.type === 'line')
    const arcs  = chainedEdges.filter(e => e.type === 'arc')

    // Check if the chain is closed (last edge end ≈ first edge start)
    let isClosed = false
    if (chainedEdges.length >= 2) {
      const first = this._edgeEndpoints(chainedEdges[0])
      const last  = this._edgeEndpoints(chainedEdges[chainedEdges.length - 1])
      isClosed = Math.hypot(last.end.x - first.start.x, last.end.y - first.start.y) < 2.0
    }

    // Detect shape type
    let shapeType = 'CUSTOM'
    if (lines.length === 4 && arcs.length === 4) shapeType = 'ROUNDED_RECTANGLE'
    else if (lines.length === 4 && arcs.length === 0) shapeType = 'RECTANGLE'
    else if (lines.length === 2 && arcs.length === 2) shapeType = 'SLOT'
    else if (arcs.length === 1 && arcs[0].radius > 0) {
      const sweep = Math.abs(arcs[0].endAngle - arcs[0].startAngle)
      if (Math.abs(sweep - 2 * Math.PI) < 0.1) shapeType = 'CIRCLE'
    }

    return {
      totalPoints: shapePoints.length,
      totalEdges:  chainedEdges.length,
      lineCount:   lines.length,
      arcCount:    arcs.length,
      isClosed,
      shapeType,
    }
  }

  /* ── Parametric completeness assessment ────────────────────────────────────
   * Reports whether the export is fully parametric or has gaps.
   */
  _assessCompleteness(parametricEdges, pointExprs, shapePoints) {
    const literalPoints = []
    const unmatchedArcs = []
    let allPointsParametric = true
    let allArcsParametric = true

    // Check point expressions — a point is "parametric" if its expression
    // contains at least one parameter reference (not just a literal number)
    for (const pt of shapePoints) {
      const expr = pointExprs[pt.id]
      if (!expr) {
        literalPoints.push(pt.id)
        allPointsParametric = false
        continue
      }
      const xIsLiteral = !isNaN(Number(expr.x)) && !/[a-zA-Z]/.test(expr.x)
      const yIsLiteral = !isNaN(Number(expr.y)) && !/[a-zA-Z]/.test(expr.y)
      if (xIsLiteral && yIsLiteral) {
        literalPoints.push(pt.id)
        allPointsParametric = false
      }
    }

    // Check arc radius mappings
    for (const pe of parametricEdges) {
      if (pe.type === 'arc' && !pe.radiusParam) {
        unmatchedArcs.push(pe.edgeId)
        allArcsParametric = false
      }
    }

    return {
      allPointsParametric,
      allArcsParametric,
      fullyParametric: allPointsParametric && allArcsParametric,
      literalPoints,
      unmatchedArcs,
    }
  }
}
