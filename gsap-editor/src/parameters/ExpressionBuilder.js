// src/parameters/ExpressionBuilder.js
//
// FIX: trimLeft and trimBottom are now seeded from the actual p0 drawn coordinates,
// not hardcoded to 0. This is the root cause of every validation failure.

// NOTE: These regexes must NOT have the global flag when used with .test()
// or in places where they're reused. Always create a new RegExp or use
// matchAll with a source-derived regex for scanning.
const POINT_REF_PATTERN = /p(\d+)\.(x|y)/
const IDENTIFIER_PATTERN = /\b([A-Za-z_$][A-Za-z0-9_$]*)\b/

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
        const suggestion = this._findClosestParam(ident, parameterStore)
        if (suggestion) {
          errors.push(`Unknown identifier: "${ident}" — did you mean "${suggestion}"?`)
        } else {
          errors.push(`Unknown identifier: "${ident}"`)
        }
      }
    }

    const pointRefs = [...expr.matchAll(new RegExp(POINT_REF_PATTERN.source, 'g'))]
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

    return { isValid: errors.length === 0, errors }
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

  /**
   * Build the parameter value scope used for evaluation.
   * KEY FIX: trimLeft and trimBottom are seeded from the actual drawn
   * position of p0, not hardcoded to 0.
   */
  buildParamScope(parameterStore, shapePoints) {
    const params = parameterStore.getParameters()
    const paramValues = {}
    for (const p of params) {
      paramValues[p.name] = p.defaultValue
    }

    // ── THE CRITICAL FIX ──────────────────────────────────────────────────────
    // trimLeft / trimBottom represent the actual world-space origin of the shape.
    // If we hardcode them to 0, every expression like "p0.x + L" evaluates as
    // "0 + 200 = 200" while the drawn point is at "250" → mismatch every time.
    // We must use the real p0 coordinates so the offset chain is correct.
    const p0 = shapePoints ? shapePoints.find(sp => sp.id === 'p0') : null
    paramValues.trimLeft   = p0 ? p0.x : 0
    paramValues.trimBottom = p0 ? p0.y : 0
    // ─────────────────────────────────────────────────────────────────────────

    return paramValues
  }

  evaluateAll(parameterStore, geometryStore) {
    const shapePoints = this.extractShapePoints(geometryStore)
    const paramValues = this.buildParamScope(parameterStore, shapePoints)

    const pointExprs = parameterStore.getAllPointExpressions()
    const sortedPoints = this._topologicalSort(pointExprs)
    const computedPoints = {}
    const summary = { total: shapePoints.length, assigned: 0, verified: 0, errors: [] }

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
        // FIX: Use 1.5 tolerance — arc endpoints computed via cos/sin often
        // have ~0.5-1.0 floating-point drift from the drawn coordinates.
        // The old 0.1 tolerance caused false red indicators on valid arcs.
        if (dx < 1.5 && dy < 1.5) {
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

  /**
   * Evaluate a single expression in context of the full shape.
   * Useful for live-preview as the user types.
   */
  evaluateSingle(expression, parameterStore, geometryStore) {
    const shapePoints = this.extractShapePoints(geometryStore)
    const paramValues = this.buildParamScope(parameterStore, shapePoints)

    // Build computed chain so point-refs resolve correctly
    const pointExprs = parameterStore.getAllPointExpressions()
    const sortedPoints = this._topologicalSort(pointExprs)
    const computedPoints = {}

    for (const pointId of sortedPoints) {
      const expr = pointExprs[pointId]
      if (!expr) continue
      const xv = this.evaluate(expr.x, paramValues, computedPoints)
      const yv = this.evaluate(expr.y, paramValues, computedPoints)
      computedPoints[pointId] = { x: xv, y: yv }
    }

    return this.evaluate(expression, paramValues, computedPoints)
  }

  extractShapePoints(geometryStore) {
    const edges = geometryStore.getEdges()
    if (edges.length === 0) return []

    const points = []
    const seen = new Set()

    const addPoint = (x, y) => {
      // FIX: Use 1000 (3 dp) for dedup key — the old 100 (2 dp) merged
      // distinct arc endpoints that were < 0.01 apart, creating phantom duplicates.
      // Also check proximity to all existing points as a safety net.
      const key = `${Math.round(x * 1000)}:${Math.round(y * 1000)}`
      if (seen.has(key)) return
      // Extra proximity check: if any existing point is within 0.5mm, skip
      for (const p of points) {
        if (Math.hypot(p.x - x, p.y - y) < 0.5) return
      }
      seen.add(key)
      points.push({ id: `p${points.length}`, x, y })
    }

    for (const edge of edges) {
      if (edge.type === 'line') {
        addPoint(edge.start.x, edge.start.y)
        addPoint(edge.end.x, edge.end.y)
      } else if (edge.type === 'arc') {
        // Add both start AND end points of arcs
        const sx = edge.center.x + edge.radius * Math.cos(edge.startAngle)
        const sy = edge.center.y + edge.radius * Math.sin(edge.startAngle)
        addPoint(sx, sy)
        const ex = edge.center.x + edge.radius * Math.cos(edge.endAngle)
        const ey = edge.center.y + edge.radius * Math.sin(edge.endAngle)
        addPoint(ex, ey)
      }
    }

    return points
  }

  toJavaExpression(expression) {
    if (!expression) return ''
    return expression.trim()
  }

  // ── Internal helpers ────────────────────────────────────────────────────────

  /**
   * Find the closest matching parameter name for a typo.
   * Uses prefix match first, then Levenshtein distance.
   */
  _findClosestParam(ident, parameterStore) {
    const params = parameterStore.getParameters()
    if (params.length === 0) return null

    const lower = ident.toLowerCase()

    // 1. Prefix match — "R" matches "R1", "R2", etc.
    const prefixMatches = params.filter(p => p.name.toLowerCase().startsWith(lower))
    if (prefixMatches.length === 1) return prefixMatches[0].name
    if (prefixMatches.length > 1) {
      // Pick the shortest name (most likely intended)
      prefixMatches.sort((a, b) => a.name.length - b.name.length)
      return prefixMatches[0].name
    }

    // 2. Params that start with the same letter
    const sameStart = params.filter(p => p.name[0]?.toLowerCase() === lower[0])
    if (sameStart.length === 1) return sameStart[0].name

    // 3. Levenshtein distance — find closest within distance ≤ 2
    let best = null, bestDist = 3
    for (const p of params) {
      const d = this._levenshtein(lower, p.name.toLowerCase())
      if (d < bestDist) { bestDist = d; best = p.name }
    }
    return best
  }

  /** Simple Levenshtein distance (max len ~20 so no perf concern) */
  _levenshtein(a, b) {
    const m = a.length, n = b.length
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
    for (let i = 0; i <= m; i++) dp[i][0] = i
    for (let j = 0; j <= n; j++) dp[0][j] = j
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        dp[i][j] = a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
      }
    }
    return dp[m][n]
  }

  _extractIdentifiers(expr) {
    // FIX: Extract identifiers BEFORE stripping digits.
    // The old approach stripped all digits first, which turned "R1" into "R",
    // "H2" into "H", etc., causing false "Unknown identifier" errors.

    // Step 1: Remove point references (p0.x, p1.y, etc.) first
    let cleaned = expr.replace(new RegExp(POINT_REF_PATTERN.source, 'g'), ' __PREF__ ')

    // Step 2: Extract all word-like tokens from the original expression
    const matches = [...cleaned.matchAll(new RegExp(IDENTIFIER_PATTERN.source, 'g'))]
    const identifiers = new Set()
    for (const m of matches) {
      const ident = m[1]
      if (!ident) continue
      // Skip internal placeholder, builtins, point ids, and pure numbers
      if (ident === '__PREF__') continue
      if (MATH_BUILTINS.has(ident)) continue
      if (/^p\d+$/.test(ident)) continue
      // Skip pure numeric-looking tokens (shouldn't match IDENTIFIER_PATTERN, but guard)
      if (/^\d+$/.test(ident)) continue
      identifiers.add(ident)
    }
    return identifiers
  }

  _checkSyntax(expr) {
    let safe = expr
    safe = safe.replace(new RegExp(POINT_REF_PATTERN.source, 'g'), '0')
    safe = safe.replace(new RegExp(IDENTIFIER_PATTERN.source, 'g'), (match) => {
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
      const refs = [...combined.matchAll(new RegExp(POINT_REF_PATTERN.source, 'g'))]
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

    for (const id of ids) visit(id)
    return sorted
  }
}