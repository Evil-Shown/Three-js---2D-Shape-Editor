import React, { useState, useEffect, useCallback, useRef } from 'react'
import { ParameterType, PARAM_TYPE_META, SERVICE_LABELS, SERVICE_COLORS, POINT_STATUS_COLORS } from '../parameters/ParameterTypes.js'
import ParameterRow from './ParameterRow.jsx'
import ExpressionInput from './ExpressionInput.jsx'
import { ExpressionBuilder } from '../parameters/ExpressionBuilder.js'
import { ExpressionValidator } from '../parameters/ExpressionValidator.js'
import { bus } from '../core/EventBus.js'

export default function ParameterPanel({
  paramStore,
  geometryStore,
  pointTagger,
  edgeTagger,
  onGenerate,
}) {
  const [, forceUpdate] = useState(0)
  const [addingParam, setAddingParam] = useState(false)
  const [newParam, setNewParam] = useState({ name: '', type: 'LINEAR', defaultValue: 0, description: '' })
  const [validationResult, setValidationResult] = useState(null)
  const [activeSection, setActiveSection] = useState('params')
  const [focusedParamName, setFocusedParamName] = useState(null)
  const [selectedPointId, setSelectedPointId] = useState(null)
  const [pointExprX, setPointExprX] = useState('')
  const [pointExprY, setPointExprY] = useState('')

  const builderRef = useRef(new ExpressionBuilder())
  const validatorRef = useRef(new ExpressionValidator())

  useEffect(() => {
    const unsub = paramStore.onChange(() => forceUpdate(n => n + 1))
    return unsub
  }, [paramStore])

  const params = paramStore.getParameters()
  const shapePoints = pointTagger ? pointTagger.getShapePoints() : []
  const pointExprs = paramStore.getAllPointExpressions()
  const edgeServices = paramStore.getAllEdgeServices()
  const edges = geometryStore.getEdges()
  const meta = paramStore.getShapeMetadata()
  const trim = paramStore.getTrimDefinition()

  // --- Point selection from canvas ---
  useEffect(() => {
    const handlePointSelect = (data) => {
      setSelectedPointId(data.pointId)
      setActiveSection('points')
      const expr = paramStore.getPointExpression(data.pointId)
      setPointExprX(expr?.x || '')
      setPointExprY(expr?.y || '')
    }
    const unsub = bus.on('pointTagger:selectPoint', handlePointSelect)
    return () => unsub()
  }, [paramStore])

  // --- Parameter CRUD ---
  const handleAddParam = () => {
    try {
      paramStore.addParameter(
        newParam.name, newParam.type,
        parseFloat(newParam.defaultValue) || 0,
        newParam.description
      )
      setNewParam({ name: '', type: 'LINEAR', defaultValue: 0, description: '' })
      setAddingParam(false)
    } catch (e) {
      alert(e.message)
    }
  }

  const handleUpdateParam = (id, fields) => {
    paramStore.updateParameter(id, fields)
  }

  const handleDeleteParam = (id) => {
    try {
      paramStore.removeParameter(id)
    } catch (e) {
      alert(e.message)
    }
  }

  const isParamReferenced = (name) => {
    const allExprs = paramStore.getAllPointExpressions()
    const regex = new RegExp(`\\b${name}\\b`)
    for (const expr of Object.values(allExprs)) {
      if (regex.test(expr.x) || regex.test(expr.y)) return true
    }
    for (const p of params) {
      if (p.type === ParameterType.DERIVED && p.expression && regex.test(p.expression)) return true
    }
    return false
  }

  const getParamUsagePoints = (name) => {
    const usage = new Set()
    const regex = new RegExp(`\\b${name}\\b`)
    for (const [ptId, expr] of Object.entries(pointExprs)) {
      if ((expr.x && regex.test(expr.x)) || (expr.y && regex.test(expr.y))) {
        usage.add(ptId)
      }
    }
    return Array.from(usage)
  }

  // --- Point expression save ---
  const savePointExpression = useCallback(() => {
    if (!selectedPointId) return
    paramStore.setPointExpression(selectedPointId, pointExprX, pointExprY)
    if (pointTagger) pointTagger.refreshIndicators()
  }, [selectedPointId, pointExprX, pointExprY, paramStore, pointTagger])

  const selectPoint = (ptId) => {
    setSelectedPointId(ptId)
    const expr = paramStore.getPointExpression(ptId)
    setPointExprX(expr?.x || '')
    setPointExprY(expr?.y || '')
  }

  // --- Validation ---
  const runValidation = () => {
    const result = validatorRef.current.validate(paramStore, geometryStore)
    setValidationResult(result)
    return result
  }

  const handleGenerate = () => {
    const result = runValidation()
    if (result.isValid) {
      onGenerate?.()
    }
  }

  // --- Expression validation helper ---
  const validateExpr = (expr) => {
    if (!expr.trim()) return null
    const result = builderRef.current.validate(expr, paramStore)
    return result.isValid
  }

  const isP0 = selectedPointId === 'p0'

  return (
    <div style={panelStyle}>
      {/* Section Tabs */}
      <div style={tabBarStyle}>
        {['params', 'points', 'services', 'meta'].map(s => (
          <button
            key={s}
            style={{
              ...tabBtnStyle,
              ...(activeSection === s ? tabBtnActiveStyle : {}),
            }}
            onClick={() => setActiveSection(s)}
          >
            {s === 'params' ? 'Parameters' : s === 'points' ? 'Points' : s === 'services' ? 'Services' : 'Metadata'}
          </button>
        ))}
      </div>

      <div style={sectionBodyStyle}>

        {/* ======================== PARAMETERS SECTION ======================== */}
        {activeSection === 'params' && (
          <div>
            <div style={sectionHeaderStyle}>
              <span>Parameters ({params.length})</span>
              <button style={addBtnStyle} onClick={() => setAddingParam(true)}>+ Add</button>
            </div>

            {params.map((p) => {
              const usagePoints = getParamUsagePoints(p.name)
              const usageLabel = usagePoints.length
                ? `Used in: ${usagePoints.join(', ')}`
                : 'Not used in any point yet'
              const isFocused = focusedParamName === p.name
              return (
              <ParameterRow
                  key={p.id}
                  param={p}
                  onUpdate={handleUpdateParam}
                  onDelete={handleDeleteParam}
                  isReferenced={isParamReferenced(p.name)}
                  referenceInfo={usageLabel}
                  usageLabel={usageLabel}
                  focused={isFocused}
                  onFocus={() =>
                    setFocusedParamName(prev => (prev === p.name ? null : p.name))
                  }
                />
              )
            })}

            {addingParam && (
              <div style={addFormStyle}>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  <input
                    style={addInputStyle}
                    value={newParam.name}
                    onChange={e => setNewParam(p => ({ ...p, name: e.target.value }))}
                    placeholder="Name (e.g. L, R1)"
                    autoFocus
                    onKeyDown={e => {
                      if (e.key === 'Enter') handleAddParam()
                      if (e.key === 'Escape') setAddingParam(false)
                    }}
                  />
                  <select
                    style={{ ...addInputStyle, width: 80 }}
                    value={newParam.type}
                    onChange={e => setNewParam(p => ({ ...p, type: e.target.value }))}
                  >
                    {Object.values(ParameterType).filter(t => t !== 'OFFSET').map(t => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                  <input
                    style={{ ...addInputStyle, width: 56 }}
                    type="number"
                    value={newParam.defaultValue}
                    onChange={e => setNewParam(p => ({ ...p, defaultValue: e.target.value }))}
                    placeholder="Value"
                    onKeyDown={e => {
                      if (e.key === 'Enter') handleAddParam()
                      if (e.key === 'Escape') setAddingParam(false)
                    }}
                  />
                  <input
                    style={{ ...addInputStyle, flex: 1, minWidth: 60 }}
                    value={newParam.description}
                    onChange={e => setNewParam(p => ({ ...p, description: e.target.value }))}
                    placeholder="Description"
                    onKeyDown={e => {
                      if (e.key === 'Enter') handleAddParam()
                      if (e.key === 'Escape') setAddingParam(false)
                    }}
                  />
                </div>
                <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
                  <button style={confirmBtnStyle} onClick={handleAddParam}>Add</button>
                  <button style={cancelBtnStyle} onClick={() => setAddingParam(false)}>Cancel</button>
                </div>
              </div>
            )}

            {params.length === 0 && !addingParam && (
              <div style={emptyStateStyle}>
                No parameters defined yet. Click "+ Add" to define shape dimensions.
              </div>
            )}
          </div>
        )}

        {/* ======================== POINTS SECTION ======================== */}
        {activeSection === 'points' && (
          <div>
            <div style={sectionHeaderStyle}>
              <span>
                Point Expressions ({Object.keys(pointExprs).length}/{shapePoints.length})
                {focusedParamName && (
                  <span style={{ color: '#cccc44', fontSize: 11, marginLeft: 8 }}>
                    highlighting usage of <span style={{ color: '#ffdd66' }}>{focusedParamName}</span>
                  </span>
                )}
              </span>
              <button style={addBtnStyle} onClick={runValidation}>Verify All</button>
            </div>

            {/* Point list */}
            <div style={{ maxHeight: 200, overflowY: 'auto', marginBottom: 8 }}>
              {shapePoints.map(pt => {
                const status = pointTagger ? pointTagger.getPointStatus(pt.id) : 'unset'
                const statusColor = POINT_STATUS_COLORS[status] || '#666'
                const expr = pointExprs[pt.id]
                const isSelected = pt.id === selectedPointId
                const isUsingFocusedParam =
                  focusedParamName &&
                  (() => {
                    if (!expr) return false
                    const rx = new RegExp(`\\b${focusedParamName}\\b`)
                    return (expr.x && rx.test(expr.x)) || (expr.y && rx.test(expr.y))
                  })()

                return (
                  <div
                    key={pt.id}
                    style={{
                      ...pointRowStyle,
                      borderColor: isSelected
                        ? '#7fffd4'
                        : isUsingFocusedParam
                          ? '#cccc44'
                          : '#2a2d30',
                      background: isSelected
                        ? '#1a2e28'
                        : isUsingFocusedParam
                          ? '#252820'
                          : '#1e2124',
                    }}
                    onClick={() => selectPoint(pt.id)}
                  >
                    <span style={{
                      width: 8, height: 8, borderRadius: '50%',
                      background: statusColor,
                      display: 'inline-block', marginRight: 6, flexShrink: 0,
                    }} />
                    <span style={{ color: '#7fffd4', fontFamily: 'monospace', fontWeight: 700, fontSize: 12, minWidth: 24 }}>
                      {pt.id}
                    </span>
                    <span style={{ color: '#666', fontSize: 11, marginLeft: 4 }}>
                      ({pt.x.toFixed(1)}, {pt.y.toFixed(1)})
                    </span>
                    {expr && (
                      <span style={{ color: '#888', fontSize: 10, fontFamily: 'monospace', marginLeft: 'auto', textAlign: 'right', maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {expr.x}, {expr.y}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Expression editor for selected point */}
            {selectedPointId && (
              <div style={expressionEditorStyle}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#7fffd4', marginBottom: 6 }}>
                  {selectedPointId}
                  {(() => {
                    const sp = shapePoints.find(p => p.id === selectedPointId)
                    return sp ? (
                      <span style={{ color: '#666', fontWeight: 400, fontSize: 11, marginLeft: 8 }}>
                        drawn at ({sp.x.toFixed(2)}, {sp.y.toFixed(2)})
                      </span>
                    ) : null
                  })()}
                </div>

                {isP0 ? (
                  <div style={{ color: '#ff8844', fontSize: 12, padding: '8px 0' }}>
                    p0 is always the trim origin: x = trimLeft, y = trimBottom (auto-assigned)
                  </div>
                ) : (
                  <>
                    <ExpressionInput
                      label="X Expression"
                      value={pointExprX}
                      onChange={(v) => setPointExprX(v)}
                      onValidate={validateExpr}
                      placeholder="e.g. p0.x + L"
                    />
                    <ExpressionInput
                      label="Y Expression"
                      value={pointExprY}
                      onChange={(v) => setPointExprY(v)}
                      onValidate={validateExpr}
                      placeholder="e.g. p0.y + R1"
                    />
                    <button
                      style={{ ...confirmBtnStyle, width: '100%', marginTop: 6 }}
                      onClick={savePointExpression}
                    >
                      Save Expression
                    </button>
                  </>
                )}
              </div>
            )}

            {shapePoints.length === 0 && (
              <div style={emptyStateStyle}>
                No shape points detected. Draw a closed shape in Draw Mode first.
              </div>
            )}
          </div>
        )}

        {/* ======================== SERVICES SECTION ======================== */}
        {activeSection === 'services' && (
          <div>
            <div style={sectionHeaderStyle}>
              <span>Edge Services ({Object.keys(edgeServices).length}/{edges.length})</span>
            </div>

            <div style={{ maxHeight: 240, overflowY: 'auto', marginBottom: 8 }}>
              {edges.map((edge, idx) => {
                const svc = edgeServices[edge.id] || null
                const svcColor = svc ? SERVICE_COLORS[svc] : '#666'
                const len = edge.type === 'line'
                  ? Math.hypot(edge.end.x - edge.start.x, edge.end.y - edge.start.y)
                  : edge.radius * Math.abs(edge.endAngle - edge.startAngle)

                return (
                  <div key={edge.id} style={edgeRowStyle}>
                    <span style={{ color: svcColor, fontWeight: 700, fontSize: 12, minWidth: 22 }}>
                      {svc || '—'}
                    </span>
                    <span style={{ color: '#aaa', fontSize: 12, minWidth: 50 }}>
                      {edge.id}
                    </span>
                    <span style={{
                      fontSize: 11, color: edge.type === 'arc' ? '#ff88cc' : '#88aaff',
                      minWidth: 30,
                    }}>
                      {edge.type === 'arc' ? '◠ arc' : '╱ line'}
                    </span>
                    <span style={{ color: '#666', fontSize: 11, marginLeft: 'auto' }}>
                      {len.toFixed(1)}mm
                    </span>
                    <select
                      style={serviceSelectStyle}
                      value={svc || ''}
                      onChange={(e) => {
                        const val = e.target.value || null
                        if (edgeTagger) {
                          edgeTagger.tagEdge(edge.id, val)
                        } else {
                          paramStore.setEdgeService(edge.id, val)
                        }
                      }}
                    >
                      <option value="">None</option>
                      {SERVICE_LABELS.map(l => (
                        <option key={l} value={l}>{l}</option>
                      ))}
                    </select>
                  </div>
                )
              })}
            </div>

            {/* Trim definition */}
            <div style={{ ...sectionHeaderStyle, marginTop: 8 }}>Trim Definition</div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>Trim Bottom</label>
                <select
                  style={{ ...serviceSelectStyle, width: '100%' }}
                  value={trim.trimBottomService}
                  onChange={(e) => paramStore.setTrimDefinition(e.target.value, trim.trimLeftService)}
                >
                  {SERVICE_LABELS.map(l => <option key={l} value={l}>{l}</option>)}
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>Trim Left</label>
                <select
                  style={{ ...serviceSelectStyle, width: '100%' }}
                  value={trim.trimLeftService}
                  onChange={(e) => paramStore.setTrimDefinition(trim.trimBottomService, e.target.value)}
                >
                  {SERVICE_LABELS.map(l => <option key={l} value={l}>{l}</option>)}
                </select>
              </div>
            </div>
          </div>
        )}

        {/* ======================== METADATA SECTION ======================== */}
        {activeSection === 'meta' && (
          <div>
            <div style={sectionHeaderStyle}>Shape Metadata</div>
            <div style={{ marginBottom: 8 }}>
              <label style={labelStyle}>Class Name</label>
              <input
                style={metaInputStyle}
                value={meta.className}
                onChange={(e) => paramStore.setShapeMetadata({ className: e.target.value })}
                placeholder="ShapeTransformer_139"
              />
            </div>
            <div style={{ marginBottom: 8 }}>
              <label style={labelStyle}>Shape Number</label>
              <input
                style={metaInputStyle}
                value={meta.shapeNumber}
                onChange={(e) => paramStore.setShapeMetadata({ shapeNumber: e.target.value })}
                placeholder="139"
              />
            </div>
            <div style={{ marginBottom: 8 }}>
              <label style={labelStyle}>Package Name</label>
              <input
                style={metaInputStyle}
                value={meta.packageName}
                onChange={(e) => paramStore.setShapeMetadata({ packageName: e.target.value })}
                placeholder="com.core.shape.transformer.impl"
              />
            </div>
          </div>
        )}
      </div>

      {/* ======================== BOTTOM BAR ======================== */}
      <div style={bottomBarStyle}>
        {validationResult && (
          <div style={{
            padding: '6px 8px', marginBottom: 6, borderRadius: 4,
            background: validationResult.isValid ? '#1a2e1a' : '#2e1a1a',
            border: `1px solid ${validationResult.isValid ? '#44cc66' : '#ff4444'}`,
            fontSize: 11, maxHeight: 120, overflowY: 'auto',
          }}>
            <div style={{ fontWeight: 700, color: validationResult.isValid ? '#44cc66' : '#ff4444', marginBottom: 4 }}>
              {validationResult.isValid ? '✓ Validation Passed' : `✗ ${validationResult.errors.length} Error(s)`}
            </div>
            {validationResult.errors.map((e, i) => (
              <div key={i} style={{ color: '#ff8888', fontSize: 10, marginBottom: 2 }}>• {e.message}</div>
            ))}
            {validationResult.warnings.map((w, i) => (
              <div key={i} style={{ color: '#cccc44', fontSize: 10, marginBottom: 2 }}>⚠ {w.message}</div>
            ))}
            <div style={{ color: '#888', fontSize: 10, marginTop: 4 }}>
              Points: {validationResult.summary.assignedPoints}/{validationResult.summary.totalPoints} |
              Params: {validationResult.summary.totalParameters} |
              Services: {validationResult.summary.assignedServices}/{validationResult.summary.totalEdges}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 6 }}>
          <button style={validateBtnStyle} onClick={runValidation}>
            Validate
          </button>
          <button
            style={{
              ...generateBtnStyle,
              opacity: (validationResult && validationResult.isValid) ? 1 : 0.4,
              cursor: (validationResult && validationResult.isValid) ? 'pointer' : 'not-allowed',
            }}
            onClick={handleGenerate}
            disabled={!validationResult || !validationResult.isValid}
          >
            Generate
          </button>
        </div>
      </div>
    </div>
  )
}

// --- Styles ---

const panelStyle = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  overflow: 'hidden',
}

const tabBarStyle = {
  display: 'flex',
  borderBottom: '1px solid #2a2d30',
  marginBottom: 8,
  gap: 0,
}

const tabBtnStyle = {
  flex: 1,
  padding: '6px 4px',
  background: 'transparent',
  border: 'none',
  borderBottom: '2px solid transparent',
  color: '#888',
  fontSize: 11,
  fontWeight: 600,
  cursor: 'pointer',
  transition: 'all 0.15s',
}

const tabBtnActiveStyle = {
  color: '#7fffd4',
  borderBottomColor: '#7fffd4',
}

const sectionBodyStyle = {
  flex: 1,
  overflowY: 'auto',
  paddingBottom: 8,
}

const sectionHeaderStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  color: '#7fffd4',
  fontWeight: 600,
  fontSize: 12,
  marginBottom: 8,
  paddingBottom: 4,
  borderBottom: '1px solid #2a2d30',
  letterSpacing: 0.5,
}

const addBtnStyle = {
  padding: '2px 10px',
  background: '#1a3328',
  border: '1px solid #7fffd4',
  borderRadius: 4,
  color: '#7fffd4',
  fontSize: 11,
  fontWeight: 600,
  cursor: 'pointer',
}

const addFormStyle = {
  padding: 8,
  background: '#252830',
  borderRadius: 6,
  border: '1px solid #3a3d42',
  marginBottom: 4,
}

const addInputStyle = {
  padding: '4px 6px',
  background: '#1a1c1e',
  border: '1px solid #3a3d42',
  borderRadius: 3,
  color: '#e0e3e6',
  fontSize: 12,
  outline: 'none',
  width: 60,
}

const confirmBtnStyle = {
  padding: '4px 12px',
  background: '#1a3328',
  border: '1px solid #44cc66',
  borderRadius: 4,
  color: '#44cc66',
  fontSize: 11,
  fontWeight: 600,
  cursor: 'pointer',
}

const cancelBtnStyle = {
  padding: '4px 12px',
  background: '#2e1a1a',
  border: '1px solid #ff4444',
  borderRadius: 4,
  color: '#ff4444',
  fontSize: 11,
  fontWeight: 600,
  cursor: 'pointer',
}

const pointRowStyle = {
  display: 'flex',
  alignItems: 'center',
  padding: '5px 8px',
  borderRadius: 4,
  border: '1px solid #2a2d30',
  marginBottom: 2,
  cursor: 'pointer',
  transition: 'all 0.1s',
  gap: 4,
}

const expressionEditorStyle = {
  padding: 10,
  background: '#252830',
  borderRadius: 6,
  border: '1px solid #3a3d42',
}

const edgeRowStyle = {
  display: 'flex',
  alignItems: 'center',
  padding: '5px 8px',
  borderRadius: 4,
  border: '1px solid #2a2d30',
  marginBottom: 2,
  gap: 6,
}

const serviceSelectStyle = {
  padding: '2px 4px',
  background: '#252830',
  border: '1px solid #3a3d42',
  borderRadius: 3,
  color: '#e0e3e6',
  fontSize: 11,
  outline: 'none',
}

const labelStyle = {
  fontSize: 11,
  color: '#888',
  fontWeight: 600,
  display: 'block',
  marginBottom: 2,
}

const metaInputStyle = {
  width: '100%',
  padding: '5px 8px',
  background: '#252830',
  border: '1px solid #3a3d42',
  borderRadius: 4,
  color: '#e0e3e6',
  fontSize: 12,
  fontFamily: 'monospace',
  outline: 'none',
  boxSizing: 'border-box',
}

const bottomBarStyle = {
  borderTop: '1px solid #2a2d30',
  padding: '8px 0 0 0',
  flexShrink: 0,
}

const validateBtnStyle = {
  flex: 1,
  padding: '7px 12px',
  background: '#252830',
  border: '1px solid #3a3d42',
  borderRadius: 4,
  color: '#aaa',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
}

const generateBtnStyle = {
  flex: 1,
  padding: '7px 12px',
  background: '#1a3328',
  border: '1px solid #7fffd4',
  borderRadius: 4,
  color: '#7fffd4',
  fontSize: 12,
  fontWeight: 700,
  cursor: 'pointer',
}

const emptyStateStyle = {
  padding: '16px 12px',
  color: '#666',
  fontSize: 12,
  textAlign: 'center',
  lineHeight: 1.6,
  background: '#1a1c1e',
  borderRadius: 6,
  border: '1px dashed #2a2d30',
}
