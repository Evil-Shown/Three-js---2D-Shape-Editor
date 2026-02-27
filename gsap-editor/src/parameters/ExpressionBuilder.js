// src/parameters/ExpressionBuilder.js

const POINT_REF_REGEX = /p(\d+)\.(x|y)/g
const IDENTIFIER_REGEX = /\b([A-Za-z_$][A-Za-z0-9_$]*)\b/g

const MATH_BUILTINS = new Set([
  'Math', 'sqrt', 'pow', 'abs', 'sin', 'cos', 'tan', 'atan2',
  'toRadians', 'toDegrees', 'PI', 'min', 'max', 'floor', 'ceil', 'round',
])

const RESERVED_NAMES = new Set([
  'trimLeft', 'trimBottom', 'true', 'false', 'null', 'undefined',
  'NaN', 'Infinity',
])

export class ExpressionBuilder {

  validate(expression, parameterStore) {
    if (!expression || !expression.trim()) {
      return { isValid: false, errors: ['Expression is empty'] }
    }

    const errors = []
    const expr = expression.trim()

    const identifiers = this._extractIdentifiers(expr)

    for (const ident of identifiers) {
      if (MATH_BUILTINS.has(ident)) continue
      if (RESERVED_NAMES.has(ident)) continue
      if (/^p\d+$/.test(ident)) continue

      const param = parameterStore.getParameterByName(ident)
      if (!param) {
        errors.push(`Unknown identifier: "${ident}"`)
      }
    }

    const pointRefs = [...expr.matchAll(POINT_REF_REGEX)]
    for (const match of pointRefs) {
      const pointIdx = parseInt(match[1], 10)
      if (pointIdx < 0) {
        errors.push(`Invalid point reference: p${pointIdx}`)
      }
    }

    try {
      this._checkSyntax(expr)
    } catch (e) {
      errors.push(`Syntax error: ${e.message}`)
    }

    return {
      isValid: errors.length === 0,
      errors,
    }
  }

