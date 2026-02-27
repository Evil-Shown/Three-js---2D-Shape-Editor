// src/parameters/ExpressionValidator.js

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

    // 1. All points must have expressions assigned
    for (const pt of shapePoints) {
      if (!pointExprs[pt.id]) {
        errors.push({
          type: 'missing_expression',
          message: `Point ${pt.id} has no expression assigned`,
          pointId: pt.id,
        })
      } else {
        const expr = pointExprs[pt.id]
        if (!expr.x.trim() || !expr.y.trim()) {
          errors.push({
            type: 'incomplete_expression',
            message: `Point ${pt.id} has incomplete expressions (both X and Y required)`,
            pointId: pt.id,
          })
        }
      }
    }

    // 2. All expressions must be valid (no undefined parameter references)
    for (const [pointId, expr] of Object.entries(pointExprs)) {
      if (expr.x.trim()) {
        const vx = this._builder.validate(expr.x, parameterStore)
        if (!vx.isValid) {
          for (const e of vx.errors) {
            errors.push({
              type: 'invalid_expression',
              message: `${pointId}.x: ${e}`,
              pointId,
            })
          }
        }
      }
      if (expr.y.trim()) {
        const vy = this._builder.validate(expr.y, parameterStore)
        if (!vy.isValid) {
          for (const e of vy.errors) {
            errors.push({
              type: 'invalid_expression',
              message: `${pointId}.y: ${e}`,
              pointId,
            })
          }
        }
      }
    }

    // 3. All expressions must evaluate to values matching drawn coordinates
    try {
      const { summary } = this._builder.evaluateAll(parameterStore, geometryStore)
      for (const err of summary.errors) {
        errors.push({
          type: 'coordinate_mismatch',
          message: `${err.pointId}: computed (${err.computed.x?.toFixed(2)}, ${err.computed.y?.toFixed(2)}) ≠ drawn (${err.expected.x?.toFixed(2)}, ${err.expected.y?.toFixed(2)})`,
          pointId: err.pointId,
        })
      }
    } catch (e) {
      errors.push({
        type: 'evaluation_error',
        message: `Expression evaluation failed: ${e.message}`,
      })
    }

    // 4. At least one LINEAR parameter
    const hasLinear = params.some(p => p.type === ParameterType.LINEAR)
    if (!hasLinear) {
      errors.push({
        type: 'missing_linear',
        message: 'At least one LINEAR parameter (dimension) is required',
      })
    }

    // 5. No circular references in DERIVED parameters
    const derivedParams = params.filter(p => p.type === ParameterType.DERIVED)
    for (const dp of derivedParams) {
      if (dp.expression) {
        const selfRef = new RegExp(`\\b${dp.name}\\b`)
        if (selfRef.test(dp.expression)) {
          errors.push({
            type: 'circular_reference',
            message: `Derived parameter "${dp.name}" references itself in expression: ${dp.expression}`,
          })
        }
      } else {
        warnings.push({
          type: 'empty_derived',
          message: `Derived parameter "${dp.name}" has no expression defined`,
        })
      }
    }

    // 6. If arcs exist, at least one RADIUS parameter should be defined
    const hasArcs = edges.some(e => e.type === 'arc')
    const hasRadius = params.some(p => p.type === ParameterType.RADIUS)
    if (hasArcs && !hasRadius) {
      warnings.push({
        type: 'missing_radius',
        message: 'Shape has arc edges but no RADIUS parameters defined',
      })
    }

    // 7. Edge service assignment warnings
    if (edges.length > 0 && Object.keys(edgeServices).length === 0) {
      warnings.push({
        type: 'no_services',
        message: 'No edge services assigned — generated code will lack service offset handling',
      })
    }

    // 8. Shape metadata completeness
    const meta = parameterStore.getShapeMetadata()
    if (!meta.className || !meta.className.trim()) {
      errors.push({ type: 'missing_metadata', message: 'Class name is required' })
    }
    if (!meta.shapeNumber || !meta.shapeNumber.trim()) {
      errors.push({ type: 'missing_metadata', message: 'Shape number is required' })
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
      },
    }
  }
}
