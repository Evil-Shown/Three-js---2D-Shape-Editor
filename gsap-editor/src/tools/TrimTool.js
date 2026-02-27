// src/tools/TrimTool.js
// Click an edge near an intersection — trims it at the intersection point.

import * as THREE from 'three'
import { bus } from '../core/EventBus.js'

export class TrimTool {
  constructor(deps) {
    this.scene    = deps.scene
    this.store    = deps.store
    this.coord    = deps.coord
    this.snap     = deps.snap
    this.history  = deps.history
    this.canvas   = deps.canvas
    this._meshMap = deps.meshMap

    this._handleClick = this._handleClick.bind(this)
  }

  get toolName() { return 'trim' }

  activate() {
    this.canvas.style.cursor = 'crosshair'
    this.canvas.addEventListener('click', this._handleClick)
    bus.emit('toolStatus', 'TRIM: Click an edge near an intersection to trim')
  }

  deactivate() {
    this.canvas.style.cursor = 'default'
    this.canvas.removeEventListener('click', this._handleClick)
  }

  cancel() { bus.emit('toolStatus', 'TRIM: Click an edge near an intersection to trim') }

  _handleClick(e) {
    const world = this.coord.screenToWorld(e.clientX, e.clientY)
    const threshold = this.coord.snapWorldThreshold()
    const edges = this.store.getEdges()

    // Find the clicked edge
    let targetEdge = null, minDist = Infinity
    for (const edge of edges) {
      const d = this._distToEdge(world, edge)
      if (d < threshold && d < minDist) { targetEdge = edge; minDist = d }
    }
    if (!targetEdge || targetEdge.type !== 'line') {
      bus.emit('toolStatus', 'TRIM: No valid line edge found. Click closer.')
      return
    }

    // Find intersections of this edge with all others
    const intersections = []
    for (const other of edges) {
      if (other.id === targetEdge.id) continue
      const pts = this._intersectLineLine(targetEdge, other)
      intersections.push(...pts)
    }

    if (intersections.length === 0) {
      bus.emit('toolStatus', 'TRIM: No intersections found on this edge')
      return
    }

    // Find the intersection point closest to click
    let bestPt = null, bestD = Infinity
    for (const pt of intersections) {
      const d = Math.hypot(pt.x - world.x, pt.y - world.y)
      if (d < bestD) { bestPt = pt; bestD = d }
    }

    // Determine which side of the intersection to trim (remove the side closest to click)
    const clickT = this._paramOnLine(world, targetEdge.start, targetEdge.end)
    const intT   = this._paramOnLine(bestPt, targetEdge.start, targetEdge.end)

    const store = this.store
    const scene = this.scene
    const meshMap = this._meshMap
    const oldEdge = { ...targetEdge, start: { ...targetEdge.start }, end: { ...targetEdge.end } }
    const trimPt = { x: this.coord.round(bestPt.x), y: this.coord.round(bestPt.y) }

    // Keep the side opposite the click
    const newStart = clickT < intT ? trimPt : { ...oldEdge.start }
    const newEnd   = clickT < intT ? { ...oldEdge.end } : trimPt

    this.history.execute({
      label: 'Trim',
      execute() {
        store.replaceEdge(oldEdge.id, { ...oldEdge, start: newStart, end: newEnd })
        _rebuild(oldEdge.id)
      },
      undo() {
        store.replaceEdge(oldEdge.id, oldEdge)
        _rebuild(oldEdge.id)
      }
    })

    function _rebuild(id) {
      const m = meshMap.get(id)
      if (m) { scene.remove(m); m.geometry.dispose(); m.material.dispose(); meshMap.delete(id) }
      const edge = store.getEdges().find(ed => ed.id === id)
      if (!edge || edge.type !== 'line') return
      const geo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(edge.start.x, edge.start.y, 0),
        new THREE.Vector3(edge.end.x, edge.end.y, 0)
      ])
      const mat = new THREE.LineBasicMaterial({ color: 0xffffff })
      const line = new THREE.Line(geo, mat)
      line.userData.edgeId = id
      scene.add(line); meshMap.set(id, line)
    }

    bus.emit('geometryChanged')
    bus.emit('toolStatus', 'TRIM: Edge trimmed. Click another edge.')
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

  _intersectLineLine(a, b) {
    const x1 = a.start.x, y1 = a.start.y, x2 = a.end.x, y2 = a.end.y
    const x3 = b.start.x, y3 = b.start.y, x4 = b.end.x, y4 = b.end.y
    const det = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4)
    if (Math.abs(det) < 1e-8) return []
    const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / det
    const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / det
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
      return [{ x: x1 + t * (x2 - x1), y: y1 + t * (y2 - y1) }]
    }
    return []
  }

  _paramOnLine(p, s, e) {
    const dx = e.x - s.x, dy = e.y - s.y
    const lenSq = dx * dx + dy * dy
    if (lenSq < 1e-12) return 0
    return ((p.x - s.x) * dx + (p.y - s.y) * dy) / lenSq
  }
}
