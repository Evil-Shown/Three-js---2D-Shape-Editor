// src/parameters/AutoAssignService.js
//
// Attempts to automatically assign mathematically correct expressions to all
// shape points in a single call. Works in two passes:
//
//   Pass 1 — p0 is always "trimLeft / trimBottom" (the origin anchor)
//   Pass 2 — for each remaining point, SmartSuggestionEngine finds the best
//            expression, then verifies it evaluates correctly before saving.
//            Falls back to literal coordinates if no param match is found.

import { ExpressionBuilder } from './ExpressionBuilder.js'
import { SmartSuggestionEngine } from './SmartSuggestionEngine.js'
import { GeometryAnalyzer } from './GeometryAnalyzer.js'

export class AutoAssignService {
  constructor() {
    this._builder = new ExpressionBuilder()
    this._suggEngine = new SmartSuggestionEngine()
  }

  /**
   * Auto-assign expressions for all shape points.
   *
   * @param {object} parameterStore
   * @param {object} geometryStore
   * @returns {{ assigned: number, paramMatched: number, literals: string[], failed: string[] }}
   */
  autoAssignAll(parameterStore, geometryStore) {
    const shapePoints = this._builder.extractShapePoints(geometryStore)
    if (shapePoints.length === 0) {
      return { assigned: 0, paramMatched: 0, literals: [], failed: [] }
    }

    const stats = { assigned: 0, paramMatched: 0, literals: [], failed: [] }

    // ── Shape-aware fast-path (rounded rect, rectangle, etc.) ───────────────
    if (this._tryShapeAwareAssign(parameterStore, geometryStore, shapePoints)) {
      return { assigned: shapePoints.length, paramMatched: shapePoints.length, literals: [], failed: [] }
    }

    // ── Pass 1: p0 ──────────────────────────────────────────────────────────
    parameterStore.setPointExpression('p0', 'trimLeft', 'trimBottom')
    stats.assigned++
    stats.paramMatched++

    // ── Pass 2: all other points ────────────────────────────────────────────
    // We process in order so that later points can reference earlier ones
    for (const pt of shapePoints) {
      if (pt.id === 'p0') continue

      const suggestions = this._suggEngine.suggest(
        pt.id, pt.x, pt.y, parameterStore, shapePoints
      )

      // Try each X/Y suggestion pair until one verifies correctly
      const xCandidates = suggestions.x
      const yCandidates = suggestions.y

      let assigned = false

      for (const xExpr of xCandidates) {
        for (const yExpr of yCandidates) {
          if (this._verifyPair(xExpr, yExpr, pt, parameterStore, geometryStore)) {
            parameterStore.setPointExpression(pt.id, xExpr, yExpr)
            stats.assigned++

            // Track whether we used a param expression or a literal
            const isLiteral = !isNaN(Number(xExpr)) && !isNaN(Number(yExpr))
            if (isLiteral) {
              stats.literals.push(pt.id)
            } else {
              stats.paramMatched++
            }

            assigned = true
            break
          }
        }
        if (assigned) break
      }

      if (!assigned) {
        // Last resort: use raw coordinate literals — at least the shape validates
        const xLit = pt.x.toFixed(4)
        const yLit = pt.y.toFixed(4)
        parameterStore.setPointExpression(pt.id, xLit, yLit)
        stats.assigned++
        stats.literals.push(pt.id)
      }
    }

    return stats
  }

