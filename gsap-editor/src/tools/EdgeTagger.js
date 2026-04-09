// src/tools/EdgeTagger.js

import * as THREE from 'three'
import { bus } from '../core/EventBus.js'
import { SERVICE_COLORS, SERVICE_LABELS } from '../parameters/ParameterTypes.js'
import { CAD } from '../theme/cadTheme.js'

export class EdgeTagger {
  constructor(deps) {
    this.scene = deps.scene
    this.store = deps.store
    this.coord = deps.coord
    this.canvas = deps.canvas
    this._meshMap = deps.meshMap
    this.paramStore = deps.paramStore
    this.preview = deps.previewLayer

    this._active = false
    this._hoveredEdgeId = null
    this._serviceOverlays = new Map()
    this._labelSprites = []

    this._handleMove = this._handleMove.bind(this)
    this._handleClick = this._handleClick.bind(this)
  }

  get toolName() { return 'edgeTagger' }

  activate() {
    this._active = true
    this.canvas.style.cursor = 'pointer'
    this.canvas.addEventListener('mousemove', this._handleMove)
    this.canvas.addEventListener('click', this._handleClick)
    this._refreshOverlays()
    bus.emit('toolStatus', 'EDGE TAGGER: Click an edge to assign a service label')
  }

  deactivate() {
    this._active = false
    this.canvas.style.cursor = 'default'
    this.canvas.removeEventListener('mousemove', this._handleMove)
    this.canvas.removeEventListener('click', this._handleClick)
    this._clearOverlays()
    this._resetAllEdgeColors()
  }

  cancel() {
    this._hoveredEdgeId = null
    bus.emit('toolStatus', 'EDGE TAGGER: Click an edge to assign a service label')
  }

  tagEdge(edgeId, serviceLabel) {
    this.paramStore.setEdgeService(edgeId, serviceLabel)
    this._refreshOverlays()
    bus.emit('edgeServiceChanged', { edgeId, serviceLabel })
    bus.emit('parameterChanged')
  }

  _handleMove(e) {
    if (!this._active) return
    const world = this.coord.screenToWorld(e.clientX, e.clientY)
    const threshold = this.coord.pixelSize() * 8

    const edges = this.store.getEdges()
    let closest = null
    let minDist = threshold

    for (const edge of edges) {
      const d = this._distToEdge(world, edge)
      if (d < minDist) {
        minDist = d
        closest = edge
      }
    }

    if (closest && closest.id !== this._hoveredEdgeId) {
      this._resetHoveredEdge()
      this._hoveredEdgeId = closest.id
      this._highlightEdge(closest.id, CAD.edgeHover)
      const svc = this.paramStore.getEdgeService(closest.id)
      bus.emit('toolStatus', svc
        ? `EDGE TAGGER: ${closest.id} → ${svc} (click to change)`
        : `EDGE TAGGER: ${closest.id} — untagged (click to assign)`)
    } else if (!closest && this._hoveredEdgeId) {
      this._resetHoveredEdge()
      bus.emit('toolStatus', 'EDGE TAGGER: Click an edge to assign a service label')
    }
  }

  _handleClick(e) {
    if (!this._active || !this._hoveredEdgeId) return
    bus.emit('edgeTagger:openPopup', {
      edgeId: this._hoveredEdgeId,
      screenX: e.clientX,
      screenY: e.clientY,
    })
  }

  _distToEdge(point, edge) {
    if (edge.type === 'line') {
      return this._pointToSegmentDist(point, edge.start, edge.end)
    }
    if (edge.type === 'arc') {
      return this._pointToArcDist(point, edge)
    }
    return Infinity
  }

  _pointToSegmentDist(p, a, b) {
    const dx = b.x - a.x
    const dy = b.y - a.y
    const lenSq = dx * dx + dy * dy
    if (lenSq < 0.0001) return Math.hypot(p.x - a.x, p.y - a.y)
    let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq
    t = Math.max(0, Math.min(1, t))
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
  }

  _pointToArcDist(p, arc) {
    const dx = p.x - arc.center.x
    const dy = p.y - arc.center.y
    const r = Math.hypot(dx, dy)
    const radialDist = Math.abs(r - arc.radius)

    let angle = Math.atan2(dy, dx)
    if (angle < 0) angle += Math.PI * 2

    let start = arc.startAngle
    let end = arc.endAngle
    if (start < 0) start += Math.PI * 2
    if (end < 0) end += Math.PI * 2

    const onArc = arc.clockwise
      ? this._angleInRange(angle, end, start)
      : this._angleInRange(angle, start, end)

    if (onArc) return radialDist

    const sp = {
      x: arc.center.x + arc.radius * Math.cos(arc.startAngle),
      y: arc.center.y + arc.radius * Math.sin(arc.startAngle)
    }
    const ep = {
      x: arc.center.x + arc.radius * Math.cos(arc.endAngle),
      y: arc.center.y + arc.radius * Math.sin(arc.endAngle)
    }

    return Math.min(
      Math.hypot(p.x - sp.x, p.y - sp.y),
      Math.hypot(p.x - ep.x, p.y - ep.y)
    )
  }

  _angleInRange(a, start, end) {
    if (start <= end) return a >= start && a <= end
    return a >= start || a <= end
  }

  _highlightEdge(edgeId, color) {
    const mesh = this._meshMap.get(edgeId)
    if (mesh && mesh.material) {
      mesh.material.color.set(color)
    }
  }

  _resetHoveredEdge() {
    if (!this._hoveredEdgeId) return
    const svc = this.paramStore.getEdgeService(this._hoveredEdgeId)
    if (svc && SERVICE_COLORS[svc]) {
      this._highlightEdge(this._hoveredEdgeId, SERVICE_COLORS[svc])
    } else {
      this._highlightEdge(this._hoveredEdgeId, CAD.edge)
    }
    this._hoveredEdgeId = null
  }

  _resetAllEdgeColors() {
    const edges = this.store.getEdges()
    for (const edge of edges) {
      this._highlightEdge(edge.id, CAD.edge)
    }
  }

  _refreshOverlays() {
    this._clearOverlays()
    const edges = this.store.getEdges()
    const services = this.paramStore.getAllEdgeServices()

    for (const edge of edges) {
      const svc = services[edge.id]
      if (svc && SERVICE_COLORS[svc]) {
        this._highlightEdge(edge.id, SERVICE_COLORS[svc])
      } else {
        this._highlightEdge(edge.id, CAD.edge)
      }
    }
  }

  _clearOverlays() {
    for (const [, obj] of this._serviceOverlays) {
      this.scene.remove(obj)
      if (obj.geometry) obj.geometry.dispose()
      if (obj.material) obj.material.dispose()
    }
    this._serviceOverlays.clear()
  }
}
