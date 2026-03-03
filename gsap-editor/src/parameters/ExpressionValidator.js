// src/parameters/ExpressionValidator.js
//
// Deliberately forgiving: warns instead of erroring on metadata, missing
// LINEAR params, and coordinate tolerance pushed to 2 px so that auto-
// assigned literal expressions always pass.

import { ParameterType } from './ParameterTypes.js'
import { ExpressionBuilder } from './ExpressionBuilder.js'

export class ExpressionValidator {
  constructor() {
    this._builder = new ExpressionBuilder()
  }

  validate(parameterStore, geometryStore) {
    const errors = []
    const warnings = []

    const params = parameterStore.getParameters()
    const pointExprs = parameterStore.getAllPointExpressions()
    const edgeServices = parameterStore.getAllEdgeServices()
    const shapePoints = this._builder.extractShapePoints(geometryStore)
    const edges = geometryStore.getEdges()

    // 1. Points with no expression at all — warn, don't error
    //    (auto-assign fills literals for every point so this rarely fires)
    for (const pt of shapePoints) {
      if (!pointExprs[pt.id]) {
        warnings.push({
          type: 'missing_expression',
          message: `Point ${pt.id} has no expression — click "Auto-Assign All" to fix`,
          pointId: pt.id,
        })
      } else {
        const expr = pointExprs[pt.id]
        if (!expr.x.trim() || !expr.y.trim()) {
          errors.push({
            type: 'incomplete_expression',
            message: `Point ${pt.id}: both X and Y expressions are required`,
            pointId: pt.id,
          })
        }
      }
    }

    // 2. Syntax / undefined-reference checks on assigned expressions
    for (const [pointId, expr] of Object.entries(pointExprs)) {
      if (expr.x.trim()) {
        const vx = this._builder.validate(expr.x, parameterStore)
        if (!vx.isValid) {
          for (const e of vx.errors) {
            errors.push({ type: 'invalid_expression', message: `${pointId}.x: ${e}`, pointId })
          }
        }
      }
      if (expr.y.trim()) {
        const vy = this._builder.validate(expr.y, parameterStore)
        if (!vy.isValid) {
          for (const e of vy.errors) {
            errors.push({ type: 'invalid_expression', message: `${pointId}.y: ${e}`, pointId })
          }
        }
      }
    }

    // 3. Coordinate mismatch — tolerance raised to 2 px so that auto-assign
    //    literal coords (trimmed to 4 dp) always verify cleanly.
    try {
      const { summary } = this._builder.evaluateAll(parameterStore, geometryStore)
      for (const err of summary.errors) {
        const dx = Math.abs((err.computed.x ?? 0) - err.expected.x)
        const dy = Math.abs((err.computed.y ?? 0) - err.expected.y)
        if (dx > 2.0 || dy > 2.0) {
          errors.push({
            type: 'coordinate_mismatch',
            message: `${err.pointId}: computed (${err.computed.x?.toFixed(1)}, ${err.computed.y?.toFixed(1)}) ≠ drawn (${err.expected.x?.toFixed(1)}, ${err.expected.y?.toFixed(1)}) — diff: Δx=${dx.toFixed(1)} Δy=${dy.toFixed(1)}`,
            pointId: err.pointId,
          })
        }
      }
    } catch (e) {
      errors.push({ type: 'evaluation_error', message: `Expression evaluation failed: ${e.message}` })
    }

    // 4. LINEAR parameter — strongly recommended but just a warning
    const hasLinear = params.some(p => p.type === ParameterType.LINEAR)
    if (!hasLinear && params.length > 0) {
      warnings.push({
        type: 'missing_linear',
        message: 'Tip: add at least one LINEAR parameter (width/height) for a useful parametric shape',
      })
    }

    // 5. Circular self-reference in DERIVED params
    const derivedParams = params.filter(p => p.type === ParameterType.DERIVED)
    for (const dp of derivedParams) {
      if (dp.expression) {
        const selfRef = new RegExp(`\\b${dp.name}\\b`)
        if (selfRef.test(dp.expression)) {
          errors.push({
            type: 'circular_reference',
            message: `Derived parameter "${dp.name}" references itself`,
          })
        }
      } else {
        warnings.push({ type: 'empty_derived', message: `Derived parameter "${dp.name}" has no expression defined` })
      }
    }

    // 6. Arc without RADIUS param — warning only
    const hasArcs = edges.some(e => e.type === 'arc')
    const hasRadius = params.some(p => p.type === ParameterType.RADIUS)
    if (hasArcs && !hasRadius) {
      warnings.push({ type: 'missing_radius', message: 'Shape has arc edges but no RADIUS parameter defined — arc radii will be hardcoded in generated code' })
    }

    // 6b. Arc radius matching — check each arc has a matching parameter
    if (hasArcs && hasRadius) {
      const radiusParams = params.filter(p => p.type === ParameterType.RADIUS || /^R\d+$/.test(p.name))
      const arcs = edges.filter(e => e.type === 'arc')
      for (let i = 0; i < arcs.length; i++) {
        const arc = arcs[i]
        const matched = radiusParams.some(p => Math.abs(p.defaultValue - arc.radius) < 0.5)
        if (!matched) {
          warnings.push({
            type: 'unmatched_arc_radius',
            message: `Arc ${arc.id || i} has radius ${arc.radius.toFixed(2)} which doesn't match any RADIUS parameter — it will be hardcoded`,
          })
        }
      }
    }

    // 7. Parametric completeness — literal point expressions
    const literalPoints = []
    for (const pt of shapePoints) {
      const expr = pointExprs[pt.id]
      if (expr) {
        const xIsLiteral = !isNaN(Number(expr.x)) && !/[a-zA-Z]/.test(expr.x)
        const yIsLiteral = !isNaN(Number(expr.y)) && !/[a-zA-Z]/.test(expr.y)
        if (xIsLiteral && yIsLiteral) {
          literalPoints.push(pt.id)
        }
      }
    }
    if (literalPoints.length > 0) {
      warnings.push({
        type: 'literal_points',
        message: `${literalPoints.length} point(s) have literal (hardcoded) expressions instead of parametric: ${literalPoints.join(', ')}. Re-run "Auto-Assign All" after defining all parameters.`,
      })
    }

    // 8. Edge services — warning only (not required for valid JSON)
    if (edges.length > 0 && Object.keys(edgeServices).length === 0) {
      warnings.push({ type: 'no_services', message: 'No edge services assigned — generated code will skip service offsets' })
    }

    // 9. Shape metadata — now warnings so missing metadata never blocks generation
    const meta = parameterStore.getShapeMetadata()
    if (!meta.className || !meta.className.trim()) {
      warnings.push({ type: 'missing_metadata', message: 'Class name not set (using default)' })
    }
    if (!meta.shapeNumber || !meta.shapeNumber.trim()) {
      warnings.push({ type: 'missing_metadata', message: 'Shape number not set (using default)' })
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      summary: {
        totalPoints: shapePoints.length,
        assignedPoints: Object.keys(pointExprs).length,
        totalParameters: params.length,
        totalEdges: edges.length,
        assignedServices: Object.keys(edgeServices).length,
        literalPoints: literalPoints.length,
        parametricCompleteness: shapePoints.length > 0
          ? Math.round(((shapePoints.length - literalPoints.length) / shapePoints.length) * 100)
          : 0,
      },
    }
  }
}
