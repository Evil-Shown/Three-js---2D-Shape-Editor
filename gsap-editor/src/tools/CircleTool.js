// src/tools/CircleTool.js
// Click center, click radius → 360° arc.

import * as THREE from 'three'
import { bus } from '../core/EventBus.js'

export class CircleTool {
  constructor(deps) {
    this.scene      = deps.scene
    this.store      = deps.store
    this.coord      = deps.coord
    this.snap       = deps.snap
    this.constraint = deps.constraint
    this.history    = deps.history
    this.canvas     = deps.canvas
    this._meshMap   = deps.meshMap
    this.preview    = deps.previewLayer

    this._center = null

    this._handleClick = this._handleClick.bind(this)
    this._handleMove  = this._handleMove.bind(this)
  }

  get toolName() { return 'circle' }

  activate() {
    this._center = null
    this.canvas.style.cursor = 'crosshair'
    this.canvas.addEventListener('click', this._handleClick)
    this.canvas.addEventListener('mousemove', this._handleMove)
    bus.emit('toolStatus', 'CIRCLE: Click center')
  }

  deactivate() {
    this.canvas.style.cursor = 'default'
    this.canvas.removeEventListener('click', this._handleClick)
    this.canvas.removeEventListener('mousemove', this._handleMove)
    this._center = null
    if (this.preview) this.preview.clear()
  }

  cancel() {
    this._center = null
    if (this.preview) this.preview.clear()
    bus.emit('toolStatus', 'CIRCLE: Click center')
  }

  acceptPoint(p) { this._processPoint(this.coord.roundPoint(p)) }

  _handleClick(e) {
    if (e.detail >= 2) return
    const raw = this.coord.screenToWorld(e.clientX, e.clientY)
    const snapped = this.snap.snap(raw, { shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey })
    this._processPoint(this.coord.roundPoint(snapped))
  }

  _processPoint(p) {
    if (!this._center) {
      this._center = p
      this.snap.setDrawOrigin(p)
      this.coord.setRelativeOrigin(p)
      bus.emit('toolStatus', 'CIRCLE: Click radius point')
      return
    }

    let radius = Math.hypot(p.x - this._center.x, p.y - this._center.y)
    const cr = this.constraint.applyRadius()
    if (cr !== null) radius = cr
    if (radius < 0.01) return

    const store = this.store
    const scene = this.scene
    const meshMap = this._meshMap
    const c = { x: this._center.x, y: this._center.y }
    const r = radius

    this.history.execute({
      label: 'Draw Circle',
      _id: null,
      execute() {
        this._id = store.addEdge({
          type: 'arc', center: c, radius: r,
          startAngle: 0, endAngle: Math.PI * 2 - 0.0001,
          clockwise: false
        })
        if (this._id) {
          const curve = new THREE.EllipseCurve(c.x, c.y, r, r, 0, Math.PI * 2, false, 0)
          const pts = curve.getPoints(128)
          const geo = new THREE.BufferGeometry().setFromPoints(pts)
          const mat = new THREE.LineBasicMaterial({ color: 0xffffff })
          const line = new THREE.Line(geo, mat)
          line.userData.edgeId = this._id
          scene.add(line)
          meshMap.set(this._id, line)
        }
      },
      undo() {
        if (!this._id) return
        store.removeEdge(this._id)
        const mesh = meshMap.get(this._id)
        if (mesh) { scene.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose(); meshMap.delete(this._id) }
      }
    })

    this._center = null
    this.snap.setDrawOrigin(null)
    if (this.preview) this.preview.clear()
    bus.emit('geometryChanged')
    bus.emit('toolStatus', 'CIRCLE: Click center')
  }

  _handleMove(e) {
    if (!this._center || !this.preview) return
    const raw = this.coord.screenToWorld(e.clientX, e.clientY)
    const snapped = this.snap.snap(raw, { shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey })
    let r = Math.hypot(snapped.x - this._center.x, snapped.y - this._center.y)
    const cr = this.constraint.applyRadius()
    if (cr !== null) r = cr

    this.preview.clear()
    this.preview.showArc(this._center, r, 0, Math.PI * 2, false, 0x00ff88, 0.7)
    this.preview.showSnapIndicator(this.snap.activeSnap)
    bus.emit('toolInfo', { radius: r.toFixed(2) })
  }
}
