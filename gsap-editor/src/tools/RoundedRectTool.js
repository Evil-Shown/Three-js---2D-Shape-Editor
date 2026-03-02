// src/tools/RoundedRectTool.js
// 3-phase rounded rectangle: corner1 → corner2 → fillet radius.
// Phase 1: Click first corner
// Phase 2: Click opposite corner (preview shows sharp rect)
// Phase 3: Move mouse to set corner radius, click to confirm
//          Scroll wheel also adjusts radius. Press 0 for sharp corners.
// Generates 4 lines + 4 arcs (or just 4 lines if radius = 0).

import * as THREE from 'three'
import { bus } from '../core/EventBus.js'

export class RoundedRectTool {
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

    this._corner1 = null
    this._corner2 = null
    this._radius  = 0
    this._phase   = 0  // 0=waiting, 1=have corner1, 2=have corner2 (adjusting radius)
    this._maxRadius = 0

    this._handleClick = this._handleClick.bind(this)
    this._handleMove  = this._handleMove.bind(this)
    this._handleWheel = this._handleWheel.bind(this)
    this._handleKey   = this._handleKey.bind(this)
  }

  get toolName() { return 'roundedRect' }

  activate() {
    this._reset()
    this.canvas.style.cursor = 'crosshair'
    this.canvas.addEventListener('click', this._handleClick)
    this.canvas.addEventListener('mousemove', this._handleMove)
    this.canvas.addEventListener('wheel', this._handleWheel, { passive: false })
    window.addEventListener('keydown', this._handleKey)
    bus.emit('toolStatus', 'ROUNDED RECT: Click first corner')
  }

  deactivate() {
    this.canvas.style.cursor = 'default'
    this.canvas.removeEventListener('click', this._handleClick)
    this.canvas.removeEventListener('mousemove', this._handleMove)
    this.canvas.removeEventListener('wheel', this._handleWheel)
    window.removeEventListener('keydown', this._handleKey)
    this._reset()
  }

  cancel() {
    this._reset()
    bus.emit('toolStatus', 'ROUNDED RECT: Click first corner')
  }

  acceptPoint(p) {
    this._processPoint(this.coord.roundPoint(p))
  }

  /* ── Event handlers ── */

  _handleClick(e) {
    if (e.detail >= 2) return
    const raw = this.coord.screenToWorld(e.clientX, e.clientY)
    const snapped = this.snap.snap(raw, { shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey })
    this._processPoint(this.coord.roundPoint(snapped))
  }

  _processPoint(p) {
    if (this._phase === 0) {
      // Phase 1: Set first corner
      this._corner1 = p
      this._phase = 1
      this.snap.setDrawOrigin(p)
      this.coord.setRelativeOrigin(p)
      bus.emit('toolStatus', 'ROUNDED RECT: Click opposite corner')
      return
    }

    if (this._phase === 1) {
      // Phase 2: Set second corner, enter radius adjustment
      const c1 = this._corner1
      if (Math.abs(p.x - c1.x) < 0.01 || Math.abs(p.y - c1.y) < 0.01) return
      this._corner2 = p
      this._phase = 2
      const w = Math.abs(p.x - c1.x)
      const h = Math.abs(p.y - c1.y)
      this._maxRadius = Math.min(w, h) / 2
      this._radius = 0
      bus.emit('toolStatus', `ROUNDED RECT: Move mouse or scroll to set radius (0 – ${this._maxRadius.toFixed(1)}), click to confirm. Press 0 for sharp.`)
      return
    }

    if (this._phase === 2) {
      // Phase 3: Confirm — commit the rounded rectangle
      this._commit()
      return
    }
  }

  _handleMove(e) {
    if (!this.preview) return
    const raw = this.coord.screenToWorld(e.clientX, e.clientY)
    const snapped = this.snap.snap(raw, { shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey })

    this.preview.clear()

    if (this._phase === 1 && this._corner1) {
      // Preview sharp rectangle while choosing corner2
      const c1 = this._corner1, c2 = snapped
      this._previewRoundedRect(c1, c2, 0)
      this.preview.showSnapIndicator(this.snap.activeSnap)
      const w = Math.abs(c2.x - c1.x), h = Math.abs(c2.y - c1.y)
      bus.emit('toolInfo', { width: w.toFixed(2), height: h.toFixed(2), radius: '0.00' })
    }

    if (this._phase === 2 && this._corner1 && this._corner2) {
      // Radius from mouse distance to nearest rect edge
      const r = this._radiusFromMouse(snapped)
      this._radius = r
      this._previewRoundedRect(this._corner1, this._corner2, r)
      const w = Math.abs(this._corner2.x - this._corner1.x)
      const h = Math.abs(this._corner2.y - this._corner1.y)
      bus.emit('toolInfo', { width: w.toFixed(2), height: h.toFixed(2), radius: r.toFixed(2) })
      bus.emit('toolStatus', `ROUNDED RECT: Radius = ${r.toFixed(2)} (max ${this._maxRadius.toFixed(1)}). Click to confirm, 0 for sharp.`)
    }
  }

  _handleWheel(e) {
    if (this._phase !== 2) return
    e.preventDefault()
    e.stopPropagation()
    const delta = e.deltaY > 0 ? -0.5 : 0.5
    // Scale step by zoom
    const step = Math.max(0.1, this._maxRadius * 0.05)
    this._radius = Math.max(0, Math.min(this._maxRadius, this._radius + delta * step))
    this.preview.clear()
    this._previewRoundedRect(this._corner1, this._corner2, this._radius)
    const w = Math.abs(this._corner2.x - this._corner1.x)
    const h = Math.abs(this._corner2.y - this._corner1.y)
    bus.emit('toolInfo', { width: w.toFixed(2), height: h.toFixed(2), radius: this._radius.toFixed(2) })
    bus.emit('toolStatus', `ROUNDED RECT: Radius = ${this._radius.toFixed(2)} (scroll to adjust). Click to confirm.`)
  }

  _handleKey(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
    if (this._phase === 2 && e.key === '0') {
      e.preventDefault()
      this._radius = 0
      this.preview.clear()
      this._previewRoundedRect(this._corner1, this._corner2, 0)
      bus.emit('toolStatus', 'ROUNDED RECT: Radius = 0 (sharp corners). Click to confirm.')
    }
  }

  /* ── Radius from mouse position ── */

  _radiusFromMouse(mouse) {
    if (!this._corner1 || !this._corner2) return 0
    const c1 = this._corner1, c2 = this._corner2
    const cx = (c1.x + c2.x) / 2
    const cy = (c1.y + c2.y) / 2
    const hw = Math.abs(c2.x - c1.x) / 2
    const hh = Math.abs(c2.y - c1.y) / 2

    // Distance from mouse to center, mapped to radius
    // Closer to center = larger radius, at edges = smaller radius
    const dx = Math.abs(mouse.x - cx)
    const dy = Math.abs(mouse.y - cy)

    // Use the inward distance from the rect edge to set radius
    const insetX = Math.max(0, hw - dx)
    const insetY = Math.max(0, hh - dy)
    const inset = Math.min(insetX, insetY)

    return Math.max(0, Math.min(this._maxRadius, inset))
  }

  /* ── Preview ── */

  _previewRoundedRect(c1, c2, radius) {
    const segments = this._buildSegments(c1, c2, radius)
    for (const seg of segments) {
      if (seg.type === 'line') {
        this.preview.showLine(seg.start, seg.end, 0x00ff88, 0.7)
      } else if (seg.type === 'arc') {
        this.preview.showArc(seg.center, seg.radius, seg.startAngle, seg.endAngle, seg.clockwise, 0x00ff88, 0.7)
      }
    }

    // Show radius indicator if > 0
    if (radius > 0) {
      // Draw a small line from one corner to show the fillet
      const minX = Math.min(c1.x, c2.x)
      const minY = Math.min(c1.y, c2.y)
      const rCenter = { x: minX + radius, y: minY + radius }
      this.preview.showLine(rCenter, { x: minX, y: minY + radius }, 0xffaa00, 0.5)
    }
  }

  /* ── Build geometry segments ── */

  _buildSegments(c1, c2, radius) {
    const minX = Math.min(c1.x, c2.x)
    const maxX = Math.max(c1.x, c2.x)
    const minY = Math.min(c1.y, c2.y)
    const maxY = Math.max(c1.y, c2.y)
    const r = Math.min(radius, this._maxRadius)

    if (r < 0.01) {
      // Sharp corners — 4 lines
      const bl = { x: minX, y: minY }
      const br = { x: maxX, y: minY }
      const tr = { x: maxX, y: maxY }
      const tl = { x: minX, y: maxY }
      return [
        { type: 'line', start: bl, end: br },
        { type: 'line', start: br, end: tr },
        { type: 'line', start: tr, end: tl },
        { type: 'line', start: tl, end: bl },
      ]
    }

    // Rounded corners — 4 lines + 4 arcs
    // Corner centers
    const cBL = { x: minX + r, y: minY + r }
    const cBR = { x: maxX - r, y: minY + r }
    const cTR = { x: maxX - r, y: maxY - r }
    const cTL = { x: minX + r, y: maxY - r }

    const PI = Math.PI
    const HALF = PI / 2

    return [
      // Bottom line (BL-fillet-end → BR-fillet-start)
      { type: 'line', start: { x: minX + r, y: minY }, end: { x: maxX - r, y: minY } },
      // Bottom-right arc
      { type: 'arc', center: cBR, radius: r, startAngle: -HALF, endAngle: 0, clockwise: false },
      // Right line
      { type: 'line', start: { x: maxX, y: minY + r }, end: { x: maxX, y: maxY - r } },
      // Top-right arc
      { type: 'arc', center: cTR, radius: r, startAngle: 0, endAngle: HALF, clockwise: false },
      // Top line
      { type: 'line', start: { x: maxX - r, y: maxY }, end: { x: minX + r, y: maxY } },
      // Top-left arc
      { type: 'arc', center: cTL, radius: r, startAngle: HALF, endAngle: PI, clockwise: false },
      // Left line
      { type: 'line', start: { x: minX, y: maxY - r }, end: { x: minX, y: minY + r } },
      // Bottom-left arc
      { type: 'arc', center: cBL, radius: r, startAngle: PI, endAngle: PI + HALF, clockwise: false },
    ]
  }

  /* ── Commit to store ── */

  _commit() {
    const segments = this._buildSegments(this._corner1, this._corner2, this._radius)
    const store = this.store
    const scene = this.scene
    const meshMap = this._meshMap
    const ids = []

    this.history.execute({
      label: `Draw Rounded Rect (r=${this._radius.toFixed(2)})`,
      execute() {
        ids.length = 0
        for (const seg of segments) {
          let id
          if (seg.type === 'line') {
            id = store.addEdge({ type: 'line', start: { ...seg.start }, end: { ...seg.end } })
            if (id) {
              const geo = new THREE.BufferGeometry().setFromPoints([
                new THREE.Vector3(seg.start.x, seg.start.y, 0),
                new THREE.Vector3(seg.end.x, seg.end.y, 0)
              ])
              const mat = new THREE.LineBasicMaterial({ color: 0xffffff })
              const line = new THREE.Line(geo, mat)
              line.userData.edgeId = id
              scene.add(line)
              meshMap.set(id, line)
              ids.push(id)
            }
          } else if (seg.type === 'arc') {
            id = store.addEdge({
              type: 'arc', center: { ...seg.center }, radius: seg.radius,
              startAngle: seg.startAngle, endAngle: seg.endAngle, clockwise: seg.clockwise
            })
            if (id) {
              const curve = new THREE.EllipseCurve(
                seg.center.x, seg.center.y, seg.radius, seg.radius,
                seg.startAngle, seg.endAngle, seg.clockwise, 0
              )
              const pts = curve.getPoints(32)
              const geo = new THREE.BufferGeometry().setFromPoints(pts)
              const mat = new THREE.LineBasicMaterial({ color: 0xffffff })
              const line = new THREE.Line(geo, mat)
              line.userData.edgeId = id
              scene.add(line)
              meshMap.set(id, line)
              ids.push(id)
            }
          }
        }
      },
      undo() {
        for (const id of ids) {
          store.removeEdge(id)
          const mesh = meshMap.get(id)
          if (mesh) {
            scene.remove(mesh)
            mesh.geometry.dispose()
            mesh.material.dispose()
            meshMap.delete(id)
          }
        }
      }
    })

    this._reset()
    bus.emit('geometryChanged')
    bus.emit('toolStatus', 'ROUNDED RECT: Click first corner')
  }

  /* ── Reset ── */

  _reset() {
    this._corner1 = null
    this._corner2 = null
    this._radius = 0
    this._phase = 0
    this._maxRadius = 0
    this.snap.setDrawOrigin(null)
    if (this.preview) this.preview.clear()
  }
}
