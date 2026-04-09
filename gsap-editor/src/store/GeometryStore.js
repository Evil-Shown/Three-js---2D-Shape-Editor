// src/store/GeometryStore.js

export class GeometryStore {
  constructor() {
    this._edges = []
    this._counter = 0
    this._version = 0
  }

  generateId() {
    this._counter += 1
    return `edge_${this._counter}`
  }

  get version() { return this._version }

  addEdge(edgeData) {
    if (!edgeData || !edgeData.type) {
      throw new Error('Invalid edge data')
    }

    const err = this._validate(edgeData)
    if (err) {
      console.warn(`GeometryStore rejected edge: ${err}`)
      return null
    }

    const id = this.generateId()
    const newEdge = { id, ...edgeData }
    this._edges.push(this._deepCopy(newEdge))
    this._version++
    return id
  }

  _validate(edge) {
    if (edge.type === 'line') {
      if (!edge.start || !edge.end) return 'Line missing start or end'
      const len = Math.hypot(edge.end.x - edge.start.x, edge.end.y - edge.start.y)
      if (len < 0.01) return 'Zero-length line'
    }

    if (edge.type === 'arc') {
      if (!edge.center) return 'Arc missing center'
      if (!edge.radius || edge.radius <= 0) return 'Arc radius must be > 0'
      if (edge.startAngle === undefined || edge.endAngle === undefined) return 'Arc missing angles'
      if (Math.abs(edge.endAngle - edge.startAngle) < 0.001) return 'Arc has zero sweep'
    }

    return null
  }

  removeEdge(id) {
    this._edges = this._edges.filter(edge => edge.id !== id)
    this._version++
  }

  getEdgeById(id) {
    const e = this._edges.find(edge => edge.id === id)
    return e ? this._deepCopy(e) : null
  }

  getEdges() {
    return this._edges.map(edge => this._deepCopy(edge))
  }

  popEdge() {
    if (this._edges.length === 0) return null
    this._version++
    return this._edges.pop()
  }

  getEdgeCount() {
    return this._edges.length
  }

  replaceEdge(id, edgeData) {
    const idx = this._edges.findIndex(e => e.id === id)
    if (idx === -1) return false
    this._edges[idx] = this._deepCopy({ ...edgeData, id })
    this._version++
    return true
  }

  moveEdge(id, dx, dy) {
    const edge = this._edges.find(e => e.id === id)
    if (!edge) return false
    if (edge.type === 'line') {
      edge.start.x += dx; edge.start.y += dy
      edge.end.x += dx;   edge.end.y += dy
    } else if (edge.type === 'arc') {
      edge.center.x += dx; edge.center.y += dy
    }
    this._version++
    return true
  }

  restoreEdge(edgeData) {
    const existing = this._edges.findIndex(e => e.id === edgeData.id)
    if (existing !== -1) {
      this._edges[existing] = this._deepCopy(edgeData)
    } else {
      this._edges.push(this._deepCopy(edgeData))
    }
    this._version++
  }

  clear() {
    this._edges = []
    this._counter = 0
    this._version++
  }

  /**
   * Replace all edges from an export payload (preserves ids when present).
   * Updates internal id counter so new edges do not collide.
   */
  importEdgesFromPayload(edgeList) {
    if (!Array.isArray(edgeList)) return
    this.clear()
    for (const raw of edgeList) {
      const normalized = this._normalizeImportedEdge(raw)
      if (!normalized) continue
      const id = raw && raw.id != null && String(raw.id).trim() !== '' ? String(raw.id) : null
      if (id) {
        this.restoreEdge({ ...normalized, id })
      } else {
        this.addEdge(normalized)
      }
    }
    this._bumpCounterFromExistingIds()
  }

  _normalizeImportedEdge(raw) {
    if (!raw || !raw.type) return null
    const t = String(raw.type).toLowerCase()
    if (t === 'line') {
      const start = raw.start
      const end = raw.end
      if (!start || !end) return null
      return {
        type: 'line',
        start: { x: Number(start.x), y: Number(start.y) },
        end: { x: Number(end.x), y: Number(end.y) },
      }
    }
    if (t === 'arc') {
      const c = raw.center
      if (!c || raw.radius == null) return null
      if (raw.startAngle === undefined || raw.endAngle === undefined) return null
      return {
        type: 'arc',
        center: { x: Number(c.x), y: Number(c.y) },
        radius: Number(raw.radius),
        startAngle: Number(raw.startAngle),
        endAngle: Number(raw.endAngle),
        clockwise: Boolean(raw.clockwise),
      }
    }
    return null
  }

  _bumpCounterFromExistingIds() {
    let maxN = 0
    for (const edge of this._edges) {
      const m = String(edge.id || '').match(/^edge_(\d+)$/)
      if (m) maxN = Math.max(maxN, parseInt(m[1], 10))
    }
    if (maxN > this._counter) this._counter = maxN
  }

  _deepCopy(edge) {
    const copy = { ...edge }
    if (copy.start) copy.start = { ...copy.start }
    if (copy.end) copy.end = { ...copy.end }
    if (copy.center) copy.center = { ...copy.center }
    return copy
  }
}