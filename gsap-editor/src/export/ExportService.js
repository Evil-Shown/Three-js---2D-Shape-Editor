// src/export/ExportService.js
// Exports geometry + parameters as JSON for Java shape generation.
// Key responsibility: chain-order edges so end→start connectivity is valid.

export class ExportService {
  constructor(store, paramStore) {
    this.store = store
    this.paramStore = paramStore || null
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

    const payload = {
      name: meta.name,
      version: '1.0',
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

    const payload = {
      name: meta.name,
      version: '1.0',
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
}
