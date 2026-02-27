// src/core/CoordinateEngine.js
// Layer 1 — The foundation of all precision.
//
// Maintains a strict transform between three coordinate spaces:
//   Screen (browser pixels)  →  World (Three.js units)  →  Document (mm)
//
// Currently Document === World (1 Three.js unit = 1 mm).
// The engine owns the camera transform so panning / zooming go through
// a single deterministic matrix rather than raw THREE.unproject().

import { bus } from './EventBus.js'

const PRECISION = 4          // decimal places for stored coordinates
const ROUND = Math.pow(10, PRECISION)

export class CoordinateEngine {
  /**
   * @param {THREE.OrthographicCamera} camera
   * @param {HTMLCanvasElement}         canvas
   */
  constructor(camera, canvas) {
    this.camera = camera
    this.canvas = canvas

    // Pan / zoom state controlled here — single source of truth
    this._panX = 0
    this._panY = 0
    this._zoom = 1          // logical zoom multiplier
    this._baseHalfH = 500   // half-height of camera frustum at zoom 1

    // Relative / polar origin — updated each time user places a point
    this.relativeOrigin = { x: 0, y: 0 }

    // Grid density adapts to zoom
    this._gridDensities = [0.1, 0.25, 0.5, 1, 2, 5, 10, 25, 50, 100, 250, 500]

    // Snap threshold in screen pixels (constant across zoom)
    this.snapScreenPx = 12

    // Current cursor world coords (updated every mousemove)
    this.cursorWorld = { x: 0, y: 0 }

    this._onMouseMove = this._onMouseMove.bind(this)
    this._onWheel     = this._onWheel.bind(this)
    this._onPointerDown = this._onPointerDown.bind(this)
    this._onPointerMove = this._onPointerMove.bind(this)
    this._onPointerUp   = this._onPointerUp.bind(this)

    this._isPanning   = false
    this._panStartScreen = { x: 0, y: 0 }
    this._panStartWorld  = { x: 0, y: 0 }

    this._attach()
    this._applyCamera()
  }

  /* ───────── public API ───────── */

  /** Screen pixels → exact world mm (4-dp precision) */
  screenToWorld(sx, sy) {
    const rect = this.canvas.getBoundingClientRect()
    const aspect = rect.width / rect.height
    const halfH = this._baseHalfH / this._zoom
    const halfW = halfH * aspect

    const ndcX = ((sx - rect.left) / rect.width)  * 2 - 1
    const ndcY = -((sy - rect.top) / rect.height) * 2 + 1

    const wx = this._panX + ndcX * halfW
    const wy = this._panY + ndcY * halfH

    return { x: this._round(wx), y: this._round(wy) }
  }

  /** World mm → screen pixels (for snap threshold etc.) */
  worldToScreen(wx, wy) {
    const rect = this.canvas.getBoundingClientRect()
    const aspect = rect.width / rect.height
    const halfH = this._baseHalfH / this._zoom
    const halfW = halfH * aspect

    const ndcX = (wx - this._panX) / halfW
    const ndcY = (wy - this._panY) / halfH

    const sx = (ndcX + 1) / 2 * rect.width  + rect.left
    const sy = (-ndcY + 1) / 2 * rect.height + rect.top

    return { x: sx, y: sy }
  }

  /** How many world units one screen pixel represents at current zoom */
  pixelSize() {
    const rect = this.canvas.getBoundingClientRect()
    const halfH = this._baseHalfH / this._zoom
    return (halfH * 2) / rect.height
  }

  /** Snap threshold in world units at current zoom */
  snapWorldThreshold() {
    return this.snapScreenPx * this.pixelSize()
  }

  /** Round a value to 4 d.p. — eliminates floating-point noise */
  round(v) { return this._round(v) }

  /** Round a point */
  roundPoint(p) { return { x: this._round(p.x), y: this._round(p.y) } }

  /** Set the relative origin (called after every placed point) */
  setRelativeOrigin(p) {
    this.relativeOrigin = { x: this._round(p.x), y: this._round(p.y) }
  }

  /** Parse command input. Returns absolute {x,y} or null. */
  parseInput(text) {
    text = text.trim()
    if (!text) return null

    // Absolute: 100,80
    let m = text.match(/^(-?[\d.]+)\s*,\s*(-?[\d.]+)$/)
    if (m) return { x: parseFloat(m[1]), y: parseFloat(m[2]) }

    // Relative: @50,30
    m = text.match(/^@(-?[\d.]+)\s*,\s*(-?[\d.]+)$/)
    if (m) return {
      x: this._round(this.relativeOrigin.x + parseFloat(m[1])),
      y: this._round(this.relativeOrigin.y + parseFloat(m[2]))
    }

    // Polar: @100<45
    m = text.match(/^@(-?[\d.]+)\s*<\s*(-?[\d.]+)$/)
    if (m) {
      const dist = parseFloat(m[1])
      const deg  = parseFloat(m[2])
      const rad  = deg * Math.PI / 180
      return {
        x: this._round(this.relativeOrigin.x + dist * Math.cos(rad)),
        y: this._round(this.relativeOrigin.y + dist * Math.sin(rad))
      }
    }

    // Length: L150
    m = text.match(/^[Ll](-?[\d.]+)$/)
    if (m) return { constraint: 'length', value: parseFloat(m[1]) }

    // Angle: A45
    m = text.match(/^[Aa](-?[\d.]+)$/)
    if (m) return { constraint: 'angle', value: parseFloat(m[1]) }

    // Radius: R75
    m = text.match(/^[Rr](-?[\d.]+)$/)
    if (m) return { constraint: 'radius', value: parseFloat(m[1]) }

    return null
  }