  /**
   * Auto-assign only points that currently have no expression (non-destructive).
   */
  autoAssignMissing(parameterStore, geometryStore) {
    const shapePoints = this._builder.extractShapePoints(geometryStore)
    const existingExprs = parameterStore.getAllPointExpressions()

    // If no expressions set yet, try shape-aware bulk assignment first
    const hasAnyExpr = shapePoints.some(pt => {
      const e = existingExprs[pt.id]
      return e && (e.x || '').trim() && (e.y || '').trim()
    })
    if (!hasAnyExpr && this._tryShapeAwareAssign(parameterStore, geometryStore, shapePoints)) {
      return shapePoints.length
    }

    let assigned = 0

    for (const pt of shapePoints) {
      const existing = existingExprs[pt.id]
      if (existing && existing.x.trim() && existing.y.trim()) continue

      if (pt.id === 'p0') {
        parameterStore.setPointExpression('p0', 'trimLeft', 'trimBottom')
        assigned++
        continue
      }

      const suggestions = this._suggEngine.suggest(
        pt.id, pt.x, pt.y, parameterStore, shapePoints
      )

      let done = false
      for (const xExpr of suggestions.x) {
        for (const yExpr of suggestions.y) {
          if (this._verifyPair(xExpr, yExpr, pt, parameterStore, geometryStore)) {
            parameterStore.setPointExpression(pt.id, xExpr, yExpr)
            assigned++
            done = true
            break
          }
        }
        if (done) break
      }

      if (!done) {
        parameterStore.setPointExpression(pt.id, pt.x.toFixed(4), pt.y.toFixed(4))
        assigned++
      }
    }

    return assigned
  }

  // ── Shape-aware assignment ─────────────────────────────────────────────────

  /**
   * Attempt to auto-assign using geometric templates for known shape types.
   * Returns true if the shape was handled, false if generic engine should run.
   */
  _tryShapeAwareAssign(parameterStore, geometryStore, shapePoints) {
    const edges = geometryStore.getEdges()
    const lines = edges.filter(e => e.type === 'line')
    const arcs  = edges.filter(e => e.type === 'arc')

    // Rounded rectangle: 4 lines + 4 arcs → 8 vertices
    if (lines.length === 4 && arcs.length === 4 && shapePoints.length === 8) {
      return this._assignRoundedRect(parameterStore, shapePoints)
    }

    // Simple rectangle: 4 lines → 4 vertices
    if (lines.length === 4 && arcs.length === 0 && shapePoints.length === 4) {
      return this._assignRectangle(parameterStore, shapePoints)
    }

    // ── Generic mixed shape with arcs ──
    // Handles any combination of lines + arcs (e.g. rect with 1-3 rounded corners,
    // slot shapes, arch + rectangle combos, etc.)
    if (arcs.length > 0 && lines.length > 0) {
      return this._assignMixedArcShape(parameterStore, geometryStore, shapePoints)
    }

    return false
  }

  /**
   * Generic assignment for mixed shapes with arcs and lines.
   * Uses delta-from-p0 matching against all available parameters,
   * including radius parameters with multiplier combos.
   */
  _assignMixedArcShape(parameterStore, geometryStore, shapePoints) {
    const params = parameterStore.getParameters()
    if (params.length === 0) return false

    // Need at least L and H for a useful assignment
    const pL = params.find(p => p.name === 'L')
    const pH = params.find(p => p.name === 'H')
    if (!pL || !pH) return false

    const L = pL.defaultValue
    const H = pH.defaultValue

    // Collect all radius params (R1, R2, R3, etc.)
    const radiusParams = params.filter(p => p.name.match(/^R\d+$/))
    const radiusValues = radiusParams.map(p => ({ name: p.name, value: p.defaultValue }))

    const p0 = shapePoints[0]
    parameterStore.setPointExpression('p0', 'trimLeft', 'trimBottom')

    let assignedCount = 1 // p0

    for (let i = 1; i < shapePoints.length; i++) {
      const pt = shapePoints[i]
      const dx = pt.x - p0.x
      const dy = pt.y - p0.y

      const xExpr = this._matchMixedDelta(dx, 'x', L, H, radiusValues, params)
      const yExpr = this._matchMixedDelta(dy, 'y', L, H, radiusValues, params)

      if (xExpr && yExpr) {
        // Verify the expression evaluates correctly before assigning
        if (this._verifyPair(xExpr, yExpr, pt, parameterStore, geometryStore)) {
          parameterStore.setPointExpression(pt.id, xExpr, yExpr)
          assignedCount++
        } else {
          // Fallback to literal
          parameterStore.setPointExpression(pt.id, pt.x.toFixed(4), pt.y.toFixed(4))
          assignedCount++
        }
      } else {
        parameterStore.setPointExpression(pt.id, pt.x.toFixed(4), pt.y.toFixed(4))
        assignedCount++
      }
    }

    return assignedCount === shapePoints.length
  }

