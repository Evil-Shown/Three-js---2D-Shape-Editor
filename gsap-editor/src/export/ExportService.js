// src/export/ExportService.js

export class ExportService {
  constructor(store) {
    this.store = store
  }

  exportJSON(meta = { name: 'shape', thickness: 1 }) {
    if (this.store.getEdgeCount() === 0) {
      alert('Nothing to export')
      return
    }

    const payload = {
      name: meta.name,
      version: '1.0',
      unit: 'mm',
      thickness: meta.thickness,
      edges: this.store.getEdges()
        .map(e => this._cleanEdge(e))
        .filter(e => this._isValid(e))
    }

    if (payload.edges.length === 0) {
      alert('No valid edges to export')
      return
    }

    const blob = new Blob(
      [JSON.stringify(payload, null, 2)],
      { type: 'application/json' }
    )

    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${meta.name}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  _cleanPoint(p) {
    return { x: p.x, y: p.y }
  }

  _cleanEdge(edge) {
    if (edge.type === 'line') {
      return {
        type: 'line',
        start: this._cleanPoint(edge.start),
        end: this._cleanPoint(edge.end)
      }
    }
    if (edge.type === 'arc') {
      return {
        type: 'arc',
        center: this._cleanPoint(edge.center),
        radius: edge.radius,
        startAngle: edge.startAngle,
        endAngle: edge.endAngle,
        clockwise: edge.clockwise
      }
    }
    return edge
  }

  _isValid(edge) {
    if (edge.type === 'line') {
      if (!edge.start || !edge.end) return false
      return Math.hypot(edge.end.x - edge.start.x, edge.end.y - edge.start.y) > 0.01
    }
    if (edge.type === 'arc') {
      if (!edge.center || !edge.radius || edge.radius <= 0) return false
      return Math.abs(edge.endAngle - edge.startAngle) >= 0.001
    }
    return false
  }
}
