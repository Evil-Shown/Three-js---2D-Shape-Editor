// src/tools/ArcTool.js — v2
// 3-click (center-radius-angle) + 3-point arc mode.
// Full snap v2, constraint, and undo/redo integration.

import * as THREE from 'three'
import { bus } from '../core/EventBus.js'

export class ArcTool {
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

    this._mode  = 'cra'  // 'cra' = center-radius-angle, '3pt' = three-point
    this._phase = null
    this._center = null
    this._radius = null
    this._startAngle = null
    this._pts = []  // for 3-point mode

    this._handleClick = this._handleClick.bind(this)
    this._handleMove  = this._handleMove.bind(this)
  }

  get toolName() { return 'arc' }

  activate() {
    this._reset()
    this.canvas.style.cursor = 'crosshair'
    this.canvas.addEventListener('click', this._handleClick)
    this.canvas.addEventListener('mousemove', this._handleMove)
    bus.emit('toolStatus', this._statusMsg())
  }

  deactivate() {
    this.canvas.style.cursor = 'default'
    this.canvas.removeEventListener('click', this._handleClick)
    this.canvas.removeEventListener('mousemove', this._handleMove)
    this._reset()
  }

  cancel() { this._reset(); bus.emit('toolStatus', this._statusMsg()) }

  /** Toggle between CRA and 3-point mode */
  toggleMode() {
    this._mode = this._mode === 'cra' ? '3pt' : 'cra'
    this._reset()
    bus.emit('toolStatus', this._statusMsg())
  }

  acceptPoint(p) { this._processPoint(this.coord.roundPoint(p)) }

  /* ── private ── */

  _handleClick(e) {
    if (e.detail >= 2) return
    const raw = this.coord.screenToWorld(e.clientX, e.clientY)
    const mods = { shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey }
    const snapped = this.snap.snap(raw, mods)
    this._processPoint(this.coord.roundPoint(snapped))
  }

  _processPoint(p) {
    if (this._mode === 'cra') this._craPick(p)
    else this._threePtPick(p)
  }

  /* ── CRA mode ── */

  _craPick(p) {
    if (!this._phase) {
      this._center = p
      this._phase = 'center'
      this.snap.setDrawOrigin(p)
      this.coord.setRelativeOrigin(p)
      bus.emit('toolStatus', 'ARC: Click radius point')
      return
    }

    if (this._phase === 'center') {
      let radius = Math.hypot(p.x - this._center.x, p.y - this._center.y)
      const cr = this.constraint.applyRadius()
      if (cr !== null) radius = cr
      if (radius < 0.01) return

      this._radius = radius
      this._startAngle = Math.atan2(p.y - this._center.y, p.x - this._center.x)
      this._phase = 'radius'
      bus.emit('toolStatus', 'ARC: Click end angle')
      return
    }

    if (this._phase === 'radius') {
      const endAngle = Math.atan2(p.y - this._center.y, p.x - this._center.x)
      if (Math.abs(endAngle - this._startAngle) < 0.001) return
      const clockwise = this._isCW(this._startAngle, endAngle)
      this._commitArc(this._center, this._radius, this._startAngle, endAngle, clockwise)
      this._reset()
      bus.emit('toolStatus', this._statusMsg())
    }
  }

  /* ── 3-point mode ── */

  _threePtPick(p) {
    this._pts.push(p)

    if (this._pts.length === 1) {
      this.snap.setDrawOrigin(p)
      this.coord.setRelativeOrigin(p)
      bus.emit('toolStatus', 'ARC 3PT: Click second point')
      return
    }
    if (this._pts.length === 2) {
      bus.emit('toolStatus', 'ARC 3PT: Click third point')
      return
    }
    if (this._pts.length === 3) {
      const arc = this._arcFrom3Pts(this._pts[0], this._pts[1], this._pts[2])
      if (arc) {
        this._commitArc(arc.center, arc.radius, arc.startAngle, arc.endAngle, arc.clockwise)
      }
      this._reset()
      bus.emit('toolStatus', this._statusMsg())
    }
  }

  _arcFrom3Pts(p1, p2, p3) {
    // Perpendicular bisector intersection
    const ax = (p1.x + p2.x) / 2, ay = (p1.y + p2.y) / 2
    const bx = (p2.x + p3.x) / 2, by = (p2.y + p3.y) / 2
    const d1x = -(p2.y - p1.y), d1y = p2.x - p1.x
    const d2x = -(p3.y - p2.y), d2y = p3.x - p2.x

    const det = d1x * d2y - d1y * d2x
    if (Math.abs(det) < 1e-8) return null  // collinear

    const t = ((bx - ax) * d2y - (by - ay) * d2x) / det
    const cx = ax + t * d1x
    const cy = ay + t * d1y
    const radius = Math.hypot(p1.x - cx, p1.y - cy)

    const a1 = Math.atan2(p1.y - cy, p1.x - cx)
    const a3 = Math.atan2(p3.y - cy, p3.x - cx)

    // Determine direction using cross product of (p1→p2) × (p1→p3)
    const cross = (p2.x - p1.x) * (p3.y - p1.y) - (p2.y - p1.y) * (p3.x - p1.x)
    const clockwise = cross < 0

    return { center: { x: cx, y: cy }, radius, startAngle: a1, endAngle: a3, clockwise }
  }

  /* ── Commit arc to store with undo support ── */

  _commitArc(center, radius, startAngle, endAngle, clockwise) {
    const store = this.store
    const scene = this.scene
    const meshMap = this._meshMap
    const c = { x: center.x, y: center.y }

    this.history.execute({
      label: 'Draw Arc',
      _id: null,
      execute() {
        this._id = store.addEdge({ type: 'arc', center: c, radius, startAngle, endAngle, clockwise })
        if (this._id) {
          const curve = new THREE.EllipseCurve(c.x, c.y, radius, radius, startAngle, endAngle, clockwise, 0)
          const pts = curve.getPoints(64)
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

    this.coord.setRelativeOrigin(center)
    bus.emit('geometryChanged')
  }

  /* ── Preview on hover ── */

  _handleMove(e) {
    const raw = this.coord.screenToWorld(e.clientX, e.clientY)
    const snapped = this.snap.snap(raw, { shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey })
    if (!this.preview) return

    this.preview.clear()

    if (this._mode === 'cra') {
      if (this._phase === 'center') {
        const r = Math.hypot(snapped.x - this._center.x, snapped.y - this._center.y)
        const a = Math.atan2(snapped.y - this._center.y, snapped.x - this._center.x)
        this.preview.showArc(this._center, r, a, a, false, 0x00ff88, 0.6)
        this.preview.showLine(this._center, snapped, 0x00ff88, 0.3)
      }
      if (this._phase === 'radius') {
        const ea = Math.atan2(snapped.y - this._center.y, snapped.x - this._center.x)
        this.preview.showArc(this._center, this._radius, this._startAngle, ea, false, 0x00ff88, 0.7)
      }
    } else {
      // 3-point preview
      if (this._pts.length === 1) {
        this.preview.showLine(this._pts[0], snapped, 0x00ff88, 0.5)
      }
      if (this._pts.length === 2) {
        const arc = this._arcFrom3Pts(this._pts[0], this._pts[1], snapped)
        if (arc) {
          this.preview.showArc(arc.center, arc.radius, arc.startAngle, arc.endAngle, arc.clockwise, 0x00ff88, 0.7)
        }
      }
    }

    this.preview.showSnapIndicator(this.snap.activeSnap)
  }

  /* ── Helpers ── */

  _reset() {
    this._phase = null; this._center = null; this._radius = null
    this._startAngle = null; this._pts = []
    this.snap.setDrawOrigin(null)
    if (this.preview) this.preview.clear()
  }

  _isCW(start, end) {
    let sweep = end - start
    if (sweep > Math.PI)  sweep -= 2 * Math.PI
    if (sweep < -Math.PI) sweep += 2 * Math.PI
    return sweep < 0
  }

  _statusMsg() {
    return this._mode === 'cra'
      ? 'ARC (CRA): Click center'
      : 'ARC (3PT): Click first point'
  }
}
