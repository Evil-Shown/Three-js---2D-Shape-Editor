// src/tools/PointTagger.js
//
// FIX: Removed duplicated (and broken) evaluation logic that hardcoded
// trimLeft = 0 / trimBottom = 0. All status checking now delegates to
// ExpressionBuilder.evaluateAll() which correctly seeds these from p0.

import * as THREE from 'three'
import { bus } from '../core/EventBus.js'
import { POINT_STATUS, POINT_STATUS_COLORS } from '../parameters/ParameterTypes.js'
import { ExpressionBuilder } from '../parameters/ExpressionBuilder.js'

export class PointTagger {
  constructor(deps) {
    this.scene       = deps.scene
    this.store       = deps.store         // GeometryStore
    this.coord       = deps.coord
    this.canvas      = deps.canvas
    this.paramStore  = deps.paramStore
    this.preview     = deps.previewLayer

    this._active          = false
    this._hoveredPointId  = null
    this._pointOverlays   = []
    this._builder         = new ExpressionBuilder()

    // Cache the last evaluateAll result so we don't recompute per-point
    this._evalCache       = null
    this._evalCacheVersion = -1

    this._handleMove  = this._handleMove.bind(this)
    this._handleClick = this._handleClick.bind(this)
  }

  get toolName() { return 'pointTagger' }

  activate() {
    this._active = true
    this.canvas.style.cursor = 'pointer'
    this.canvas.addEventListener('mousemove', this._handleMove)
    this.canvas.addEventListener('click', this._handleClick)
    this._renderPointIndicators()
    bus.emit('toolStatus', 'POINT TAGGER — click a point to assign expressions, or use Auto-Assign in the panel')
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
    bus.emit('toolStatus', 'POINT TAGGER — click a point to assign expressions')
  }

  getShapePoints() {
    return this._builder.extractShapePoints(this.store)
  }

  /**
   * Returns the verification status for a single point.
   * Delegates entirely to evaluateAll() so trimLeft/trimBottom are correct.
   */
  getPointStatus(pointId) {
    const expr = this.paramStore.getPointExpression(pointId)
    if (!expr || (!expr.x.trim() && !expr.y.trim())) {
      return POINT_STATUS.UNSET
    }

    // Quick syntax check before expensive evaluation
    const vx = this._builder.validate(expr.x, this.paramStore)
    const vy = this._builder.validate(expr.y, this.paramStore)
    if (!vx.isValid || !vy.isValid) {
      return POINT_STATUS.ERROR
    }

    const evalResult = this._getCachedEval()
    const hasError = evalResult.summary.errors.some(e => e.pointId === pointId)

    if (hasError) return POINT_STATUS.ERROR
    if (evalResult.computedPoints[pointId] !== undefined) return POINT_STATUS.VERIFIED
    return POINT_STATUS.ASSIGNED
  }

  refreshIndicators() {
    if (this._active) {
      this._evalCacheVersion = -1 // Invalidate cache
      this._renderPointIndicators()
    }
  }

  // ── Private ────────────────────────────────────────────────────────────────

  /**
   * Cache evaluateAll() results keyed by store version.
   * Avoids re-evaluating every point on every mouse pixel.
   */
  _getCachedEval() {
    const storeVersion = this.store.version + this.paramStore.version
    if (storeVersion !== this._evalCacheVersion) {
      try {
        this._evalCache = this._builder.evaluateAll(this.paramStore, this.store)
      } catch {
        this._evalCache = { computedPoints: {}, summary: { errors: [], total: 0, assigned: 0, verified: 0 } }
      }
      this._evalCacheVersion = storeVersion
    }
    return this._evalCache
  }

  _handleMove(e) {
    if (!this._active) return
    const world = this.coord.screenToWorld(e.clientX, e.clientY)
    const threshold = this.coord.pixelSize() * 14
    const points = this.getShapePoints()

    let closest = null
    let minDist = threshold

    for (const pt of points) {
      const d = Math.hypot(world.x - pt.x, world.y - pt.y)
      if (d < minDist) { minDist = d; closest = pt }
    }

    if (closest && closest.id !== this._hoveredPointId) {
      this._hoveredPointId = closest.id
      this._renderPointIndicators()
      const expr = this.paramStore.getPointExpression(closest.id)
      const status = this.getPointStatus(closest.id)
      bus.emit('toolStatus', expr
        ? `${closest.id} [${status}] x=${expr.x}  y=${expr.y}`
        : `${closest.id} at (${closest.x.toFixed(1)}, ${closest.y.toFixed(1)}) — no expression yet`)
    } else if (!closest && this._hoveredPointId) {
      this._hoveredPointId = null
      this._renderPointIndicators()
      bus.emit('toolStatus', 'POINT TAGGER — hover a point to inspect, click to edit')
    }
  }

  _handleClick(e) {
    if (!this._active) return
    const world = this.coord.screenToWorld(e.clientX, e.clientY)
    const threshold = this.coord.pixelSize() * 14
    const points = this.getShapePoints()

    let closest = null
    let minDist = threshold

    for (const pt of points) {
      const d = Math.hypot(world.x - pt.x, world.y - pt.y)
      if (d < minDist) { minDist = d; closest = pt }
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
    if (points.length === 0) return

    const pixSize = this.coord.pixelSize()
    // Compute all statuses in one batch to use the cache
    this._getCachedEval()

    for (const pt of points) {
      const status   = this.getPointStatus(pt.id)
      const color    = POINT_STATUS_COLORS[status]
      const isHovered = pt.id === this._hoveredPointId
      const r        = pixSize * (isHovered ? 10 : 7)
      const isFilled = status === POINT_STATUS.VERIFIED || status === POINT_STATUS.ERROR

      this._drawPointCircle(pt.x, pt.y, r, color, isFilled, isHovered)
      this._drawPointLabel(pt.x, pt.y, pt.id, r, color)
    }
  }

  _drawPointCircle(x, y, radius, color, filled, hovered) {
    const segments = 32
    const pts = []
    for (let i = 0; i <= segments; i++) {
      const a = (i / segments) * Math.PI * 2
      pts.push(new THREE.Vector3(x + radius * Math.cos(a), y + radius * Math.sin(a), 3))
    }

    const geo = new THREE.BufferGeometry().setFromPoints(pts)
    const mat = new THREE.LineBasicMaterial({
      color: new THREE.Color(color),
      linewidth: hovered ? 3 : 2,
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
      const fillGeo  = new THREE.ShapeGeometry(shape)
      const fillMat  = new THREE.MeshBasicMaterial({
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
    const canvas  = document.createElement('canvas')
    const ctx     = canvas.getContext('2d')
    canvas.width  = 72
    canvas.height = 32

    // Background pill for readability
    ctx.fillStyle = 'rgba(0,0,0,0.55)'
    ctx.beginPath()
    ctx.roundRect(2, 2, 68, 28, 6)
    ctx.fill()

    ctx.fillStyle = color
    ctx.font = 'bold 20px monospace'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(label, 36, 16)

    const texture   = new THREE.CanvasTexture(canvas)
    const spriteMat = new THREE.SpriteMaterial({ map: texture, transparent: true })
    const sprite    = new THREE.Sprite(spriteMat)
    const scale     = this.coord.pixelSize() * 32
    sprite.scale.set(scale, scale * 0.45, 1)
    sprite.position.set(x, y + offset * 2.0, 4)
    this.scene.add(sprite)
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
  }
}