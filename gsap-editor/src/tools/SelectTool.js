// src/tools/SelectTool.js
// Click to select edges, Shift+click to multi-select, Delete to remove.
// Uses mathematical hit testing (not raycasting).

import { bus } from '../core/EventBus.js'
import { CAD } from '../theme/cadTheme.js'

export class SelectTool {
  constructor(deps) {
    this.scene      = deps.scene
    this.store      = deps.store
    this.coord      = deps.coord
    this.history    = deps.history
    this.canvas     = deps.canvas
    this._meshMap   = deps.meshMap
    this.preview    = deps.previewLayer

    this._selected  = new Set()   // edge ids
    this._hovered   = null

    this._handleClick = this._handleClick.bind(this)
    this._handleMove  = this._handleMove.bind(this)
  }

  get toolName() { return 'select' }

  activate() {
    this.canvas.style.cursor = 'default'
    this.canvas.addEventListener('click', this._handleClick)
    this.canvas.addEventListener('mousemove', this._handleMove)
    bus.emit('toolStatus', 'SELECT: Click edge to select')
  }

  deactivate() {
    this.canvas.removeEventListener('click', this._handleClick)
    this.canvas.removeEventListener('mousemove', this._handleMove)
    this._clearHighlights()
    this._selected.clear()
    this._hovered = null
  }

  cancel() {
    this._clearHighlights()
    this._selected.clear()
    this._hovered = null
    bus.emit('selectionChanged', { ids: [] })
    bus.emit('toolStatus', 'SELECT: Click edge to select')
  }

  selectAll() {
    this._clearHighlights()
    this._selected.clear()
    for (const e of this.store.getEdges()) {
      this._selected.add(e.id)
    }
    this._applyHighlights()
    bus.emit('selectionChanged', { ids: [...this._selected] })
  }

  deleteSelected() {
    if (this._selected.size === 0) return

    const edges = []
    for (const id of this._selected) {
      const edgeList = this.store.getEdges()
      const edge = edgeList.find(e => e.id === id)
      if (edge) edges.push({ ...edge })
    }
    if (edges.length === 0) return

    const store = this.store
    const scene = this.scene
    const meshMap = this._meshMap
    const ids = [...this._selected]

    this.history.execute({
      label: `Delete ${edges.length} edge(s)`,
      _meshes: [],
      execute() {
        this._meshes = []
        for (const id of ids) {
          const mesh = meshMap.get(id)
          if (mesh) {
            scene.remove(mesh)
            this._meshes.push({ id, mesh })
            meshMap.delete(id)
          }
          store.removeEdge(id)
        }
      },
      undo() {
        for (const edgeData of edges) {
          store.restoreEdge(edgeData)
        }
        for (const { id, mesh } of this._meshes) {
          scene.add(mesh)
          meshMap.set(id, mesh)
        }
      }
    })

    this._selected.clear()
    bus.emit('selectionChanged', { ids: [] })
    bus.emit('geometryChanged')
    bus.emit('toolStatus', 'SELECT: Click edge to select')
  }

  getSelectedIds() { return [...this._selected] }

  /* ── private ── */

  _handleClick(e) {
    const world = this.coord.screenToWorld(e.clientX, e.clientY)
    const hit = this._hitTest(world)

    if (!e.shiftKey) {
      this._clearHighlights()
      this._selected.clear()
    }

    if (hit) {
      if (this._selected.has(hit.id)) {
        this._selected.delete(hit.id)
      } else {
        this._selected.add(hit.id)
      }
    }

    this._applyHighlights()
    bus.emit('selectionChanged', { ids: [...this._selected], edges: this._getSelectedEdges() })
  }

  _handleMove(e) {
    const world = this.coord.screenToWorld(e.clientX, e.clientY)
    const hit = this._hitTest(world)
    const newHover = hit ? hit.id : null

    if (newHover !== this._hovered) {
      // Remove old hover highlight
      if (this._hovered && !this._selected.has(this._hovered)) {
        this._setEdgeColor(this._hovered, CAD.edge)
      }
      // Add new hover highlight
      if (newHover && !this._selected.has(newHover)) {
        this._setEdgeColor(newHover, CAD.edgeHover)
      }
      this._hovered = newHover
      this.canvas.style.cursor = newHover ? 'pointer' : 'default'
    }
  }

  _hitTest(world) {
    const threshold = this.coord.snapWorldThreshold()
    const edges = this.store.getEdges()
    let best = null, bestDist = Infinity

    for (const e of edges) {
      const d = this._distToEdge(world, e)
      if (d < threshold && d < bestDist) {
        best = e
        bestDist = d
      }
    }
    return best
  }

  _distToEdge(p, edge) {
    if (edge.type === 'line') return this._distToLine(p, edge.start, edge.end)
    if (edge.type === 'arc')  return this._distToArc(p, edge)
    return Infinity
  }

  _distToLine(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y
    const lenSq = dx * dx + dy * dy
    if (lenSq < 1e-12) return Math.hypot(p.x - a.x, p.y - a.y)

    let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq
    t = Math.max(0, Math.min(1, t))
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
  }

  _distToArc(p, arc) {
    const dx = p.x - arc.center.x
    const dy = p.y - arc.center.y
    const dist = Math.hypot(dx, dy)
    const angle = Math.atan2(dy, dx)

    // Check if angle is within arc sweep
    if (this._angleInSweep(angle, arc.startAngle, arc.endAngle, arc.clockwise)) {
      return Math.abs(dist - arc.radius)
    }

    // If not in sweep, distance to nearest endpoint
    const sp = { x: arc.center.x + arc.radius * Math.cos(arc.startAngle), y: arc.center.y + arc.radius * Math.sin(arc.startAngle) }
    const ep = { x: arc.center.x + arc.radius * Math.cos(arc.endAngle), y: arc.center.y + arc.radius * Math.sin(arc.endAngle) }
    return Math.min(Math.hypot(p.x - sp.x, p.y - sp.y), Math.hypot(p.x - ep.x, p.y - ep.y))
  }

  _angleInSweep(angle, start, end, cw) {
    const norm = a => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
    const a = norm(angle), s = norm(start), e = norm(end)
    if (!cw) {
      if (e >= s) return a >= s && a <= e
      return a >= s || a <= e
    } else {
      if (s >= e) return a <= s && a >= e
      return a <= s || a >= e
    }
  }

  _applyHighlights() {
    for (const id of this._selected) this._setEdgeColor(id, CAD.edgeSelected)
    // Un-highlight anything not selected (except hovered)
    for (const [id] of this._meshMap) {
      if (!this._selected.has(id) && id !== this._hovered) this._setEdgeColor(id, CAD.edge)
    }
  }

  _clearHighlights() {
    for (const [id] of this._meshMap) this._setEdgeColor(id, CAD.edge)
  }

  _setEdgeColor(id, color) {
    const mesh = this._meshMap.get(id)
    if (mesh && mesh.material) mesh.material.color.setHex(color)
  }

  _getSelectedEdges() {
    return this.store.getEdges().filter(e => this._selected.has(e.id))
  }
}