  evaluate(expression, parameterValues, pointValues) {
    if (!expression || !expression.trim()) return NaN

    let expr = expression.trim()

    expr = expr.replace(/Math\.toRadians\(([^)]+)\)/g, '(($1) * Math.PI / 180)')
    expr = expr.replace(/Math\.toDegrees\(([^)]+)\)/g, '(($1) * 180 / Math.PI)')

    const scope = { Math, ...parameterValues }

    for (const [pointId, coords] of Object.entries(pointValues || {})) {
      scope[pointId] = coords
    }

    try {
      const fn = new Function(...Object.keys(scope), `"use strict"; return (${expr});`)
      return fn(...Object.values(scope))
    } catch {
      return NaN
    }
  }

  evaluateAll(parameterStore, geometryStore) {
    const params = parameterStore.getParameters()
    const paramValues = {}

    for (const p of params) {
      paramValues[p.name] = p.defaultValue
    }

    paramValues.trimLeft = 0
    paramValues.trimBottom = 0

    const pointExprs = parameterStore.getAllPointExpressions()
    const sortedPoints = this._topologicalSort(pointExprs)
    const computedPoints = {}
    const summary = { total: 0, assigned: 0, verified: 0, errors: [] }

    const shapePoints = this.extractShapePoints(geometryStore)
    summary.total = shapePoints.length

    for (const pointId of sortedPoints) {
      const expr = pointExprs[pointId]
      if (!expr) continue
      summary.assigned++

      const xVal = this.evaluate(expr.x, paramValues, computedPoints)
      const yVal = this.evaluate(expr.y, paramValues, computedPoints)

      computedPoints[pointId] = { x: xVal, y: yVal }

      const actual = shapePoints.find(sp => sp.id === pointId)
      if (actual) {
        const dx = Math.abs(xVal - actual.x)
        const dy = Math.abs(yVal - actual.y)
        const EPSILON = 0.1
        if (dx < EPSILON && dy < EPSILON) {
          summary.verified++
        } else {
          summary.errors.push({
            pointId,
            expected: { x: actual.x, y: actual.y },
            computed: { x: xVal, y: yVal },
          })
        }
      }
    }

    return { computedPoints, summary }
  }

  extractShapePoints(geometryStore) {
    const edges = geometryStore.getEdges()
    if (edges.length === 0) return []

    const points = []
    const seen = new Set()
    const EPSILON = 0.01

    const addPoint = (x, y) => {
      const key = `${Math.round(x * 100)}:${Math.round(y * 100)}`
      if (seen.has(key)) return
      seen.add(key)
      points.push({ id: `p${points.length}`, x, y })
    }

    for (const edge of edges) {
      if (edge.type === 'line') {
        addPoint(edge.start.x, edge.start.y)
      } else if (edge.type === 'arc') {
        const sx = edge.center.x + edge.radius * Math.cos(edge.startAngle)
        const sy = edge.center.y + edge.radius * Math.sin(edge.startAngle)
        addPoint(sx, sy)
      }
    }

    return points
  }

  toJavaExpression(expression) {
    if (!expression) return ''
    let java = expression.trim()
    java = java.replace(/\*\*/g, '___POW___')
    java = java.replace(/___POW___/g, 'MATH_POW_PLACEHOLDER')

    const powMatches = java.match(/MATH_POW_PLACEHOLDER/g)
    if (powMatches) {
      // Simple a**b patterns -> Math.pow(a, b)
      // For complex cases the user should write Math.pow() directly
    }

    java = java.replace(/Math\.toRadians/g, 'Math.toRadians')
    java = java.replace(/Math\.toDegrees/g, 'Math.toDegrees')

    return java
  }

  // --- Internal helpers ---

  _extractIdentifiers(expr) {
    const cleaned = expr
      .replace(POINT_REF_REGEX, '')
      .replace(/\d+\.?\d*/g, '')
      .replace(/[+\-*/().,<>=!&|?:%^~\s]/g, ' ')

    const matches = [...cleaned.matchAll(IDENTIFIER_REGEX)]
    const identifiers = new Set()
    for (const m of matches) {
      if (m[1] && !MATH_BUILTINS.has(m[1]) && !/^p\d+$/.test(m[1])) {
        identifiers.add(m[1])
      }
    }
    return identifiers
  }

  _checkSyntax(expr) {
    let safe = expr
    safe = safe.replace(POINT_REF_REGEX, '0')
    safe = safe.replace(IDENTIFIER_REGEX, (match) => {
      if (MATH_BUILTINS.has(match) || RESERVED_NAMES.has(match)) return match
      if (/^p\d+$/.test(match)) return '0'
      return '0'
    })

    try {
      new Function(`"use strict"; return (${safe});`)
    } catch (e) {
      throw new Error(e.message)
    }
  }

  _topologicalSort(pointExpressions) {
    const ids = Object.keys(pointExpressions)
    const deps = {}

    for (const id of ids) {
      deps[id] = new Set()
      const expr = pointExpressions[id]
      if (!expr) continue
      const combined = `${expr.x} ${expr.y}`
      const refs = [...combined.matchAll(POINT_REF_REGEX)]
      for (const ref of refs) {
        const dep = `p${ref[1]}`
        if (dep !== id && ids.includes(dep)) {
          deps[id].add(dep)
        }
      }
    }

    const sorted = []
    const visited = new Set()
    const visiting = new Set()

    const visit = (id) => {
      if (visited.has(id)) return
      if (visiting.has(id)) {
        throw new Error(`Circular dependency detected involving ${id}`)
      }
      visiting.add(id)
      for (const dep of (deps[id] || [])) {
        visit(dep)
      }
      visiting.delete(id)
      visited.add(id)
      sorted.push(id)
    }

    for (const id of ids) {
      visit(id)
    }

    return sorted
  }
}