  /** Current adaptive grid size (in mm) */
  gridSize() {
    // Show ~20-80 grid cells across the viewport height
    const halfH = this._baseHalfH / this._zoom
    const target = (halfH * 2) / 40
    let best = this._gridDensities[0]
    for (const g of this._gridDensities) {
      if (g <= target) best = g
      else break
    }
    return best
  }

  /** Major grid size — always 10× minor */
  majorGridSize() {
    return this.gridSize() * 10
  }

  /** Zoom level getter */
  get zoom() { return this._zoom }

  /** Camera pan center */
  get panCenter() { return { x: this._panX, y: this._panY } }

  /** Visible world bounds at current zoom/pan */
  getVisibleBounds() {
    const rect = this.canvas.getBoundingClientRect()
    const aspect = rect.width / rect.height
    const halfH = this._baseHalfH / this._zoom
    const halfW = halfH * aspect
    return {
      left:   this._panX - halfW,
      right:  this._panX + halfW,
      top:    this._panY + halfH,
      bottom: this._panY - halfH
    }
  }

  /** Programmatic zoom to fit bounds */
  zoomToFit(bounds, padding = 1.2) {
    const cx = (bounds.left + bounds.right) / 2
    const cy = (bounds.top + bounds.bottom) / 2
    const rect = this.canvas.getBoundingClientRect()
    const aspect = rect.width / rect.height

    const bw = (bounds.right - bounds.left) * padding
    const bh = (bounds.top - bounds.bottom) * padding

    const zoomH = (this._baseHalfH * 2) / bh
    const zoomW = (this._baseHalfH * 2 * aspect) / bw
    this._zoom = Math.min(zoomH, zoomW)
    if (this._zoom < 0.01) this._zoom = 0.01
    if (this._zoom > 200) this._zoom = 200

    this._panX = cx
    this._panY = cy
    this._applyCamera()
    bus.emit('viewChanged', this._viewState())
  }

  /** Zoom in/out by step */
  zoomBy(factor) {
    this._zoom *= factor
    if (this._zoom < 0.01) this._zoom = 0.01
    if (this._zoom > 200) this._zoom = 200
    this._applyCamera()
    bus.emit('viewChanged', this._viewState())
  }

  dispose() {
    this.canvas.removeEventListener('mousemove', this._onMouseMove)
    this.canvas.removeEventListener('wheel', this._onWheel)
    this.canvas.removeEventListener('pointerdown', this._onPointerDown)
    this.canvas.removeEventListener('pointermove', this._onPointerMove)
    this.canvas.removeEventListener('pointerup', this._onPointerUp)
  }

  /* ───────── private ───────── */

  _round(v) { return Math.round(v * ROUND) / ROUND }

  _attach() {
    this.canvas.addEventListener('mousemove', this._onMouseMove)
    this.canvas.addEventListener('wheel', this._onWheel, { passive: false })
    this.canvas.addEventListener('pointerdown', this._onPointerDown)
    this.canvas.addEventListener('pointermove', this._onPointerMove)
    this.canvas.addEventListener('pointerup', this._onPointerUp)
  }

  _onMouseMove(e) {
    this.cursorWorld = this.screenToWorld(e.clientX, e.clientY)
    bus.emit('cursorMove', { ...this.cursorWorld, screenX: e.clientX, screenY: e.clientY })
  }

  _onWheel(e) {
    e.preventDefault()
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12

    // Zoom towards cursor
    const before = this.screenToWorld(e.clientX, e.clientY)
    this._zoom *= factor
    if (this._zoom < 0.01) this._zoom = 0.01
    if (this._zoom > 200) this._zoom = 200
    this._applyCamera()
    const after = this.screenToWorld(e.clientX, e.clientY)
    this._panX += before.x - after.x
    this._panY += before.y - after.y
    this._applyCamera()
    bus.emit('viewChanged', this._viewState())
  }

  _onPointerDown(e) {
    // Middle-button pan (button 1) or right-button pan (button 2)
    if (e.button === 1 || e.button === 2) {
      this._isPanning = true
      this._panStartScreen = { x: e.clientX, y: e.clientY }
      this._panStartWorld  = { x: this._panX, y: this._panY }
      this.canvas.setPointerCapture(e.pointerId)
      e.preventDefault()
    }
  }

  _onPointerMove(e) {
    if (!this._isPanning) return
    const dx = e.clientX - this._panStartScreen.x
    const dy = e.clientY - this._panStartScreen.y
    const ps = this.pixelSize()
    this._panX = this._panStartWorld.x - dx * ps
    this._panY = this._panStartWorld.y + dy * ps
    this._applyCamera()
    bus.emit('viewChanged', this._viewState())
  }

  _onPointerUp(e) {
    if (e.button === 1 || e.button === 2) {
      this._isPanning = false
      this.canvas.releasePointerCapture(e.pointerId)
    }
  }

  _applyCamera() {
    const rect = this.canvas.getBoundingClientRect()
    const aspect = rect.width / rect.height || 1
    const halfH = this._baseHalfH / this._zoom
    const halfW = halfH * aspect

    this.camera.left   = this._panX - halfW
    this.camera.right  = this._panX + halfW
    this.camera.top    = this._panY + halfH
    this.camera.bottom = this._panY - halfH
    this.camera.updateProjectionMatrix()
  }

  _viewState() {
    return {
      zoom: this._zoom,
      panX: this._panX,
      panY: this._panY,
      gridSize: this.gridSize(),
      majorGridSize: this.majorGridSize(),
      pixelSize: this.pixelSize()
    }
  }
}
