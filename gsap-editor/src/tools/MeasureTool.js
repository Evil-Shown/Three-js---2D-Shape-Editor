// src/tools/MeasureTool.js
// Click two points → shows distance and angle. Read-only, no geometry.

import { bus } from '../core/EventBus.js'

export class MeasureTool {
  constructor(deps) {
    this.coord   = deps.coord
    this.snap    = deps.snap
    this.canvas  = deps.canvas
    this.preview = deps.previewLayer

    this._p1 = null

    this._handleClick = this._handleClick.bind(this)
    this._handleMove  = this._handleMove.bind(this)
  }

  get toolName() { return 'measure' }

  activate() {
    this._p1 = null
    this.canvas.style.cursor = 'crosshair'
    this.canvas.addEventListener('click', this._handleClick)
    this.canvas.addEventListener('mousemove', this._handleMove)
    bus.emit('toolStatus', 'MEASURE: Click first point')
  }

  deactivate() {
    this.canvas.style.cursor = 'default'
    this.canvas.removeEventListener('click', this._handleClick)
    this.canvas.removeEventListener('mousemove', this._handleMove)
    this._p1 = null
    if (this.preview) this.preview.clear()
  }

  cancel() {
    this._p1 = null
    if (this.preview) this.preview.clear()
    bus.emit('toolStatus', 'MEASURE: Click first point')
    bus.emit('measureResult', null)
  }

  _handleClick(e) {
    const raw = this.coord.screenToWorld(e.clientX, e.clientY)
    const snapped = this.snap.snap(raw, { shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey })
    const p = this.coord.roundPoint(snapped)

    if (!this._p1) {
      this._p1 = p
      this.snap.setDrawOrigin(p)
      this.coord.setRelativeOrigin(p)
      bus.emit('toolStatus', 'MEASURE: Click second point')
      return
    }

    const dist  = Math.hypot(p.x - this._p1.x, p.y - this._p1.y)
    const angle = Math.atan2(p.y - this._p1.y, p.x - this._p1.x) * 180 / Math.PI
    const dx = Math.abs(p.x - this._p1.x)
    const dy = Math.abs(p.y - this._p1.y)

    bus.emit('measureResult', {
      from: this._p1,
      to: p,
      distance: dist.toFixed(4),
      angle: angle.toFixed(2),
      dx: dx.toFixed(4),
      dy: dy.toFixed(4)
    })

    // Reset for next measurement
    this._p1 = null
    this.snap.setDrawOrigin(null)
    if (this.preview) this.preview.clear()
    bus.emit('toolStatus', 'MEASURE: Click first point')
  }

  _handleMove(e) {
    if (!this._p1 || !this.preview) return
    const raw = this.coord.screenToWorld(e.clientX, e.clientY)
    const snapped = this.snap.snap(raw, { shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey })

    this.preview.clear()
    this.preview.showLine(this._p1, snapped, 0xffff00, 0.8)
    this.preview.showSnapIndicator(this.snap.activeSnap)

    const dist = Math.hypot(snapped.x - this._p1.x, snapped.y - this._p1.y)
    const angle = Math.atan2(snapped.y - this._p1.y, snapped.x - this._p1.x) * 180 / Math.PI
    bus.emit('toolInfo', { distance: dist.toFixed(2), angle: angle.toFixed(1) })
  }
}
