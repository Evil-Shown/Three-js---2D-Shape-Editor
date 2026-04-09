// src/tools/SketchTool.js
// Unified line + arc continuous drawing tool.
// Default: click points to create line segments (like LineTool).
// Press 'A' mid-draw → next segment becomes a 3-point arc (click bulge point, then endpoint).
// Press 'L' mid-draw → back to line mode.
// Visual indicator shows whether next segment will be line or arc.
// Double-click or Escape finishes the path.
// This eliminates constant tool switching between Line and Arc.

import * as THREE from 'three'
import { CAD } from '../theme/cadTheme.js'
import { bus } from '../core/EventBus.js'

const MODE_LINE = 'line'
const MODE_ARC  = 'arc'

export class SketchTool {
  constructor(deps) {
    this.scene      = deps.scene
    this.store      = deps.store
    this.coord      = deps.coord
    this.snap       = deps.snap
    this.constraint = deps.constraint
    this.history    = deps.history
    this.canvas     = deps.canvas
    this._meshMap   = deps.meshMap
    this.preview    = deps.previewLayer

    // Drawing state
    this._points   = []       // confirmed vertices
    this._segMode  = MODE_LINE // current segment mode
    this._active   = false
    this._arcMid   = null     // middle point for arc (3-point arc)
    this._arcPhase = 0        // 0 = waiting for mid, 1 = waiting for end

    this._handleClick = this._handleClick.bind(this)
    this._handleMove  = this._handleMove.bind(this)
    this._handleDbl   = this._handleDblClick.bind(this)
    this._handleKey   = this._handleKey.bind(this)
  }

  get toolName() { return 'sketch' }

  activate() {
    this._active = true
    this._points = []
    this._segMode = MODE_LINE
    this._arcMid = null
    this._arcPhase = 0
    this.canvas.style.cursor = 'crosshair'
    this.canvas.addEventListener('click', this._handleClick)
    this.canvas.addEventListener('mousemove', this._handleMove)
    this.canvas.addEventListener('dblclick', this._handleDbl)
    window.addEventListener('keydown', this._handleKey)
    bus.emit('toolStatus', this._statusMsg())
  }

  deactivate() {
    this._active = false
    this._points = []
    this._arcMid = null
    this._arcPhase = 0
    this.snap.setDrawOrigin(null)
    this.snap.setPathFirstPoint(null)
    this.canvas.style.cursor = 'default'
    this.canvas.removeEventListener('click', this._handleClick)
    this.canvas.removeEventListener('mousemove', this._handleMove)
    this.canvas.removeEventListener('dblclick', this._handleDbl)
    window.removeEventListener('keydown', this._handleKey)
    if (this.preview) this.preview.clear()
  }

  cancel() {
    this._points = []
    this._arcMid = null
    this._arcPhase = 0
    this._segMode = MODE_LINE
    this.snap.setDrawOrigin(null)
    this.snap.setPathFirstPoint(null)
    this.constraint.clearAll()
    if (this.preview) this.preview.clear()
    bus.emit('toolStatus', this._statusMsg())
  }

  acceptPoint(p) {
    this._placePoint(this.coord.roundPoint(p))
  }

  /* ── Key handler for mode toggle ── */

  _handleKey(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return

    const key = e.key.toLowerCase()

    // Toggle segment mode while drawing
    if (key === 'a' && !e.ctrlKey && !e.metaKey && this._points.length > 0) {
      e.preventDefault()
      e.stopPropagation()
      this._segMode = MODE_ARC
      this._arcMid = null
      this._arcPhase = 0
      bus.emit('toolStatus', this._statusMsg())
      return
    }

    if (key === 'l' && !e.ctrlKey && !e.metaKey && this._points.length > 0) {
      e.preventDefault()
      e.stopPropagation()
      this._segMode = MODE_LINE
      this._arcMid = null
      this._arcPhase = 0
      bus.emit('toolStatus', this._statusMsg())
      return
    }
  }

  /* ── Click handler ── */

