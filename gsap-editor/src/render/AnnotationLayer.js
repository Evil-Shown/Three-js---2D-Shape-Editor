// src/render/AnnotationLayer.js
// Renders dimension lines, text, coordinate labels, etc. as Three.js objects.
import * as THREE from 'three'

export class AnnotationLayer {
  constructor(scene) {
    this.scene = scene
    this._objects = []
  }

  clear() {
    for (const obj of this._objects) {
      this.scene.remove(obj)
      if (obj.material && obj.material.map) obj.material.map.dispose()
      if (obj.material) obj.material.dispose()
      if (obj.geometry) obj.geometry.dispose()
    }
    this._objects = []
  }

  addDimension(p1, p2, labelPos, value) {
    // Draw dimension line
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(p1.x, p1.y, 2), new THREE.Vector3(p2.x, p2.y, 2)
    ])
    const mat = new THREE.LineBasicMaterial({ color: 0xc2410c })
    const line = new THREE.Line(geo, mat)
    this.scene.add(line)
    this._objects.push(line)

    // Draw label as sprite
    const text = value.toFixed(2) + ' mm'
    const sprite = this._makeTextSprite(text, labelPos.x, labelPos.y)
    this.scene.add(sprite)
    this._objects.push(sprite)
  }

  _makeTextSprite(text, x, y) {
    const canvas = document.createElement('canvas')
    canvas.width = 256; canvas.height = 64
    const ctx = canvas.getContext('2d')
    ctx.font = '28px Arial'
    ctx.fillStyle = '#fff'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.strokeStyle = '#222'
    ctx.lineWidth = 6
    ctx.strokeText(text, 128, 32)
    ctx.fillText(text, 128, 32)
    const tex = new THREE.CanvasTexture(canvas)
    const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false })
    const sprite = new THREE.Sprite(mat)
    sprite.position.set(x, y, 3)
    sprite.scale.set(40, 10, 1)
    return sprite
  }
}
