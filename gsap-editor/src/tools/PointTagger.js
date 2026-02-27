// src/tools/PointTagger.js

import * as THREE from 'three'
import { bus } from '../core/EventBus.js'
import { POINT_STATUS, POINT_STATUS_COLORS } from '../parameters/ParameterTypes.js'
import { ExpressionBuilder } from '../parameters/ExpressionBuilder.js'

export class PointTagger {
  constructor(deps) {
    this.scene = deps.scene
    this.store = deps.store
    this.coord = deps.coord
    this.canvas = deps.canvas
    this.paramStore = deps.paramStore
    this.preview = deps.previewLayer

    this._active = false
    this._hoveredPointId = null
    this._pointOverlays = []
    this._labelOverlays = []
    this._builder = new ExpressionBuilder()

    this._handleMove = this._handleMove.bind(this)
    this._handleClick = this._handleClick.bind(this)
  }

  get toolName() { return 'pointTagger' }

  activate() {
    this._active = true
    this.canvas.style.cursor = 'pointer'
    this.canvas.addEventListener('mousemove', this._handleMove)
    this.canvas.addEventListener('click', this._handleClick)
    this._renderPointIndicators()
    bus.emit('toolStatus', 'POINT TAGGER: Click a point to assign parameter expressions')
  }

  deactivate() {
    this._active = false
    this.canvas.style.cursor = 'default'
    this.canvas.removeEventListener('mousemove', this._handleMove)
    this.canvas.removeEventListener('click', this._handleClick)
    this._clearOverlays()
  }

  cancel() {
    this._hoveredPointId = null
    bus.emit('toolStatus', 'POINT TAGGER: Click a point to assign parameter expressions')
  }

  getShapePoints() {
    return this._builder.extractShapePoints(this.store)
  }

  getPointStatus(pointId) {
    const expr = this.paramStore.getPointExpression(pointId)
    if (!expr || (!expr.x.trim() && !expr.y.trim())) {
      return POINT_STATUS.UNSET
    }

    const vx = this._builder.validate(expr.x, this.paramStore)
    const vy = this._builder.validate(expr.y, this.paramStore)
    if (!vx.isValid || !vy.isValid) {
      return POINT_STATUS.ERROR
    }

    const params = this.paramStore.getParameters()
    const paramValues = {}
    for (const p of params) paramValues[p.name] = p.defaultValue
    paramValues.trimLeft = 0
    paramValues.trimBottom = 0

    const allExprs = this.paramStore.getAllPointExpressions()
    const computed = {}
    const points = this.getShapePoints()

    for (const pt of points) {
      const pe = allExprs[pt.id]
      if (!pe) continue
      try {
        const xv = this._builder.evaluate(pe.x, paramValues, computed)
        const yv = this._builder.evaluate(pe.y, paramValues, computed)
        computed[pt.id] = { x: xv, y: yv }
      } catch {
        if (pt.id === pointId) return POINT_STATUS.ERROR
      }
    }

    const shapePoint = points.find(p => p.id === pointId)
    const computedPt = computed[pointId]
    if (!shapePoint || !computedPt) return POINT_STATUS.ASSIGNED

    const dx = Math.abs(computedPt.x - shapePoint.x)
    const dy = Math.abs(computedPt.y - shapePoint.y)
    if (dx < 0.1 && dy < 0.1) return POINT_STATUS.VERIFIED

    return POINT_STATUS.ERROR
  }

  refreshIndicators() {
    if (this._active) {
      this._renderPointIndicators()
    }
  }

  _handleMove(e) {
    if (!this._active) return
    const world = this.coord.screenToWorld(e.clientX, e.clientY)
    const threshold = this.coord.pixelSize() * 12
    const points = this.getShapePoints()

    let closest = null
    let minDist = threshold

    for (const pt of points) {
      const d = Math.hypot(world.x - pt.x, world.y - pt.y)
      if (d < minDist) {
        minDist = d
        closest = pt
      }
    }

    if (closest && closest.id !== this._hoveredPointId) {
      this._hoveredPointId = closest.id
      this._renderPointIndicators()
      const expr = this.paramStore.getPointExpression(closest.id)
      const status = this.getPointStatus(closest.id)
      bus.emit('toolStatus', expr
        ? `${closest.id} (${status}): x=${expr.x}, y=${expr.y}`
        : `${closest.id}: no expression — click to assign`)
    } else if (!closest && this._hoveredPointId) {
      this._hoveredPointId = null
      this._renderPointIndicators()
      bus.emit('toolStatus', 'POINT TAGGER: Click a point to assign parameter expressions')
    }
  }

