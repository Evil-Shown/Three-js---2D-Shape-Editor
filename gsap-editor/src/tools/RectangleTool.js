// src/tools/RectangleTool.js
// Click two opposite corners → generates 4 line edges.

import * as THREE from 'three'
import { bus } from '../core/EventBus.js'

export class RectangleTool {
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

    this._handleClick = this._handleClick.bind(this)
    this._handleMove  = this._handleMove.bind(this)
  }

  get toolName() { return 'rectangle' }

  activate() {
    this._corner1 = null
    this.canvas.style.cursor = 'crosshair'
    this.canvas.addEventListener('click', this._handleClick)
    this.canvas.addEventListener('mousemove', this._handleMove)
    bus.emit('toolStatus', 'RECT: Click first corner')
  }

  deactivate() {
    this.canvas.style.cursor = 'default'
    this.canvas.removeEventListener('click', this._handleClick)
    this.canvas.removeEventListener('mousemove', this._handleMove)
    this._corner1 = null
    if (this.preview) this.preview.clear()
  }

  cancel() {
    this._corner1 = null
    if (this.preview) this.preview.clear()
    bus.emit('toolStatus', 'RECT: Click first corner')
  }

  acceptPoint(p) { this._processPoint(this.coord.roundPoint(p)) }

  _handleClick(e) {
    if (e.detail >= 2) return
    const raw = this.coord.screenToWorld(e.clientX, e.clientY)
    const snapped = this.snap.snap(raw, { shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey })
    this._processPoint(this.coord.roundPoint(snapped))
  }

  _processPoint(p) {
    if (!this._corner1) {
      this._corner1 = p
      this.snap.setDrawOrigin(p)
      this.coord.setRelativeOrigin(p)
      bus.emit('toolStatus', 'RECT: Click opposite corner')
      return
    }

    const c1 = this._corner1
    const c2 = p
    if (Math.abs(c2.x - c1.x) < 0.01 || Math.abs(c2.y - c1.y) < 0.01) return

    const corners = [
      { x: c1.x, y: c1.y },
      { x: c2.x, y: c1.y },
      { x: c2.x, y: c2.y },
      { x: c1.x, y: c2.y }
    ]

    const store = this.store
    const scene = this.scene
    const meshMap = this._meshMap
    const ids = []

    this.history.execute({
      label: 'Draw Rectangle',
      execute() {
        ids.length = 0
        for (let i = 0; i < 4; i++) {
          const s = corners[i]
          const e = corners[(i + 1) % 4]
          const id = store.addEdge({ type: 'line', start: { ...s }, end: { ...e } })
          if (id) {
            ids.push(id)
            const geo = new THREE.BufferGeometry().setFromPoints([
              new THREE.Vector3(s.x, s.y, 0), new THREE.Vector3(e.x, e.y, 0)
            ])
            const mat = new THREE.LineBasicMaterial({ color: 0xffffff })
            const line = new THREE.Line(geo, mat)
            line.userData.edgeId = id
            scene.add(line)
            meshMap.set(id, line)
          }
        }
      },
      undo() {
        for (const id of ids) {
          store.removeEdge(id)
          const mesh = meshMap.get(id)
          if (mesh) { scene.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose(); meshMap.delete(id) }
        }
      }
    })

    this._corner1 = null
    this.snap.setDrawOrigin(null)
    if (this.preview) this.preview.clear()
    bus.emit('geometryChanged')
    bus.emit('toolStatus', 'RECT: Click first corner')
  }

  _handleMove(e) {
    if (!this._corner1 || !this.preview) return
    const raw = this.coord.screenToWorld(e.clientX, e.clientY)
    const snapped = this.snap.snap(raw, { shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey })

    this.preview.clear()
    const c1 = this._corner1, c2 = snapped
    const corners = [
      { x: c1.x, y: c1.y }, { x: c2.x, y: c1.y },
      { x: c2.x, y: c2.y }, { x: c1.x, y: c2.y }
    ]
    for (let i = 0; i < 4; i++) {
      this.preview.showLine(corners[i], corners[(i + 1) % 4], 0x00ff88, 0.7)
    }
    this.preview.showSnapIndicator(this.snap.activeSnap)

    const w = Math.abs(c2.x - c1.x), h = Math.abs(c2.y - c1.y)
    bus.emit('toolInfo', { width: w.toFixed(2), height: h.toFixed(2) })
  }
}
