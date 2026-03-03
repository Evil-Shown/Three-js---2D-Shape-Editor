// src/parameters/SmartSuggestionEngine.js
//
// Generates geometry-aware expression suggestions for each shape point.
// Instead of generic "p0.x + L" guesses, this engine computes the actual
// delta between the drawn coordinate and known reference points, then
// finds which parameter combination (if any) matches that delta exactly.

const MATCH_EPSILON = 0.5 // mm — tolerance for considering a match "exact"

export class SmartSuggestionEngine {
  /**
   * Generate ranked X and Y expression suggestions for a given point.
   *
   * @param {string}  pointId       - e.g. 'p2'
   * @param {number}  drawnX        - actual drawn world X
   * @param {number}  drawnY        - actual drawn world Y
   * @param {object}  parameterStore
   * @param {Array}   shapePoints   - [{id, x, y}, ...]
   * @returns {{ x: string[], y: string[] }}
   */
  suggest(pointId, drawnX, drawnY, parameterStore, shapePoints) {
    // p0 always gets fixed expressions — handled elsewhere
    if (pointId === 'p0') {
      return { x: ['trimLeft'], y: ['trimBottom'] }
    }

    const params = parameterStore.getParameters()
    const p0 = shapePoints.find(p => p.id === 'p0')
    if (!p0) return { x: [String(drawnX.toFixed(4))], y: [String(drawnY.toFixed(4))] }

    const x = this._axissuggestions(drawnX, 'x', p0, params, shapePoints, pointId)
    const y = this._axisSuggestions(drawnY, 'y', p0, params, shapePoints, pointId)

    return { x, y }
  }

  // ── Private ────────────────────────────────────────────────────────────────

  _axissuggestions(target, axis, p0, params, shapePoints, currentPointId) {
    return this._axisSuggestions(target, axis, p0, params, shapePoints, currentPointId)
  }