  _handleClick(e) {
    if (!this._active) return
    const world = this.coord.screenToWorld(e.clientX, e.clientY)
    const threshold = this.coord.pixelSize() * 12
    const points = this.getShapePoints()

    let closest = null
    let minDist = threshold

    for (const pt of points) {
      const d = Math.hypot(world.x - pt.x, world.y - pt.y)
      if (d < minDist) {
        minDist = d
        closest = pt
      }
    }

    if (closest) {
      bus.emit('pointTagger:selectPoint', {
        pointId: closest.id,
        x: closest.x,
        y: closest.y,
        screenX: e.clientX,
        screenY: e.clientY,
      })
    }
  }

  _renderPointIndicators() {
    this._clearOverlays()
    const points = this.getShapePoints()
    const pixSize = this.coord.pixelSize()

    for (const pt of points) {
      const status = this.getPointStatus(pt.id)
      const color = POINT_STATUS_COLORS[status]
      const isHovered = pt.id === this._hoveredPointId
      const r = pixSize * (isHovered ? 10 : 7)
      const isFilled = status === POINT_STATUS.VERIFIED || status === POINT_STATUS.ERROR

      this._drawPointCircle(pt.x, pt.y, r, color, isFilled)
      this._drawPointLabel(pt.x, pt.y, pt.id, r, color)
    }
  }

  _drawPointCircle(x, y, radius, color, filled) {
    const segments = 32
    const pts = []
    for (let i = 0; i <= segments; i++) {
      const a = (i / segments) * Math.PI * 2
      pts.push(new THREE.Vector3(x + radius * Math.cos(a), y + radius * Math.sin(a), 3))
    }

    const geo = new THREE.BufferGeometry().setFromPoints(pts)
    const mat = new THREE.LineBasicMaterial({
      color: new THREE.Color(color),
      linewidth: 2,
    })
    const line = new THREE.Line(geo, mat)
    this.scene.add(line)
    this._pointOverlays.push(line)

    if (filled) {
      const shape = new THREE.Shape()
      for (let i = 0; i <= segments; i++) {
        const a = (i / segments) * Math.PI * 2
        const px = radius * Math.cos(a)
        const py = radius * Math.sin(a)
        if (i === 0) shape.moveTo(px, py)
        else shape.lineTo(px, py)
      }
      const fillGeo = new THREE.ShapeGeometry(shape)
      const fillMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(color),
        transparent: true,
        opacity: 0.3,
      })
      const mesh = new THREE.Mesh(fillGeo, fillMat)
      mesh.position.set(x, y, 2.9)
      this.scene.add(mesh)
      this._pointOverlays.push(mesh)
    }
  }

  _drawPointLabel(x, y, label, offset, color) {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    canvas.width = 64
    canvas.height = 32
    ctx.fillStyle = color
    ctx.font = 'bold 20px monospace'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(label, 32, 16)

    const texture = new THREE.CanvasTexture(canvas)
    const spriteMat = new THREE.SpriteMaterial({ map: texture, transparent: true })
    const sprite = new THREE.Sprite(spriteMat)
    const scale = this.coord.pixelSize() * 30
    sprite.scale.set(scale, scale * 0.5, 1)
    sprite.position.set(x, y + offset * 1.8, 4)
    this.scene.add(sprite)
    this._labelOverlays.push(sprite)
    this._pointOverlays.push(sprite)
  }

  _clearOverlays() {
    for (const obj of this._pointOverlays) {
      this.scene.remove(obj)
      if (obj.geometry) obj.geometry.dispose()
      if (obj.material) {
        if (obj.material.map) obj.material.map.dispose()
        obj.material.dispose()
      }
    }
    this._pointOverlays = []
    this._labelOverlays = []
  }
}
