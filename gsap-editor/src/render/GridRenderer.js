// src/render/GridRenderer.js
// Draws adaptive grid (minor/major lines) as Three.js lines.
import * as THREE from 'three'
import { CAD } from '../theme/cadTheme.js'

export class GridRenderer {
  constructor(scene, coordEngine) {
    this.scene = scene
    this.coord = coordEngine
    this._lines = []
  }

  render() {
    this.clear()
    const bounds = this.coord.getVisibleBounds()
    const minor = this.coord.gridSize()
    const major = this.coord.majorGridSize()
    const z = -1
    const colorMinor = CAD.gridMinor
    const colorMajor = CAD.gridMajor

    // Minor grid
    for (let x = Math.ceil(bounds.left / minor) * minor; x < bounds.right; x += minor) {
      const geo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(x, bounds.bottom, z), new THREE.Vector3(x, bounds.top, z)
      ])
      const mat = new THREE.LineBasicMaterial({ color: (Math.abs(x % major) < 1e-6) ? colorMajor : colorMinor })
      const line = new THREE.Line(geo, mat)
      this.scene.add(line)
      this._lines.push(line)
    }
    for (let y = Math.ceil(bounds.bottom / minor) * minor; y < bounds.top; y += minor) {
      const geo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(bounds.left, y, z), new THREE.Vector3(bounds.right, y, z)
      ])
      const mat = new THREE.LineBasicMaterial({ color: (Math.abs(y % major) < 1e-6) ? colorMajor : colorMinor })
      const line = new THREE.Line(geo, mat)
      this.scene.add(line)
      this._lines.push(line)
    }
  }

  clear() {
    for (const l of this._lines) {
      this.scene.remove(l)
      if (l.geometry) l.geometry.dispose()
      if (l.material) l.material.dispose()
    }
    this._lines = []
  }
}
