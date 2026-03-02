// src/tools/LineTool.js — v2
// Upgraded: continuous multi-segment drawing, snap v2, constraints,
// undo/redo integration, preview via PreviewLayer.

import * as THREE from 'three'
import { bus } from '../core/EventBus.js'

export class LineTool {
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

    this._points    = []      // placed points for multi-segment
    this._active    = false
    this._lastMouse = null

    this._handleClick = this._handleClick.bind(this)
    this._handleMove  = this._handleMove.bind(this)
    this._handleDbl   = this._handleDblClick.bind(this)
  }

  get toolName() { return 'line' }

  activate() {
    this._active = true
    this._points = []
    this.canvas.style.cursor = 'crosshair'
    this.canvas.addEventListener('click', this._handleClick)
    this.canvas.addEventListener('mousemove', this._handleMove)
    this.canvas.addEventListener('dblclick', this._handleDbl)
    bus.emit('toolStatus', 'LINE: Click start point')
  }

  deactivate() {
    this._active = false
    this._points = []
    this.snap.setDrawOrigin(null)
    this.snap.setPathFirstPoint(null)
    this.canvas.style.cursor = 'default'
    this.canvas.removeEventListener('click', this._handleClick)
    this.canvas.removeEventListener('mousemove', this._handleMove)
    this.canvas.removeEventListener('dblclick', this._handleDbl)
    if (this.preview) this.preview.clear()
  }

  cancel() {
    this._points = []
    this.snap.setDrawOrigin(null)
    this.snap.setPathFirstPoint(null)
    this.constraint.clearAll()
    if (this.preview) this.preview.clear()
    bus.emit('toolStatus', 'LINE: Click start point')
  }

  /** Accept a point from command input */
  acceptPoint(p) {
    this._placePoint(p)
  }

  /* ── private ── */

  _handleClick(e) {
    if (e.detail >= 2) return  // ignore double-click first-click
    const raw = this.coord.screenToWorld(e.clientX, e.clientY)
    const mods = { shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey }
    let snapped = this.snap.snap(raw, mods)

    // Apply constraints
    if (this._points.length > 0) {
      const origin = this._points[this._points.length - 1]
      snapped = this.constraint.apply(origin, snapped)
    }

    this._placePoint(snapped)
  }

  _placePoint(point) {
    const p = this.coord.roundPoint(point)

    if (this._points.length === 0) {
      this._points.push(p)
      this.snap.setDrawOrigin(p)
      this.snap.setPathFirstPoint(p)  // for close-path snapping
      this.coord.setRelativeOrigin(p)
      bus.emit('toolStatus', 'LINE: Click next point (Dbl-click or Esc to finish)')
      return
    }

    const prev = this._points[this._points.length - 1]
    const len = Math.hypot(p.x - prev.x, p.y - prev.y)
    if (len < 0.01) return

    // Check if this closes the path (snapped to first point)
    const first = this._points[0]
    const distToFirst = Math.hypot(p.x - first.x, p.y - first.y)
    const isClosing = this._points.length >= 2 && distToFirst < (this.coord.snapWorldThreshold() * 1.5)

    // Force exact first-point coords when closing
    const end = isClosing ? { x: first.x, y: first.y } : { x: p.x, y: p.y }

    // Create edge via undo-able command
    const store = this.store
    const scene = this.scene
    const meshMap = this._meshMap
    const start = { x: prev.x, y: prev.y }

    this.history.execute({
      label: isClosing ? 'Close Path' : 'Draw Line',
      _id: null,
      execute() {
        this._id = store.addEdge({ type: 'line', start, end })
        if (this._id) {
          const geo = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(start.x, start.y, 0),
            new THREE.Vector3(end.x, end.y, 0)
          ])
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
        if (mesh) {
          scene.remove(mesh)
          mesh.geometry.dispose()
          mesh.material.dispose()
          meshMap.delete(this._id)
        }
      }
    })

    // Continue or finish multi-segment
    if (isClosing) {
      // Path closed — finish drawing
      this._points = []
      this.snap.setDrawOrigin(null)
      this.snap.setPathFirstPoint(null)
      this.constraint.clearAll()
      if (this.preview) this.preview.clear()
      bus.emit('geometryChanged')
      bus.emit('toolStatus', 'LINE: Shape closed! Click start point for new path')
    } else {
      this._points.push(p)
      this.snap.setDrawOrigin(p)
      this.coord.setRelativeOrigin(p)
      this.constraint.clearAll()
      bus.emit('geometryChanged')
      bus.emit('toolStatus', 'LINE: Click next point (Dbl-click or Esc to finish)')
    }
  }

  _handleMove(e) {
    if (!this._active) return
    const raw = this.coord.screenToWorld(e.clientX, e.clientY)
    const mods = { shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey }
    let snapped = this.snap.snap(raw, mods)

    if (this._points.length > 0) {
      const origin = this._points[this._points.length - 1]
      snapped = this.constraint.apply(origin, snapped)
    }

    this._lastMouse = snapped

    if (this.preview && this._points.length > 0) {
      const origin = this._points[this._points.length - 1]
      this.preview.clear()
      this.preview.showLine(origin, snapped, 0x00ff88, 0.7)
      this.preview.showSnapIndicator(this.snap.activeSnap)

      // Show length & angle tooltip
      const len = Math.hypot(snapped.x - origin.x, snapped.y - origin.y)
      const ang = Math.atan2(snapped.y - origin.y, snapped.x - origin.x) * 180 / Math.PI

      // Close-path indicator
      if (this._points.length >= 2 && this.snap.activeSnap && this.snap.activeSnap.type === 'ClosePath') {
        bus.emit('toolInfo', { length: len.toFixed(2), angle: ang.toFixed(1), close: true })
        bus.emit('toolStatus', 'LINE: Click to CLOSE SHAPE')
      } else {
        bus.emit('toolInfo', { length: len.toFixed(2), angle: ang.toFixed(1) })
      }
    }
  }

  _handleDblClick(_e) {
    // Finish multi-segment
    this._points = []
    this.snap.setDrawOrigin(null)
    this.snap.setPathFirstPoint(null)
    this.constraint.clearAll()
    if (this.preview) this.preview.clear()
    bus.emit('toolStatus', 'LINE: Click start point')
  }
}

