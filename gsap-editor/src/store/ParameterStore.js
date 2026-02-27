// src/store/ParameterStore.js

import { ParameterType, isValidJavaIdentifier } from '../parameters/ParameterTypes.js'

let _paramIdCounter = 0

export class ParameterStore {
  constructor() {
    this._parameters = []
    this._pointExpressions = {}
    this._edgeServiceMap = {}
    this._trimDefinition = {
      trimBottomService: 'E1',
      trimLeftService: 'E7',
    }
    this._shapeMetadata = {
      className: 'ShapeTransformer_100',
      shapeNumber: '100',
      packageName: 'com.core.shape.transformer.impl',
    }
    this._version = 0
    this._listeners = []
  }

  get version() { return this._version }

  onChange(fn) {
    this._listeners.push(fn)
    return () => { this._listeners = this._listeners.filter(l => l !== fn) }
  }

  _notify() {
    this._version++
    this._listeners.forEach(fn => fn(this._version))
  }

  // --- Parameters ---

  addParameter(name, type, defaultValue, description) {
    if (!isValidJavaIdentifier(name)) {
      throw new Error(`Invalid parameter name: "${name}" — must be a valid Java identifier`)
    }
    if (this._parameters.some(p => p.name === name)) {
      throw new Error(`Duplicate parameter name: "${name}"`)
    }
    if (!Object.values(ParameterType).includes(type)) {
      throw new Error(`Invalid parameter type: "${type}"`)
    }
    const id = `param_${++_paramIdCounter}`
    const param = {
      id,
      name,
      type,
      defaultValue: typeof defaultValue === 'number' ? defaultValue : parseFloat(defaultValue) || 0,
      description: description || '',
      unit: type === ParameterType.ANGLE ? '°' : 'mm',
      expression: type === ParameterType.DERIVED ? '' : null,
    }
    this._parameters.push(param)
    this._notify()
    return id
  }

  updateParameter(id, fields) {
    const idx = this._parameters.findIndex(p => p.id === id)
    if (idx === -1) throw new Error(`Parameter not found: ${id}`)

    const current = this._parameters[idx]

    if (fields.name !== undefined && fields.name !== current.name) {
      if (!isValidJavaIdentifier(fields.name)) {
        throw new Error(`Invalid parameter name: "${fields.name}"`)
      }
      if (this._parameters.some(p => p.id !== id && p.name === fields.name)) {
        throw new Error(`Duplicate parameter name: "${fields.name}"`)
      }
      const oldName = current.name
      const newName = fields.name
      this._renameInExpressions(oldName, newName)
    }

    Object.assign(this._parameters[idx], fields)
    this._notify()
  }

  removeParameter(id) {
    const param = this._parameters.find(p => p.id === id)
    if (!param) return

    const refs = this._findReferences(param.name)
    if (refs.length > 0) {
      throw new Error(
        `Cannot remove "${param.name}" — referenced in: ${refs.join(', ')}`
      )
    }

    this._parameters = this._parameters.filter(p => p.id !== id)
    this._notify()
  }

  getParameters() {
    return this._parameters.map(p => ({ ...p }))
  }

  getParameterByName(name) {
    const p = this._parameters.find(par => par.name === name)
    return p ? { ...p } : null
  }

  reorderParameters(fromIndex, toIndex) {
    if (fromIndex < 0 || fromIndex >= this._parameters.length) return
    if (toIndex < 0 || toIndex >= this._parameters.length) return
    const [item] = this._parameters.splice(fromIndex, 1)
    this._parameters.splice(toIndex, 0, item)
    this._notify()
  }

  // --- Point Expressions ---

  setPointExpression(pointId, xExpression, yExpression) {
    this._pointExpressions[pointId] = {
      x: xExpression || '',
      y: yExpression || '',
    }
    this._notify()
  }

  getPointExpression(pointId) {
    return this._pointExpressions[pointId]
      ? { ...this._pointExpressions[pointId] }
      : null
  }

  getAllPointExpressions() {
    const result = {}
    for (const [k, v] of Object.entries(this._pointExpressions)) {
      result[k] = { ...v }
    }
    return result
  }

  removePointExpression(pointId) {
    delete this._pointExpressions[pointId]
    this._notify()
  }

  // --- Edge Services ---

  setEdgeService(edgeId, serviceLabel) {
    if (serviceLabel === null || serviceLabel === 'None') {
      delete this._edgeServiceMap[edgeId]
    } else {
      this._edgeServiceMap[edgeId] = serviceLabel
    }
    this._notify()
  }

  getEdgeService(edgeId) {
    return this._edgeServiceMap[edgeId] || null
  }

  getAllEdgeServices() {
    return { ...this._edgeServiceMap }
  }

  // --- Trim ---

  setTrimDefinition(trimBottomService, trimLeftService) {
    this._trimDefinition = { trimBottomService, trimLeftService }
    this._notify()
  }

  getTrimDefinition() {
    return { ...this._trimDefinition }
  }

  // --- Shape Metadata ---

  setShapeMetadata(fields) {
    Object.assign(this._shapeMetadata, fields)
    this._notify()
  }

  getShapeMetadata() {
    return { ...this._shapeMetadata }
  }

  // --- Export ---

  getExportPayload() {
    return {
      parameters: this._parameters.map(p => ({
        name: p.name,
        type: p.type,
        defaultValue: p.defaultValue,
        description: p.description,
        ...(p.type === ParameterType.DERIVED && p.expression
          ? { expression: p.expression }
          : {}),
      })),
      pointExpressions: this.getAllPointExpressions(),
      edgeServices: this.getAllEdgeServices(),
      shapeMetadata: {
        ...this._shapeMetadata,
        ...this._trimDefinition,
      },
    }
  }

  // --- Clear ---

  clear() {
    this._parameters = []
    this._pointExpressions = {}
    this._edgeServiceMap = {}
    this._trimDefinition = { trimBottomService: 'E1', trimLeftService: 'E7' }
    this._shapeMetadata = {
      className: 'ShapeTransformer_100',
      shapeNumber: '100',
      packageName: 'com.core.shape.transformer.impl',
    }
    this._notify()
  }

  // --- Internal helpers ---

  _findReferences(paramName) {
    const refs = []
    const regex = new RegExp(`\\b${paramName}\\b`)

    for (const [pointId, expr] of Object.entries(this._pointExpressions)) {
      if (regex.test(expr.x) || regex.test(expr.y)) {
        refs.push(`${pointId}.x/y`)
      }
    }

    for (const p of this._parameters) {
      if (p.type === ParameterType.DERIVED && p.expression && regex.test(p.expression)) {
        refs.push(`derived:${p.name}`)
      }
    }

    return refs
  }

  _renameInExpressions(oldName, newName) {
    const regex = new RegExp(`\\b${oldName}\\b`, 'g')

    for (const pointId of Object.keys(this._pointExpressions)) {
      const expr = this._pointExpressions[pointId]
      expr.x = expr.x.replace(regex, newName)
      expr.y = expr.y.replace(regex, newName)
    }

    for (const p of this._parameters) {
      if (p.type === ParameterType.DERIVED && p.expression) {
        p.expression = p.expression.replace(regex, newName)
      }
    }
  }
}
