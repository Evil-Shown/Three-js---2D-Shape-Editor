// src/export/ParameterSerializer.js

export class ParameterSerializer {

  serialize(parameterStore, geometryStore) {
    const payload = parameterStore.getExportPayload()
    const edges = geometryStore.getEdges()

    return {
      shapeMetadata: payload.shapeMetadata,
      parameters: payload.parameters,
      pointExpressions: payload.pointExpressions,
      edgeServices: payload.edgeServices,
      edges: edges.map(e => this._cleanEdge(e)),
    }
  }

  deserialize(json, parameterStore) {
    parameterStore.clear()

    if (json.shapeMetadata) {
      parameterStore.setShapeMetadata({
        className: json.shapeMetadata.className || 'ShapeTransformer_100',
        shapeNumber: json.shapeMetadata.shapeNumber || '100',
        packageName: json.shapeMetadata.packageName || 'com.core.shape.transformer.impl',
      })
      if (json.shapeMetadata.trimBottomService || json.shapeMetadata.trimLeftService) {
        parameterStore.setTrimDefinition(
          json.shapeMetadata.trimBottomService || 'E1',
          json.shapeMetadata.trimLeftService || 'E7'
        )
      }
    }

    if (json.parameters && Array.isArray(json.parameters)) {
      for (const p of json.parameters) {
        try {
          const id = parameterStore.addParameter(
            p.name, p.type, p.defaultValue, p.description
          )
          if (p.expression) {
            parameterStore.updateParameter(id, { expression: p.expression })
          }
        } catch (e) {
          console.warn('Failed to load parameter:', p.name, e.message)
        }
      }
    }

    if (json.pointExpressions) {
      for (const [pointId, expr] of Object.entries(json.pointExpressions)) {
        parameterStore.setPointExpression(pointId, expr.x || '', expr.y || '')
      }
    }

    if (json.edgeServices) {
      for (const [edgeId, service] of Object.entries(json.edgeServices)) {
        parameterStore.setEdgeService(edgeId, service)
      }
    }
  }

  _cleanEdge(edge) {
    const clean = { id: edge.id, type: edge.type }
    if (edge.type === 'line') {
      clean.start = { x: edge.start.x, y: edge.start.y }
      clean.end = { x: edge.end.x, y: edge.end.y }
    } else if (edge.type === 'arc') {
      clean.center = { x: edge.center.x, y: edge.center.y }
      clean.radius = edge.radius
      clean.startAngle = edge.startAngle
      clean.endAngle = edge.endAngle
      clean.clockwise = edge.clockwise
    }
    return clean
  }
}
