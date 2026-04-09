// src/tools/OffsetTool.js
// Select an edge → type offset distance → parallel copy.

import * as THREE from 'three'
import { bus } from '../core/EventBus.js'
import { CAD } from '../theme/cadTheme.js'

export class OffsetTool {
  constructor(deps) {
    this.scene    = deps.scene
    this.store    = deps.store
    this.coord    = deps.coord
    this.snap     = deps.snap
    this.history  = deps.history
    this.canvas   = deps.canvas
    this._meshMap = deps.meshMap

    this._targetEdge = null
    this._handleClick = this._handleClick.bind(this)
  }

  get toolName() { return 'offset' }

  activate() {
    this._targetEdge = null
    this.canvas.style.cursor = 'crosshair'
    this.canvas.addEventListener('click', this._handleClick)
    bus.emit('toolStatus', 'OFFSET: Click an edge, then type distance in command bar')
  }

  deactivate() {
    this.canvas.style.cursor = 'default'
    this.canvas.removeEventListener('click', this._handleClick)
    this._targetEdge = null
  }

  cancel() {
    this._targetEdge = null
    bus.emit('toolStatus', 'OFFSET: Click an edge')
  }

  /** Called from command bar with distance value */
  applyOffset(distance) {
    if (!this._targetEdge || !distance) return

    const edge = this._targetEdge
    if (edge.type !== 'line') {
      bus.emit('toolStatus', 'OFFSET: Only line edges supported currently')
      return
    }

    const dx = edge.end.x - edge.start.x
    const dy = edge.end.y - edge.start.y
    const len = Math.hypot(dx, dy)
    if (len < 1e-8) return

    // Normal perpendicular (left side)
    const nx = -dy / len * distance
    const ny =  dx / len * distance

    const newStart = { x: this.coord.round(edge.start.x + nx), y: this.coord.round(edge.start.y + ny) }
    const newEnd   = { x: this.coord.round(edge.end.x + nx),   y: this.coord.round(edge.end.y + ny) }

    const store = this.store
    const scene = this.scene
    const meshMap = this._meshMap

    this.history.execute({
      label: 'Offset',
      _id: null,
      execute() {
        this._id = store.addEdge({ type: 'line', start: newStart, end: newEnd })
        if (this._id) {
          const geo = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(newStart.x, newStart.y, 0),
            new THREE.Vector3(newEnd.x, newEnd.y, 0)
          ])
          const mat = new THREE.LineBasicMaterial({ color: CAD.edge })
          const line = new THREE.Line(geo, mat)
          line.userData.edgeId = this._id
          scene.add(line); meshMap.set(this._id, line)
        }
      },
      undo() {
        if (!this._id) return
        store.removeEdge(this._id)
        const mesh = meshMap.get(this._id)
        if (mesh) { scene.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose(); meshMap.delete(this._id) }
      }
    })

    this._targetEdge = null
    bus.emit('geometryChanged')
    bus.emit('toolStatus', 'OFFSET: Click another edge')
  }

  _handleClick(e) {
    const world = this.coord.screenToWorld(e.clientX, e.clientY)
    const threshold = this.coord.snapWorldThreshold()
    const edges = this.store.getEdges()

    let best = null, bestD = Infinity
    for (const edge of edges) {
      const d = this._distToEdge(world, edge)
      if (d < threshold && d < bestD) { best = edge; bestD = d }
    }

    if (best) {
      this._targetEdge = best
      bus.emit('toolStatus', `OFFSET: Edge selected. Type distance (e.g. L20) in command bar.`)
    } else {
      bus.emit('toolStatus', 'OFFSET: No edge found. Click closer.')
    }
  }

  _distToEdge(p, edge) {
    if (edge.type !== 'line') return Infinity
    const a = edge.start, b = edge.end
    const dx = b.x - a.x, dy = b.y - a.y
    const lenSq = dx * dx + dy * dy
    if (lenSq < 1e-12) return Math.hypot(p.x - a.x, p.y - a.y)
    let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq
    t = Math.max(0, Math.min(1, t))
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
  }
}