  _handleClick(e) {
    if (e.detail >= 2) return
    const raw = this.coord.screenToWorld(e.clientX, e.clientY)
    const mods = { shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey }
    let snapped = this.snap.snap(raw, mods)

    if (this._points.length > 0) {
      const origin = this._points[this._points.length - 1]
      snapped = this.constraint.apply(origin, snapped)
    }

    this._placePoint(this.coord.roundPoint(snapped))
  }

  _placePoint(p) {
    // First point — always just store it
    if (this._points.length === 0) {
      this._points.push(p)
      this.snap.setDrawOrigin(p)
      this.snap.setPathFirstPoint(p)  // for close-path snapping
      this.coord.setRelativeOrigin(p)
      bus.emit('toolStatus', this._statusMsg())
      return
    }

    const prev = this._points[this._points.length - 1]

    // Check if closing the path
    const first = this._points[0]
    const distToFirst = Math.hypot(p.x - first.x, p.y - first.y)
    const isClosing = this._points.length >= 2 && distToFirst < (this.coord.snapWorldThreshold() * 1.5)
    const closePoint = isClosing ? { x: first.x, y: first.y } : p

    if (this._segMode === MODE_LINE) {
      // ─── LINE SEGMENT ───
      const target = closePoint
      const len = Math.hypot(target.x - prev.x, target.y - prev.y)
      if (len < 0.01) return

      this._commitLine(prev, target)

      if (isClosing) {
        this._finishPath()
        bus.emit('geometryChanged')
        bus.emit('toolStatus', 'SKETCH: Shape closed! Click start point for new path')
      } else {
        this._points.push(p)
        this.snap.setDrawOrigin(p)
        this.coord.setRelativeOrigin(p)
        this.constraint.clearAll()
        bus.emit('geometryChanged')
        bus.emit('toolStatus', this._statusMsg())
      }

    } else if (this._segMode === MODE_ARC) {
      // ─── ARC SEGMENT (3-point) ───
      if (this._arcPhase === 0) {
        // Picking the arc's pass-through (middle) point
        this._arcMid = p
        this._arcPhase = 1
        bus.emit('toolStatus', 'SKETCH [ARC]: Click arc endpoint')
        return
      }

      if (this._arcPhase === 1) {
        // Picking the arc endpoint — compute arc and commit
        const arcEnd = isClosing ? closePoint : p
        const arcData = this._arcFrom3Pts(prev, this._arcMid, arcEnd)
        if (arcData) {
          this._commitArc(arcData)
          if (isClosing) {
            this._finishPath()
            this._arcMid = null
            this._arcPhase = 0
            this._segMode = MODE_LINE
            bus.emit('geometryChanged')
            bus.emit('toolStatus', 'SKETCH: Shape closed! Click start point for new path')
            return
          }
          this._points.push(p)
          this.snap.setDrawOrigin(p)
          this.coord.setRelativeOrigin(p)
        } else {
          // Collinear — fall back to line
          const target = isClosing ? closePoint : p
          const len = Math.hypot(target.x - prev.x, target.y - prev.y)
          if (len >= 0.01) {
            this._commitLine(prev, target)
            if (isClosing) {
              this._finishPath()
              this._arcMid = null
              this._arcPhase = 0
              this._segMode = MODE_LINE
              bus.emit('geometryChanged')
              bus.emit('toolStatus', 'SKETCH: Shape closed! Click start point for new path')
              return
            }
            this._points.push(p)
            this.snap.setDrawOrigin(p)
            this.coord.setRelativeOrigin(p)
          }
        }
        this._arcMid = null
        this._arcPhase = 0
        this._segMode = MODE_LINE  // auto-revert to line after one arc
        this.constraint.clearAll()
        bus.emit('geometryChanged')
        bus.emit('toolStatus', this._statusMsg())
      }
    }
  }

  /* ── Mouse move — preview ── */

