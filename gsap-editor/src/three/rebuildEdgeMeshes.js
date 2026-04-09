import * as THREE from 'three'
import { CAD } from '../theme/cadTheme.js'

/**
 * Rebuild Three.js line meshes from GeometryStore (e.g. after JSON import).
 */
export function rebuildEdgeMeshes(threeScene, store, meshMap) {
  meshMap.forEach((m) => {
    threeScene.remove(m)
    m.geometry?.dispose()
    m.material?.dispose()
  })
  meshMap.clear()

  for (const edge of store.getEdges()) {
    if (edge.type === 'line') {
      const pts = [
        new THREE.Vector3(edge.start.x, edge.start.y, 0),
        new THREE.Vector3(edge.end.x, edge.end.y, 0),
      ]
      const geo = new THREE.BufferGeometry().setFromPoints(pts)
      const mat = new THREE.LineBasicMaterial({ color: CAD.edge })
      const line = new THREE.Line(geo, mat)
      line.userData.edgeId = edge.id
      threeScene.add(line)
      meshMap.set(edge.id, line)
    } else if (edge.type === 'arc') {
      const curve = new THREE.EllipseCurve(
        edge.center.x,
        edge.center.y,
        edge.radius,
        edge.radius,
        edge.startAngle,
        edge.endAngle,
        edge.clockwise,
        0
      )
      const arcPts = curve.getPoints(64)
      const geo = new THREE.BufferGeometry().setFromPoints(arcPts)
      const mat = new THREE.LineBasicMaterial({ color: CAD.edge })
      const line = new THREE.Line(geo, mat)
      line.userData.edgeId = edge.id
      threeScene.add(line)
      meshMap.set(edge.id, line)
    }
  }
}
