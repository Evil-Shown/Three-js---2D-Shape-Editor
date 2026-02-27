// src/tools/DimensionTool.js
// Click two points + position → creates a visual dimension annotation.
// Annotations stored separately from geometry.

import { bus } from '../core/EventBus.js'

export class DimensionTool {
  constructor(deps) {
    this.coord          = deps.coord
    this.snap           = deps.snap
    this.canvas         = deps.canvas
    this.preview        = deps.previewLayer
    this.annotationLayer = deps.annotationLayer

    this._p1 = null
    this._p2 = null

    this._handleClick = this._handleClick.bind(this)
    this._handleMove  = this._handleMove.bind(this)
  }

  get toolName() { return 'dimension' }

  activate() {
    this._p1 = null
    this._p2 = null
    this.canvas.style.cursor = 'crosshair'
    this.canvas.addEventListener('click', this._handleClick)
    this.canvas.addEventListener('mousemove', this._handleMove)
    bus.emit('toolStatus', 'DIM: Click first point')
  }

  deactivate() {
    this.canvas.style.cursor = 'default'
    this.canvas.removeEventListener('click', this._handleClick)
    this.canvas.removeEventListener('mousemove', this._handleMove)
    this._p1 = null
    this._p2 = null
    if (this.preview) this.preview.clear()
  }

  cancel() {
    this._p1 = null
    this._p2 = null
    if (this.preview) this.preview.clear()
    bus.emit('toolStatus', 'DIM: Click first point')
  }

  _handleClick(e) {
    const raw = this.coord.screenToWorld(e.clientX, e.clientY)
    const snapped = this.snap.snap(raw, { shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey })
    const p = this.coord.roundPoint(snapped)

    if (!this._p1) {
      this._p1 = p
      bus.emit('toolStatus', 'DIM: Click second point')
      return
    }

    if (!this._p2) {
      this._p2 = p
      bus.emit('toolStatus', 'DIM: Click label position')
      return
    }

    // Third click = label position
    const dist = Math.hypot(this._p2.x - this._p1.x, this._p2.y - this._p1.y)
    if (this.annotationLayer) {
      this.annotationLayer.addDimension(this._p1, this._p2, p, dist)
    }

    this._p1 = null
    this._p2 = null
    if (this.preview) this.preview.clear()
    bus.emit('toolStatus', 'DIM: Click first point')
  }

  _handleMove(e) {
    if (!this.preview) return
    const raw = this.coord.screenToWorld(e.clientX, e.clientY)
    const snapped = this.snap.snap(raw, { shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey })

    this.preview.clear()
    if (this._p1 && !this._p2) {
      this.preview.showLine(this._p1, snapped, 0xff8844, 0.7)
    }
    if (this._p1 && this._p2) {
      this.preview.showLine(this._p1, this._p2, 0xff8844, 0.7)
    }
    this.preview.showSnapIndicator(this.snap.activeSnap)
  }
}