  _handleMove(e) {
    if (!this._active || !this.preview) return
    const raw = this.coord.screenToWorld(e.clientX, e.clientY)
    const mods = { shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey }
    let snapped = this.snap.snap(raw, mods)

    if (this._points.length > 0) {
      const origin = this._points[this._points.length - 1]
      snapped = this.constraint.apply(origin, snapped)
    }

    this.preview.clear()

    if (this._points.length === 0) {
      this.preview.showSnapIndicator(this.snap.activeSnap)
      return
    }

    const origin = this._points[this._points.length - 1]

    if (this._segMode === MODE_LINE) {
      // Preview line segment
      this.preview.showLine(origin, snapped, 0x00ff88, 0.7)

      // Length & angle info
      const len = Math.hypot(snapped.x - origin.x, snapped.y - origin.y)
      const ang = Math.atan2(snapped.y - origin.y, snapped.x - origin.x) * 180 / Math.PI
      bus.emit('toolInfo', { length: len.toFixed(2), angle: ang.toFixed(1), mode: 'LINE' })

    } else if (this._segMode === MODE_ARC) {
      if (this._arcPhase === 0) {
        // Before picking mid-point: show a hint line + curve indicator
        this.preview.showLine(origin, snapped, 0xff8844, 0.5)
        // Show arc mode indicator — dashed feel via a small arc preview
        const mid = { x: (origin.x + snapped.x) / 2, y: (origin.y + snapped.y) / 2 }
        const dx = snapped.x - origin.x, dy = snapped.y - origin.y
        const perpX = -dy * 0.15, perpY = dx * 0.15
        const bulge = { x: mid.x + perpX, y: mid.y + perpY }
        const hint = this._arcFrom3Pts(origin, bulge, snapped)
        if (hint) {
          this.preview.showArc(hint.center, hint.radius, hint.startAngle, hint.endAngle, hint.clockwise, 0xff8844, 0.3)
        }
        bus.emit('toolInfo', { mode: 'ARC — click bulge point' })

      } else if (this._arcPhase === 1 && this._arcMid) {
        // Preview arc through 3 points
        const arc = this._arcFrom3Pts(origin, this._arcMid, snapped)
        if (arc) {
          this.preview.showArc(arc.center, arc.radius, arc.startAngle, arc.endAngle, arc.clockwise, 0xff8844, 0.7)
        } else {
          // Collinear fallback — show line
          this.preview.showLine(origin, snapped, 0xff8844, 0.6)
        }
        bus.emit('toolInfo', { mode: 'ARC — click endpoint' })
      }
    }

    // Check for close-path snap
    if (this.snap.activeSnap && this.snap.activeSnap.type === 'ClosePath') {
      bus.emit('toolStatus', 'SKETCH: Click to CLOSE SHAPE')
    }

    // Mode badge — show a colored dot in preview
    this._showModeBadge(snapped)
    this.preview.showSnapIndicator(this.snap.activeSnap)
  }

  /* ── Finish path (close or double-click) ── */

  _finishPath() {
    this._points = []
    this._arcMid = null
    this._arcPhase = 0
    this._segMode = MODE_LINE
    this.snap.setDrawOrigin(null)
    this.snap.setPathFirstPoint(null)
    this.constraint.clearAll()
    if (this.preview) this.preview.clear()
  }

  /* ── Double-click finishes path ── */

  _handleDblClick() {
    this._finishPath()
    bus.emit('toolStatus', this._statusMsg())
  }

  /* ── Commit helpers ── */

