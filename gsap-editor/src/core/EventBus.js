// src/core/EventBus.js
// Lightweight pub/sub — every engine layer uses this to communicate
// without direct coupling.

export class EventBus {
  constructor() {
    this._listeners = new Map()
  }

  on(event, fn) {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set())
    }
    this._listeners.get(event).add(fn)
    return () => this.off(event, fn)
  }

  off(event, fn) {
    const set = this._listeners.get(event)
    if (set) set.delete(fn)
  }

  emit(event, data) {
    const set = this._listeners.get(event)
    if (!set) return
    for (const fn of set) {
      try { fn(data) } catch (e) { console.error(`EventBus [${event}]:`, e) }
    }
  }

  clear() {
    this._listeners.clear()
  }
}

// Singleton shared across all layers
export const bus = new EventBus()
