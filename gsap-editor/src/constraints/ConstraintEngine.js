// src/constraints/ConstraintEngine.js
// Layer 3 — Constraints: rules that geometry must obey.
// Takes priority over snap when active.

import { bus } from '../core/EventBus.js'

export class ConstraintEngine {
  constructor(coordEngine) {
    this.coord = coordEngine

    // Active constraints — cleared when tool finishes or user presses Escape
    this._lockH      = false   // horizontal lock
    this._lockV      = false   // vertical lock
    this._fixedLen   = null    // fixed length in mm
    this._fixedAngle = null    // fixed angle in degrees
    this._fixedRadius = null   // fixed radius in mm
    this._parallelEdge = null  // edge to be parallel to

    this._setupKeys()
  }

  /* ── Public API ── */

  /** Returns true if any constraint is active */
  get active() {
    return this._lockH || this._lockV || this._fixedLen !== null ||
           this._fixedAngle !== null || this._fixedRadius !== null ||
           this._parallelEdge !== null
  }

  /** Apply constraints to a candidate point given origin (start of segment).
   *  Returns adjusted { x, y } + metadata.
   */
  apply(origin, candidate) {
    if (!origin) return candidate

    let x = candidate.x
    let y = candidate.y

    // --- Horizontal lock ---
    if (this._lockH) {
      y = origin.y
    }

    // --- Vertical lock ---
    if (this._lockV) {
      x = origin.x
    }

    // --- Fixed angle ---
    if (this._fixedAngle !== null) {
      const rad = this._fixedAngle * Math.PI / 180
      const dist = this._fixedLen !== null
        ? this._fixedLen
        : Math.hypot(x - origin.x, y - origin.y)
      x = origin.x + dist * Math.cos(rad)
      y = origin.y + dist * Math.sin(rad)
    }

    // --- Parallel to existing edge ---
    if (this._parallelEdge && !this._lockH && !this._lockV && this._fixedAngle === null) {
      const e = this._parallelEdge
      const edx = e.end.x - e.start.x
      const edy = e.end.y - e.start.y
      const elen = Math.hypot(edx, edy)
      if (elen > 1e-8) {
        const ux = edx / elen, uy = edy / elen
        const dx = x - origin.x, dy = y - origin.y
        const proj = dx * ux + dy * uy
        x = origin.x + proj * ux
        y = origin.y + proj * uy
      }
    }

    // --- Fixed length (applied last so it overrides distance) ---
    if (this._fixedLen !== null && this._fixedAngle === null) {
      const dx = x - origin.x
      const dy = y - origin.y
      const dist = Math.hypot(dx, dy)
      if (dist > 1e-8) {
        const scale = this._fixedLen / dist
        x = origin.x + dx * scale
        y = origin.y + dy * scale
      }
    }

    return {
      x: this.coord.round(x),
      y: this.coord.round(y),
      constrained: this.active
    }
  }

  /** Apply radius constraint — returns radius value or null */
  applyRadius() {
    return this._fixedRadius
  }

  /** Set a constraint from command input parsed result */
  setFromInput(parsed) {
    if (!parsed || !parsed.constraint) return false
    switch (parsed.constraint) {
      case 'length': this._fixedLen   = parsed.value; break
      case 'angle':  this._fixedAngle = parsed.value; break
      case 'radius': this._fixedRadius = parsed.value; break
      default: return false
    }
    this._notify()
    return true
  }

  setHorizontalLock(on) { this._lockH = on; this._notify() }
  setVerticalLock(on)   { this._lockV = on; this._notify() }
  setFixedLength(v)     { this._fixedLen = v; this._notify() }
  setFixedAngle(v)      { this._fixedAngle = v; this._notify() }
  setFixedRadius(v)     { this._fixedRadius = v; this._notify() }
  setParallelEdge(e)    { this._parallelEdge = e; this._notify() }

  /** Clear all active constraints */
  clearAll() {
    this._lockH = false
    this._lockV = false
    this._fixedLen = null
    this._fixedAngle = null
    this._fixedRadius = null
    this._parallelEdge = null
    this._notify()
  }

  /** Get human-readable status */
  status() {
    const parts = []
    if (this._lockH) parts.push('H-Lock')
    if (this._lockV) parts.push('V-Lock')
    if (this._fixedLen !== null)   parts.push(`L=${this._fixedLen}`)
    if (this._fixedAngle !== null) parts.push(`A=${this._fixedAngle}°`)
    if (this._fixedRadius !== null) parts.push(`R=${this._fixedRadius}`)
    if (this._parallelEdge) parts.push('Parallel')
    return parts.join('  ')
  }

  dispose() {
    if (this._keyDownHandler) {
      window.removeEventListener('keydown', this._keyDownHandler)
    }
  }

  /* ── Private ── */

  _setupKeys() {
    this._keyDownHandler = (e) => {
      // Only process when not typing in an input
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return

      if (e.key === 'h' || e.key === 'H') {
        this._lockH = !this._lockH
        if (this._lockH) this._lockV = false
        this._notify()
      }
      if (e.key === 'v' || e.key === 'V') {
        this._lockV = !this._lockV
        if (this._lockV) this._lockH = false
        this._notify()
      }
    }
    window.addEventListener('keydown', this._keyDownHandler)
  }

  _notify() {
    bus.emit('constraintChanged', {
      active: this.active,
      lockH: this._lockH,
      lockV: this._lockV,
      fixedLen: this._fixedLen,
      fixedAngle: this._fixedAngle,
      fixedRadius: this._fixedRadius,
      parallel: !!this._parallelEdge,
      status: this.status()
    })
  }
}
