// src/core/CommandHistory.js
// Undo / Redo — every geometry mutation is a reversible command.

import { bus } from './EventBus.js'

export class CommandHistory {
  constructor() {
    this._undoStack = []
    this._redoStack = []
    this._maxSize   = 200
  }

  /** Execute and record a command. command = { execute(), undo(), label } */
  execute(command) {
    command.execute()
    this._undoStack.push(command)
    if (this._undoStack.length > this._maxSize) this._undoStack.shift()
    this._redoStack = []
    this._notify()
  }

  undo() {
    const cmd = this._undoStack.pop()
    if (!cmd) return
    cmd.undo()
    this._redoStack.push(cmd)
    this._notify()
  }

  redo() {
    const cmd = this._redoStack.pop()
    if (!cmd) return
    cmd.execute()
    this._undoStack.push(cmd)
    this._notify()
  }

  get canUndo() { return this._undoStack.length > 0 }
  get canRedo() { return this._redoStack.length > 0 }

  clear() {
    this._undoStack = []
    this._redoStack = []
    this._notify()
  }

  _notify() {
    bus.emit('historyChanged', {
      canUndo: this.canUndo,
      canRedo: this.canRedo,
      undoLabel: this.canUndo ? this._undoStack[this._undoStack.length - 1].label : '',
      redoLabel: this.canRedo ? this._redoStack[this._redoStack.length - 1].label : ''
    })
  }
}