  /**
   * For a single axis, produce a ranked list of expression strings.
   *
   * Base scores:
   *   1.0   single parameter (p0.x + L)
   *   0.95  exact origin (p0.x)
   *   0.9   another point ref (p2.x)
   *   0.85  ref-point + param (p2.x + R1)
   *   0.82  extended combo (p0.x + L - 2 * R1, p0.x + L + R1)
   *   0.8   two-param combo (p0.x + L - R1)
   *   0.75  half-param (p0.x + L / 2)
   *   0.1   literal fallback
   *
   * Final ranking uses accuracy-weighted scoring:
   *   adjustedScore = baseScore × (1 − error / (2 × ε))
   * so a high-accuracy multi-param expression beats a low-accuracy
   * single-param when their parameter values are close.
   */
  _axisSuggestions(target, axis, p0, params, shapePoints, currentPointId) {
    const candidates = [] // { expr, score, error }
    const origin = axis === 'x' ? p0.x : p0.y
    const delta = target - origin

    // ── 1. Exact origin match ────────────────────────────────────────────────
    const originErr = Math.abs(delta)
    if (originErr < MATCH_EPSILON) {
      candidates.push({ expr: `p0.${axis}`, score: 0.95, error: originErr })
    }

    // ── 2. Single-parameter match ────────────────────────────────────────────
    for (const p of params) {
      const v = p.defaultValue
      if (v === 0) continue

      const errPlus = Math.abs(delta - v)
      if (errPlus < MATCH_EPSILON) {
        candidates.push({ expr: `p0.${axis} + ${p.name}`, score: 1.0, error: errPlus })
      }
      const errMinus = Math.abs(delta + v)
      if (errMinus < MATCH_EPSILON) {
        candidates.push({ expr: `p0.${axis} - ${p.name}`, score: 1.0, error: errMinus })
      }
    }

    // ── 3. Another point's coordinate matches ────────────────────────────────
    for (const sp of shapePoints) {
      if (sp.id === currentPointId || sp.id === 'p0') continue
      const spCoord = axis === 'x' ? sp.x : sp.y
      const err = Math.abs(target - spCoord)
      if (err < MATCH_EPSILON) {
        candidates.push({ expr: `${sp.id}.${axis}`, score: 0.9, error: err })
      }
    }

    // ── 4. Two-parameter combos (p0 + A − B, p0 − A − B) ──────────────────
    for (let i = 0; i < params.length; i++) {
      for (let j = 0; j < params.length; j++) {
        if (i === j) continue
        const a = params[i], b = params[j]
        if (a.defaultValue === 0 || b.defaultValue === 0) continue

        // p0 + A - B
        const err1 = Math.abs(delta - a.defaultValue + b.defaultValue)
        if (err1 < MATCH_EPSILON) {
          candidates.push({ expr: `p0.${axis} + ${a.name} - ${b.name}`, score: 0.8, error: err1 })
        }

        // p0 + A + B
        const err2 = Math.abs(delta - a.defaultValue - b.defaultValue)
        if (err2 < MATCH_EPSILON) {
          candidates.push({ expr: `p0.${axis} + ${a.name} + ${b.name}`, score: 0.8, error: err2 })
        }

        // p0 - A - B (both subtracted — common in negative-offset shapes)
        if (i < j) {
          const err3 = Math.abs(delta + a.defaultValue + b.defaultValue)
          if (err3 < MATCH_EPSILON) {
            candidates.push({ expr: `p0.${axis} - ${a.name} - ${b.name}`, score: 0.8, error: err3 })
          }
        }
      }
    }

    // ── 4b. Extended combos with multiplier ──────────────────────────────────
    //   Crucial for rounded rectangles: straight segment = L − 2 * R1
    for (let i = 0; i < params.length; i++) {
      for (let j = 0; j < params.length; j++) {
        if (i === j) continue
        const a = params[i], b = params[j]
        if (a.defaultValue === 0 || b.defaultValue === 0) continue

        // p0 + A - 2*B
        const err3 = Math.abs(delta - a.defaultValue + 2 * b.defaultValue)
        if (err3 < MATCH_EPSILON) {
          candidates.push({ expr: `p0.${axis} + ${a.name} - 2 * ${b.name}`, score: 0.82, error: err3 })
        }

        // p0 - A + 2*B
        const err4 = Math.abs(delta + a.defaultValue - 2 * b.defaultValue)
        if (err4 < MATCH_EPSILON) {
          candidates.push({ expr: `p0.${axis} - ${a.name} + 2 * ${b.name}`, score: 0.82, error: err4 })
        }
      }
    }

    // ── 5. Half-parameter combos (useful for arcs: p0.x + L/2) ──────────────
    for (const p of params) {
      if (p.defaultValue === 0) continue
      const err = Math.abs(delta - p.defaultValue / 2)
      if (err < MATCH_EPSILON) {
        candidates.push({ expr: `p0.${axis} + ${p.name} / 2`, score: 0.75, error: err })
      }
      // Negative half
      const errN = Math.abs(delta + p.defaultValue / 2)
      if (errN < MATCH_EPSILON) {
        candidates.push({ expr: `p0.${axis} - ${p.name} / 2`, score: 0.75, error: errN })
      }
    }

    // ── 5b. Reference-point + parameter offset (pN.x ± P) ───────────────────
    for (const sp of shapePoints) {
      if (sp.id === currentPointId || sp.id === 'p0') continue
      const spCoord = axis === 'x' ? sp.x : sp.y
      const spDelta = target - spCoord

      for (const p of params) {
        if (p.defaultValue === 0) continue

        const errPlus = Math.abs(spDelta - p.defaultValue)
        if (errPlus < MATCH_EPSILON) {
          candidates.push({ expr: `${sp.id}.${axis} + ${p.name}`, score: 0.85, error: errPlus })
        }

        const errMinus = Math.abs(spDelta + p.defaultValue)
        if (errMinus < MATCH_EPSILON) {
          candidates.push({ expr: `${sp.id}.${axis} - ${p.name}`, score: 0.85, error: errMinus })
        }
      }

      // ── 5c. Reference-point + two-param combos (pN.x ± A ± B) ───────────
      for (let i = 0; i < params.length; i++) {
        for (let j = 0; j < params.length; j++) {
          if (i === j) continue
          const a = params[i], b = params[j]
          if (a.defaultValue === 0 || b.defaultValue === 0) continue

          const err1 = Math.abs(spDelta - a.defaultValue + b.defaultValue)
          if (err1 < MATCH_EPSILON) {
            candidates.push({ expr: `${sp.id}.${axis} + ${a.name} - ${b.name}`, score: 0.78, error: err1 })
          }

          const err2 = Math.abs(spDelta - a.defaultValue - b.defaultValue)
          if (err2 < MATCH_EPSILON) {
            candidates.push({ expr: `${sp.id}.${axis} + ${a.name} + ${b.name}`, score: 0.78, error: err2 })
          }
        }
      }
    }

    // ── 5d. Three-param combos (p0.x + A - B + C, p0.x + A - B - C) ────────
    //   For complex shapes: e.g., p0.x + L - R1 - R2, p0.x + L/2 + R1
    for (const p of params) {
      if (p.defaultValue === 0) continue
      for (const q of params) {
        if (q === p || q.defaultValue === 0) continue
        // p0 + A/2 ± B
        const errHpP = Math.abs(delta - p.defaultValue / 2 - q.defaultValue)
        if (errHpP < MATCH_EPSILON) {
          candidates.push({ expr: `p0.${axis} + ${p.name} / 2 + ${q.name}`, score: 0.72, error: errHpP })
        }
        const errHpM = Math.abs(delta - p.defaultValue / 2 + q.defaultValue)
        if (errHpM < MATCH_EPSILON) {
          candidates.push({ expr: `p0.${axis} + ${p.name} / 2 - ${q.name}`, score: 0.72, error: errHpM })
        }
      }
    }

    // ── 6. Literal fallback (always present, lowest priority) ───────────────
    candidates.push({ expr: target.toFixed(4), score: 0.1, error: 0 })

    // ── Accuracy-weighted ranking ────────────────────────────────────────────
    // Prefer expressions that evaluate closer to the target value, even if
    // their base score is slightly lower.  This resolves ambiguity when
    // R1 ≈ L − 2·R1  (common in near-square rounded rectangles).
    for (const c of candidates) {
      c.adjustedScore = c.score > 0.1
        ? c.score * (1 - c.error / (2 * MATCH_EPSILON))
        : c.score
    }

    // Deduplicate, sort descending by adjusted score, return top 6
    const seen = new Set()
    return candidates
      .filter(c => {
        if (seen.has(c.expr)) return false
        seen.add(c.expr)
        return true
      })
      .sort((a, b) => b.adjustedScore - a.adjustedScore)
      .slice(0, 6)
      .map(c => c.expr)
  }
}