  /**
   * Match a coordinate delta for a mixed arc+line shape.
   * Tries all combinations of L, H, and any radius parameters.
   */
  _matchMixedDelta(delta, axis, L, H, radiusValues, allParams) {
    const eps = 1.5
    const dim     = axis === 'x' ? L : H
    const dimName = axis === 'x' ? 'L' : 'H'
    const otherDim     = axis === 'x' ? H : L
    const otherDimName = axis === 'x' ? 'H' : 'L'

    const candidates = [
      { value: 0,    expr: `p0.${axis}` },
      { value: dim,  expr: `p0.${axis} + ${dimName}` },
      { value: -dim, expr: `p0.${axis} - ${dimName}` },
    ]

    // Add L/H and other dimension
    if (Math.abs(dim - otherDim) > eps) {
      candidates.push(
        { value: otherDim,  expr: `p0.${axis} + ${otherDimName}` },
        { value: -otherDim, expr: `p0.${axis} - ${otherDimName}` },
      )
    }

    // For each radius param, generate single-radius and combo candidates
    for (const rp of radiusValues) {
      const R = rp.value
      const rName = rp.name

      // Single radius
      candidates.push(
        { value: R,              expr: `p0.${axis} + ${rName}` },
        { value: -R,             expr: `p0.${axis} - ${rName}` },
      )

      // dim ± R
      candidates.push(
        { value: dim - R,        expr: `p0.${axis} + ${dimName} - ${rName}` },
        { value: -(dim - R),     expr: `p0.${axis} - ${dimName} + ${rName}` },
        { value: dim + R,        expr: `p0.${axis} + ${dimName} + ${rName}` },
      )

      // dim ± 2*R
      candidates.push(
        { value: dim - 2 * R,    expr: `p0.${axis} + ${dimName} - 2 * ${rName}` },
        { value: -(dim - 2 * R), expr: `p0.${axis} - ${dimName} + 2 * ${rName}` },
      )

      // Other dimension ± R
      if (Math.abs(dim - otherDim) > eps) {
        candidates.push(
          { value: otherDim - R,        expr: `p0.${axis} + ${otherDimName} - ${rName}` },
          { value: -(otherDim - R),     expr: `p0.${axis} - ${otherDimName} + ${rName}` },
          { value: otherDim - 2 * R,    expr: `p0.${axis} + ${otherDimName} - 2 * ${rName}` },
          { value: -(otherDim - 2 * R), expr: `p0.${axis} - ${otherDimName} + 2 * ${rName}` },
        )
      }

      // Half-radius and half-dim combos
      candidates.push(
        { value: dim / 2,       expr: `p0.${axis} + ${dimName} / 2` },
        { value: dim / 2 + R,   expr: `p0.${axis} + ${dimName} / 2 + ${rName}` },
        { value: dim / 2 - R,   expr: `p0.${axis} + ${dimName} / 2 - ${rName}` },
      )
    }

    // Cross-radius combos (R1 ± R2, etc.)
    for (let i = 0; i < radiusValues.length; i++) {
      for (let j = i + 1; j < radiusValues.length; j++) {
        const r1 = radiusValues[i], r2 = radiusValues[j]
        candidates.push(
          { value: r1.value + r2.value,   expr: `p0.${axis} + ${r1.name} + ${r2.name}` },
          { value: r1.value - r2.value,   expr: `p0.${axis} + ${r1.name} - ${r2.name}` },
          { value: dim - r1.value - r2.value,
            expr: `p0.${axis} + ${dimName} - ${r1.name} - ${r2.name}` },
        )
      }
    }

    // Also try all registered params (not just radius) for single-value matches
    for (const p of allParams) {
      if (p.name === 'L' || p.name === 'H' || p.name.match(/^R\d+$/)) continue
      const v = p.defaultValue
      if (v === 0) continue
      candidates.push(
        { value: v,  expr: `p0.${axis} + ${p.name}` },
        { value: -v, expr: `p0.${axis} - ${p.name}` },
        { value: dim + v,  expr: `p0.${axis} + ${dimName} + ${p.name}` },
        { value: dim - v,  expr: `p0.${axis} + ${dimName} - ${p.name}` },
      )
    }

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

  /**
   * Template assignment for ROUNDED_RECTANGLE (4 lines + 4 arcs).
   * Uses L (width), H (height), R1 (corner radius) — the standard params
   * produced by GeometryAnalyzer.
   *
   * Canonical offsets from bounding-box corner (minX, minY):
   *   (R1, 0)  (L-R1, 0)  (L, R1)  (L, H-R1)
   *   (L-R1, H)  (R1, H)  (0, H-R1)  (0, R1)
   *
   * By computing each point's delta from p0 and matching against
   * the set of possible deltas, we always get the geometrically
   * correct expression regardless of parameter-value coincidences.
   */
  _assignRoundedRect(parameterStore, shapePoints) {
    const params = parameterStore.getParameters()
    const pL  = params.find(p => p.name === 'L')
    const pH  = params.find(p => p.name === 'H')
    const pR1 = params.find(p => p.name === 'R1')

    if (!pL || !pH || !pR1) return false

    const L  = pL.defaultValue
    const H  = pH.defaultValue
    const R1 = pR1.defaultValue

    // Optional second radius
    const pR2 = params.find(p => p.name === 'R2')
    const R2  = pR2 ? pR2.defaultValue : null

    const p0 = shapePoints[0]
    parameterStore.setPointExpression('p0', 'trimLeft', 'trimBottom')

    for (let i = 1; i < shapePoints.length; i++) {
      const pt = shapePoints[i]
      const dx = pt.x - p0.x
      const dy = pt.y - p0.y

      const xExpr = this._matchRRDelta(dx, 'x', L, H, R1, R2)
      const yExpr = this._matchRRDelta(dy, 'y', L, H, R1, R2)

      if (xExpr && yExpr) {
        parameterStore.setPointExpression(pt.id, xExpr, yExpr)
      } else {
        // Fallback to literal (rare for well-formed rounded rects)
        parameterStore.setPointExpression(pt.id, pt.x.toFixed(4), pt.y.toFixed(4))
      }
    }

    return true
  }

  /**
   * Match a coordinate delta to a symbolic expression for a rounded rectangle.
   * Tries every possible delta produced by the 8 canonical vertex positions,
   * picking the closest match.  Uses the primary axis dimension (L for x,
   * H for y) first, and only considers the other dimension when L ≠ H.
   */
  _matchRRDelta(delta, axis, L, H, R1, R2) {
    const eps = 1.5
    const dim     = axis === 'x' ? L : H
    const dimName = axis === 'x' ? 'L' : 'H'

    const candidates = [
      { value: 0,                expr: `p0.${axis}` },
      { value: dim - 2 * R1,    expr: `p0.${axis} + ${dimName} - 2 * R1` },
      { value: -(dim - 2 * R1), expr: `p0.${axis} - ${dimName} + 2 * R1` },
      { value: dim - R1,        expr: `p0.${axis} + ${dimName} - R1` },
      { value: -(dim - R1),     expr: `p0.${axis} - ${dimName} + R1` },
      { value: dim,             expr: `p0.${axis} + ${dimName}` },
      { value: -dim,            expr: `p0.${axis} - ${dimName}` },
      { value: R1,              expr: `p0.${axis} + R1` },
      { value: -R1,             expr: `p0.${axis} - R1` },
    ]

    // Second corner radius
    if (R2 != null && Math.abs(R2 - R1) > eps) {
      candidates.push(
        { value: R2,              expr: `p0.${axis} + R2` },
        { value: -R2,             expr: `p0.${axis} - R2` },
        { value: dim - R2,        expr: `p0.${axis} + ${dimName} - R2` },
        { value: -(dim - R2),     expr: `p0.${axis} - ${dimName} + R2` },
        { value: dim - 2 * R2,    expr: `p0.${axis} + ${dimName} - 2 * R2` },
        { value: -(dim - 2 * R2), expr: `p0.${axis} - ${dimName} + 2 * R2` },
      )
    }

    // If L ≠ H, also try the other dimension
    const otherDim     = axis === 'x' ? H : L
    const otherDimName = axis === 'x' ? 'H' : 'L'
    if (Math.abs(dim - otherDim) > eps) {
      candidates.push(
        { value: otherDim,             expr: `p0.${axis} + ${otherDimName}` },
        { value: -otherDim,            expr: `p0.${axis} - ${otherDimName}` },
        { value: otherDim - R1,        expr: `p0.${axis} + ${otherDimName} - R1` },
        { value: -(otherDim - R1),     expr: `p0.${axis} - ${otherDimName} + R1` },
        { value: otherDim - 2 * R1,    expr: `p0.${axis} + ${otherDimName} - 2 * R1` },
        { value: -(otherDim - 2 * R1), expr: `p0.${axis} - ${otherDimName} + 2 * R1` },
      )
    }

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

  /**
   * Template assignment for a simple RECTANGLE (4 lines, 4 vertices).
   * Uses L (width), H (height).
   */
  _assignRectangle(parameterStore, shapePoints) {
    const params = parameterStore.getParameters()
    const pL = params.find(p => p.name === 'L')
    const pH = params.find(p => p.name === 'H')
    if (!pL || !pH) return false

    const L = pL.defaultValue
    const H = pH.defaultValue
    const p0 = shapePoints[0]

    parameterStore.setPointExpression('p0', 'trimLeft', 'trimBottom')

    for (let i = 1; i < shapePoints.length; i++) {
      const pt = shapePoints[i]
      const dx = pt.x - p0.x
      const dy = pt.y - p0.y

      const xExpr = this._matchRectDelta(dx, 'x', L, H)
      const yExpr = this._matchRectDelta(dy, 'y', L, H)

      if (xExpr && yExpr) {
        parameterStore.setPointExpression(pt.id, xExpr, yExpr)
      } else {
        parameterStore.setPointExpression(pt.id, pt.x.toFixed(4), pt.y.toFixed(4))
      }
    }

    return true
  }

  _matchRectDelta(delta, axis, L, H) {
    const eps = 1.5
    const dim     = axis === 'x' ? L : H
    const dimName = axis === 'x' ? 'L' : 'H'

    const candidates = [
      { value: 0,    expr: `p0.${axis}` },
      { value: dim,  expr: `p0.${axis} + ${dimName}` },
      { value: -dim, expr: `p0.${axis} - ${dimName}` },
    ]

    const otherDim     = axis === 'x' ? H : L
    const otherDimName = axis === 'x' ? 'H' : 'L'
    if (Math.abs(dim - otherDim) > eps) {
      candidates.push(
        { value: otherDim,  expr: `p0.${axis} + ${otherDimName}` },
        { value: -otherDim, expr: `p0.${axis} - ${otherDimName}` },
      )
    }

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

  // ── Private ────────────────────────────────────────────────────────────────

  _verifyPair(xExpr, yExpr, targetPt, parameterStore, geometryStore) {
    try {
      const shapePoints = this._builder.extractShapePoints(geometryStore)
      const paramValues = this._builder.buildParamScope(parameterStore, shapePoints)

      // Build computed map from already-saved expressions
      const allExprs = parameterStore.getAllPointExpressions()
      const computed = {}
      for (const sp of shapePoints) {
        const pe = allExprs[sp.id]
        if (!pe) continue
        const xv = this._builder.evaluate(pe.x, paramValues, computed)
        const yv = this._builder.evaluate(pe.y, paramValues, computed)
        if (!isNaN(xv) && !isNaN(yv)) {
          computed[sp.id] = { x: xv, y: yv }
        }
      }

      const xv = this._builder.evaluate(xExpr, paramValues, computed)
      const yv = this._builder.evaluate(yExpr, paramValues, computed)

      if (isNaN(xv) || isNaN(yv)) return false

      const dx = Math.abs(xv - targetPt.x)
      const dy = Math.abs(yv - targetPt.y)
      // FIX: Use 1.5 tolerance to match evaluateAll — arc endpoints computed
      // via cos/sin can drift ~0.5–1.0 from drawn coordinates.
      return dx < 1.5 && dy < 1.5
    } catch {
      return false
    }
  }
}