  _commitLine(start, end) {
    const s = { x: start.x, y: start.y }
    const e = { x: end.x, y: end.y }
    const store = this.store
    const scene = this.scene
    const meshMap = this._meshMap

    this.history.execute({
      label: 'Sketch Line',
      _id: null,
      execute() {
        this._id = store.addEdge({ type: 'line', start: { ...s }, end: { ...e } })
        if (this._id) {
          const geo = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(s.x, s.y, 0), new THREE.Vector3(e.x, e.y, 0)
          ])
          const mat = new THREE.LineBasicMaterial({ color: CAD.edge })
          const line = new THREE.Line(geo, mat)
          line.userData.edgeId = this._id
          scene.add(line)
          meshMap.set(this._id, line)
        }
      },
      undo() {
        if (!this._id) return
        store.removeEdge(this._id)
        const mesh = meshMap.get(this._id)
        if (mesh) { scene.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose(); meshMap.delete(this._id) }
      }
    })
  }

  _commitArc(arcData) {
    const { center, radius, startAngle, endAngle, clockwise } = arcData
    const c = { x: center.x, y: center.y }
    const store = this.store
    const scene = this.scene
    const meshMap = this._meshMap

    this.history.execute({
      label: 'Sketch Arc',
      _id: null,
      execute() {
        this._id = store.addEdge({
          type: 'arc', center: { ...c }, radius, startAngle, endAngle, clockwise
        })
        if (this._id) {
          const curve = new THREE.EllipseCurve(c.x, c.y, radius, radius, startAngle, endAngle, clockwise, 0)
          const pts = curve.getPoints(64)
          const geo = new THREE.BufferGeometry().setFromPoints(pts)
          const mat = new THREE.LineBasicMaterial({ color: CAD.edge })
          const line = new THREE.Line(geo, mat)
          line.userData.edgeId = this._id
          scene.add(line)
          meshMap.set(this._id, line)
        }
      },
      undo() {
        if (!this._id) return
        store.removeEdge(this._id)
        const mesh = meshMap.get(this._id)
        if (mesh) { scene.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose(); meshMap.delete(this._id) }
      }
    })
  }

  /* ── Arc from 3 points (same as ArcTool) ── */

  _arcFrom3Pts(p1, p2, p3) {
    const ax = (p1.x + p2.x) / 2, ay = (p1.y + p2.y) / 2
    const bx = (p2.x + p3.x) / 2, by = (p2.y + p3.y) / 2
    const d1x = -(p2.y - p1.y), d1y = p2.x - p1.x
    const d2x = -(p3.y - p2.y), d2y = p3.x - p2.x

    const det = d1x * d2y - d1y * d2x
    if (Math.abs(det) < 1e-8) return null  // collinear

    const t = ((bx - ax) * d2y - (by - ay) * d2x) / det
    const cx = ax + t * d1x
    const cy = ay + t * d1y
    const radius = Math.hypot(p1.x - cx, p1.y - cy)

    const a1 = Math.atan2(p1.y - cy, p1.x - cx)
    const a3 = Math.atan2(p3.y - cy, p3.x - cx)

    const cross = (p2.x - p1.x) * (p3.y - p1.y) - (p2.y - p1.y) * (p3.x - p1.x)
    const clockwise = cross < 0

    return { center: { x: cx, y: cy }, radius, startAngle: a1, endAngle: a3, clockwise }
  }

  /* ── Mode badge near cursor ── */

  _showModeBadge(pos) {
    if (!this.preview) return
    const offset = this.preview._indicatorSize ? this.preview._indicatorSize() * 1.5 : 6
    const badgePos = { x: pos.x + offset, y: pos.y + offset }

    if (this._segMode === MODE_ARC) {
      // Small arc symbol near cursor
      const r = offset * 0.6
      this.preview.showArc(badgePos, r, 0, Math.PI, false, 0xff8844, 0.9)
    }
    // For line mode — no extra badge (the crosshair is enough)
  }

  /* ── Status message ── */

  _statusMsg() {
    if (this._points.length === 0) {
      return 'SKETCH: Click start point (press A for arc, L for line mid-draw)'
    }
    const mode = this._segMode === MODE_ARC ? 'ARC' : 'LINE'
    if (this._segMode === MODE_ARC && this._arcPhase === 0) {
      return `SKETCH [${mode}]: Click arc bulge point (L → line)`
    }
    if (this._segMode === MODE_ARC && this._arcPhase === 1) {
      return `SKETCH [${mode}]: Click arc endpoint (L → line)`
    }
    return `SKETCH [${mode}]: Click next point (A → arc, Dbl-click/Esc to finish)`
  }
}
