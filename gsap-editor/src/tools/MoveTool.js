// src/tools/MoveTool.js
// Select edges → click base point → click destination → move by delta.

import * as THREE from 'three'
import { bus } from '../core/EventBus.js'
import { CAD } from '../theme/cadTheme.js'

export class MoveTool {
  constructor(deps) {
    this.scene      = deps.scene
    this.store      = deps.store
    this.coord      = deps.coord
    this.snap       = deps.snap
    this.history    = deps.history
    this.canvas     = deps.canvas
    this._meshMap   = deps.meshMap
    this.preview    = deps.previewLayer
    this.toolMgr    = null  // set after ToolManager created

    this._basePoint = null
    this._selectedIds = []

    this._handleClick = this._handleClick.bind(this)
    this._handleMove  = this._handleMove.bind(this)
  }

  get toolName() { return 'move' }

  activate() {
    // Grab current selection from SelectTool
    if (this.toolMgr) {
      const st = this.toolMgr._tools.get('select')
      if (st) this._selectedIds = st.getSelectedIds()
    }
    if (this._selectedIds.length === 0) {
      bus.emit('toolStatus', 'MOVE: Select edges first, then switch to Move')
    } else {
      bus.emit('toolStatus', 'MOVE: Click base point')
    }
    this._basePoint = null
    this.canvas.style.cursor = 'crosshair'
    this.canvas.addEventListener('click', this._handleClick)
    this.canvas.addEventListener('mousemove', this._handleMove)
  }

  deactivate() {
    this.canvas.style.cursor = 'default'
    this.canvas.removeEventListener('click', this._handleClick)
    this.canvas.removeEventListener('mousemove', this._handleMove)
    this._basePoint = null
    if (this.preview) this.preview.clear()
  }

  cancel() {
    this._basePoint = null
    if (this.preview) this.preview.clear()
    bus.emit('toolStatus', 'MOVE: Click base point')
  }

  acceptPoint(p) { this._processPoint(this.coord.roundPoint(p)) }

  _handleClick(e) {
    if (e.detail >= 2) return
    const raw = this.coord.screenToWorld(e.clientX, e.clientY)
    const snapped = this.snap.snap(raw, { shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey })
    this._processPoint(this.coord.roundPoint(snapped))
  }

  _processPoint(p) {
    if (this._selectedIds.length === 0) return

    if (!this._basePoint) {
      this._basePoint = p
      this.snap.setDrawOrigin(p)
      this.coord.setRelativeOrigin(p)
      bus.emit('toolStatus', 'MOVE: Click destination')
      return
    }

    const dx = p.x - this._basePoint.x
    const dy = p.y - this._basePoint.y
    if (Math.abs(dx) < 1e-8 && Math.abs(dy) < 1e-8) return

    const store = this.store
    const scene = this.scene
    const meshMap = this._meshMap
    const ids = [...this._selectedIds]

    // Clone edges before move for undo
    const beforeEdges = ids.map(id => {
      const e = store.getEdges().find(edge => edge.id === id)
      return e ? { ...e, start: e.start ? { ...e.start } : undefined, end: e.end ? { ...e.end } : undefined, center: e.center ? { ...e.center } : undefined } : null
    }).filter(Boolean)

    this.history.execute({
      label: 'Move',
      execute() {
        for (const id of ids) {
          store.moveEdge(id, dx, dy)
          _rebuildMesh(id)
        }
      },
      undo() {
        for (const before of beforeEdges) {
          store.replaceEdge(before.id, before)
          _rebuildMesh(before.id)
        }
      }
    })

    function _rebuildMesh(id) {
      const old = meshMap.get(id)
      if (old) { scene.remove(old); old.geometry.dispose(); old.material.dispose(); meshMap.delete(id) }
      const edge = store.getEdges().find(e => e.id === id)
      if (!edge) return
      if (edge.type === 'line') {
        const geo = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(edge.start.x, edge.start.y, 0),
          new THREE.Vector3(edge.end.x, edge.end.y, 0)
        ])
        const mat = new THREE.LineBasicMaterial({ color: CAD.edge })
        const line = new THREE.Line(geo, mat)
        line.userData.edgeId = id
        scene.add(line); meshMap.set(id, line)
      } else if (edge.type === 'arc') {
        const curve = new THREE.EllipseCurve(edge.center.x, edge.center.y, edge.radius, edge.radius, edge.startAngle, edge.endAngle, edge.clockwise, 0)
        const pts = curve.getPoints(64)
        const geo = new THREE.BufferGeometry().setFromPoints(pts)
        const mat = new THREE.LineBasicMaterial({ color: CAD.edge })
        const line = new THREE.Line(geo, mat)
        line.userData.edgeId = id
        scene.add(line); meshMap.set(id, line)
      }
    }

    this._basePoint = null
    this.snap.setDrawOrigin(null)
    if (this.preview) this.preview.clear()
    bus.emit('geometryChanged')
    bus.emit('toolStatus', 'MOVE: Click base point')
  }

  _handleMove(e) {
    if (!this._basePoint || !this.preview) return
    const raw = this.coord.screenToWorld(e.clientX, e.clientY)
    const snapped = this.snap.snap(raw, { shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey })

    this.preview.clear()
    this.preview.showLine(this._basePoint, snapped, 0xff8800, 0.6)
    this.preview.showSnapIndicator(this.snap.activeSnap)
  }
}
