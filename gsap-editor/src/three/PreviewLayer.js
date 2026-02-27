// src/three/PreviewLayer.js
// Z=1 layer — all temporary in-progress drawing:
// preview lines, preview arcs, snap indicators, cursor crosshair.
// Indicator sizes scale with zoom so they appear constant on screen.

import * as THREE from 'three'
import { SNAP } from '../snap/SnapEngine.js'

export class PreviewLayer {
  constructor(scene, coordEngine) {
    this.scene = scene
    this.coord = coordEngine || null
    this._objects = []
  }

  _indicatorSize() {
    if (!this.coord) return 4
    return this.coord.pixelSize() * 8
  }

  clear() {
    for (const obj of this._objects) {
      this.scene.remove(obj)
      if (obj.geometry) obj.geometry.dispose()
      if (obj.material) obj.material.dispose()
    }
    this._objects = []
  }

  showLine(start, end, color = 0x00ff88, opacity = 0.7) {
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(start.x, start.y, 1),
      new THREE.Vector3(end.x, end.y, 1)
    ])
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity })
    const line = new THREE.Line(geo, mat)
    this.scene.add(line)
    this._objects.push(line)
    return line
  }

  showArc(center, radius, startAngle, endAngle, clockwise, color = 0x00ff88, opacity = 0.7) {
    if (radius < 0.01) return
    const curve = new THREE.EllipseCurve(
      center.x, center.y, radius, radius,
      startAngle, endAngle, clockwise, 0
    )
    const pts = curve.getPoints(64)
    const pts3 = pts.map(p => new THREE.Vector3(p.x, p.y, 1))
    const geo = new THREE.BufferGeometry().setFromPoints(pts3)
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity })
    const line = new THREE.Line(geo, mat)
    this.scene.add(line)
    this._objects.push(line)
    return line
  }

  showSnapIndicator(snapInfo) {
    if (!snapInfo || !snapInfo.point || snapInfo.type === SNAP.NONE) return

    const { point, type, color } = snapInfo
    const s = this._indicatorSize()

    switch (type) {
      case SNAP.ENDPOINT:      this._drawSquare(point, color, s); break
      case SNAP.MIDPOINT:      this._drawTriangle(point, color, s); break
      case SNAP.CENTER:        this._drawCross(point, color, s); break
      case SNAP.INTERSECTION:  this._drawX(point, color, s); break
      case SNAP.PERPENDICULAR: this._drawRightAngle(point, color, s); break
      case SNAP.TANGENT:       this._drawCircle(point, color, s); break
      case SNAP.ANGLE:         this._drawDiamond(point, color, s); break
      case SNAP.GRID:          this._drawDot(point, color, s); break
    }
  }

  showCrossHair(world, bounds) {
    if (!world) return
    this.showLine(
      { x: bounds.left, y: world.y },
      { x: bounds.right, y: world.y },
      0x335566, 0.25
    )
    this.showLine(
      { x: world.x, y: bounds.bottom },
      { x: world.x, y: bounds.top },
      0x335566, 0.25
    )
  }

  _drawSquare(p, color, s) {
    const h = s * 0.5
    const pts = [
      new THREE.Vector3(p.x - h, p.y - h, 2),
      new THREE.Vector3(p.x + h, p.y - h, 2),
      new THREE.Vector3(p.x + h, p.y + h, 2),
      new THREE.Vector3(p.x - h, p.y + h, 2),
      new THREE.Vector3(p.x - h, p.y - h, 2)
    ]
    this._addShape(pts, color)
  }

  _drawTriangle(p, color, s) {
    const h = s * 0.6
    const pts = [
      new THREE.Vector3(p.x, p.y + h, 2),
      new THREE.Vector3(p.x - h, p.y - h * 0.5, 2),
      new THREE.Vector3(p.x + h, p.y - h * 0.5, 2),
      new THREE.Vector3(p.x, p.y + h, 2)
    ]
    this._addShape(pts, color)
  }

  _drawCross(p, color, s) {
    const h = s * 0.5
    this._addLine2(p.x - h, p.y, p.x + h, p.y, color)
    this._addLine2(p.x, p.y - h, p.x, p.y + h, color)
  }

  _drawX(p, color, s) {
    const h = s * 0.5
    this._addLine2(p.x - h, p.y - h, p.x + h, p.y + h, color)
    this._addLine2(p.x - h, p.y + h, p.x + h, p.y - h, color)
  }

  _drawRightAngle(p, color, s) {
    const h = s * 0.5
    const pts = [
      new THREE.Vector3(p.x, p.y + h, 2),
      new THREE.Vector3(p.x, p.y, 2),
      new THREE.Vector3(p.x + h, p.y, 2)
    ]
    this._addShape(pts, color)
  }

  _drawCircle(p, color, s) {
    const r = s * 0.5
    const pts = []
    for (let i = 0; i <= 32; i++) {
      const a = (i / 32) * Math.PI * 2
      pts.push(new THREE.Vector3(p.x + r * Math.cos(a), p.y + r * Math.sin(a), 2))
    }
    this._addShape(pts, color)
  }

  _drawDiamond(p, color, s) {
    const h = s * 0.5
    const pts = [
      new THREE.Vector3(p.x, p.y + h, 2),
      new THREE.Vector3(p.x + h, p.y, 2),
      new THREE.Vector3(p.x, p.y - h, 2),
      new THREE.Vector3(p.x - h, p.y, 2),
      new THREE.Vector3(p.x, p.y + h, 2)
    ]
    this._addShape(pts, color)
  }

  _drawDot(p, color, s) {
    const r = s * 0.3
    const pts = []
    for (let i = 0; i <= 16; i++) {
      const a = (i / 16) * Math.PI * 2
      pts.push(new THREE.Vector3(p.x + r * Math.cos(a), p.y + r * Math.sin(a), 2))
    }
    this._addShape(pts, color)
  }

  _addShape(pts, color) {
    const geo = new THREE.BufferGeometry().setFromPoints(pts)
    const mat = new THREE.LineBasicMaterial({ color })
    const line = new THREE.Line(geo, mat)
    this.scene.add(line)
    this._objects.push(line)
  }

  _addLine2(x1, y1, x2, y2, color) {
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(x1, y1, 2), new THREE.Vector3(x2, y2, 2)
    ])
    const mat = new THREE.LineBasicMaterial({ color })
    const line = new THREE.Line(geo, mat)
    this.scene.add(line)
    this._objects.push(line)
  }
}
