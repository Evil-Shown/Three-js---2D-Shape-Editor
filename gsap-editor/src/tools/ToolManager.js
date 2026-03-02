// src/tools/ToolManager.js
// Central manager — handles tool switching, keyboard shortcuts, and
// provides a uniform interface for the Editor component.

import { bus } from '../core/EventBus.js'

const TOOL_SHORTCUTS = {
  'k': 'sketch',
  'l': 'line',
  'a': 'arc',
  'r': 'rectangle',
  'g': 'roundedRect',
  'c': 'circle',
  's': 'select',
  'm': 'move',
  't': 'trim',
  'o': 'offset',
  'd': 'dimension',
  'q': 'measure'
}

export class ToolManager {
  /**
   * @param {Object} deps  — shared dependencies injected once
   * @param {Object} deps.scene
   * @param {Object} deps.store
   * @param {Object} deps.coord
   * @param {Object} deps.snap
   * @param {Object} deps.constraint
   * @param {Object} deps.history
   * @param {Object} deps.canvas
   * @param {Map}    deps.meshMap
   * @param {Object} deps.previewLayer
   * @param {Object} deps.annotationLayer
   */
  constructor(deps) {
    this.deps = deps
    this._tools = new Map()
    this._active = null
    this._activeName = null

    this._onKeyDown = this._onKeyDown.bind(this)
    window.addEventListener('keydown', this._onKeyDown)
  }

  /** Register a tool class instance under a name */
  register(name, tool) {
    this._tools.set(name, tool)
  }

  /** Switch active tool */
  setActive(name) {
    if (this._active) {
      this._active.deactivate()
    }
    this.deps.constraint.clearAll()
    this.deps.snap.setDrawOrigin(null)

    this._activeName = name
    this._active = this._tools.get(name) || null
    if (this._active) {
      this._active.activate()
    }
    bus.emit('toolChanged', { name: this._activeName })
  }

  get activeName() { return this._activeName }
  get activeTool() { return this._active }

  /** Cancel current operation — Escape */
  cancel() {
    if (this._active && this._active.cancel) {
      this._active.cancel()
    }
    this.deps.constraint.clearAll()
    this.deps.snap.setDrawOrigin(null)
    bus.emit('toolChanged', { name: this._activeName })
  }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown)
    if (this._active) this._active.deactivate()
  }

  /* ── private ── */

  _onKeyDown(e) {
    // Don't intercept when typing in inputs
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return

    const key = e.key.toLowerCase()

    // Escape → cancel current op then switch to select
    if (key === 'escape') {
      e.preventDefault()
      this.cancel()
      this.setActive('select')
      return
    }

    // Delete → forward to select tool
    if (key === 'delete' || key === 'backspace') {
      if (this._activeName === 'select' && this._active && this._active.deleteSelected) {
        e.preventDefault()
        this._active.deleteSelected()
      }
      return
    }

    // Ctrl+Z / Ctrl+Y
    if ((e.ctrlKey || e.metaKey) && key === 'z') {
      e.preventDefault()
      this.deps.history.undo()
      bus.emit('geometryChanged')
      return
    }
    if ((e.ctrlKey || e.metaKey) && key === 'y') {
      e.preventDefault()
      this.deps.history.redo()
      bus.emit('geometryChanged')
      return
    }

    // Ctrl+A — select all
    if ((e.ctrlKey || e.metaKey) && key === 'a') {
      e.preventDefault()
      if (this._activeName === 'select' && this._active && this._active.selectAll) {
        this._active.selectAll()
      } else {
        this.setActive('select')
        setTimeout(() => this._active && this._active.selectAll && this._active.selectAll(), 0)
      }
      return
    }

    // F → zoom to fit
    if (key === 'f' && !e.ctrlKey && !e.metaKey) {
      e.preventDefault()
      bus.emit('zoomToFit')
      return
    }

    // +/- zoom
    if (key === '+' || key === '=') { e.preventDefault(); this.deps.coord.zoomBy(1.25); return }
    if (key === '-') { e.preventDefault(); this.deps.coord.zoomBy(0.8); return }

    // Space → toggle snap
    if (key === ' ') {
      e.preventDefault()
      this._toggleAllSnaps()
      return
    }

    // When sketch tool is mid-draw, let it handle 'a' and 'l' internally
    if (this._activeName === 'sketch' && this._active && this._active._points && this._active._points.length > 0) {
      if (key === 'a' || key === 'l') return  // SketchTool's _handleKey already handled it
    }

    // Tool shortcuts (only single lowercase letters not handled above)
    if (TOOL_SHORTCUTS[key] && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault()
      this.setActive(TOOL_SHORTCUTS[key])
    }
  }

  _toggleAllSnaps() {
    const snap = this.deps.snap
    const allOn = Object.values(snap.enabled).every(Boolean)
    for (const k of Object.keys(snap.enabled)) snap.enabled[k] = !allOn
    bus.emit('snapSettingsChanged', { ...snap.enabled })
  }
}
