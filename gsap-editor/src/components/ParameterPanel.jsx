// src/components/ParameterPanel.jsx
//
// Right panel with tabs: Parameters, Points (delegated to PointAssignmentPanel),
// Services, and Metadata. Includes validation and generation controls.

import React, { useState, useEffect, useRef, useMemo } from 'react'
import {
  ParameterType, PARAM_TYPE_META,
  SERVICE_LABELS, SERVICE_COLORS,
} from '../parameters/ParameterTypes.js'
import ParameterRow from './ParameterRow.jsx'
import PointAssignmentPanel from './PointAssignmentPanel.jsx'
import { ExpressionBuilder } from '../parameters/ExpressionBuilder.js'
import { ExpressionValidator } from '../parameters/ExpressionValidator.js'
import { AutoAssignService } from '../parameters/AutoAssignService.js'
import { bus } from '../core/EventBus.js'
import { ui } from '../theme/uiTheme.js'

export default function ParameterPanel({
  paramStore,
  geometryStore,
  pointTagger,
  edgeTagger,
  onGenerate,
}) {
  const [, forceUpdate]         = useState(0)
  const [addingParam, setAddingParam] = useState(false)
  const [newParam, setNewParam] = useState({ name: '', type: 'LINEAR', defaultValue: 0, description: '' })
  const [validationResult, setValidationResult] = useState(null)
  const [showValidationTips, setShowValidationTips] = useState(true)
  const [activeSection, setActiveSection] = useState('params')
  const [focusedParamName, setFocusedParamName] = useState(null)

  const builderRef   = useRef(new ExpressionBuilder())
  const validatorRef = useRef(new ExpressionValidator())
  const autoRef      = useRef(new AutoAssignService())

  useEffect(() => {
    const unsub = paramStore.onChange(() => forceUpdate(n => n + 1))
    return unsub
  }, [paramStore])

  // Switch to Points tab on canvas point click
  useEffect(() => {
    const handlePointSelect = () => {
      setActiveSection('points')
    }
    const unsub = bus.on('pointTagger:selectPoint', handlePointSelect)
    return () => unsub()
  }, [])

  // Auto-fill missing expressions when Points tab opens
  useEffect(() => {
    if (activeSection !== 'points') return
    const count = autoRef.current.autoAssignMissing(paramStore, geometryStore)
    if (count > 0 && pointTagger) pointTagger.refreshIndicators()
  }, [activeSection, paramStore, geometryStore, pointTagger])

  const shapePoints = useMemo(
    () => builderRef.current.extractShapePoints(geometryStore),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [geometryStore, paramStore.version]
  )

  // ── Derived state ──────────────────────────────────────────────────────────
  const params      = paramStore.getParameters()
  const pointExprs  = paramStore.getAllPointExpressions()
  const edgeServices = paramStore.getAllEdgeServices()
  const edges       = geometryStore.getEdges()
  const meta        = paramStore.getShapeMetadata()
  const trim        = paramStore.getTrimDefinition()

  const verifiedCount = shapePoints.filter(pt => {
    const s = pointTagger ? pointTagger.getPointStatus(pt.id) : 'unset'
    return s === 'verified'
  }).length

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleAddParam = () => {
    try {
      paramStore.addParameter(
        newParam.name, newParam.type,
        parseFloat(newParam.defaultValue) || 0,
        newParam.description
      )
      setNewParam({ name: '', type: 'LINEAR', defaultValue: 0, description: '' })
      setAddingParam(false)
    } catch (e) { alert(e.message) }
  }

  const handleDeleteParam = (id) => {
    try { paramStore.removeParameter(id) } catch (e) { alert(e.message) }
  }

  const isParamReferenced = (name) => {
    const regex = new RegExp(`\\b${name}\\b`)
    for (const expr of Object.values(paramStore.getAllPointExpressions())) {
      if (regex.test(expr.x) || regex.test(expr.y)) return true
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

  const handleAutoAssignAll = () => {
    const stats = autoRef.current.autoAssignAll(paramStore, geometryStore)
    if (pointTagger) pointTagger.refreshIndicators()
    setValidationResult(null)
  }

  const runValidation = () => {
    const result = validatorRef.current.validate(paramStore, geometryStore)
    setValidationResult(result)
    setShowValidationTips(true)
    return result
  }

  const handleGenerate = () => {
    const result = runValidation()
    if (result.isValid) onGenerate?.()
  }

  // One-click: auto-assign everything then generate immediately
  const handleQuickGenerate = () => {
    handleAutoAssignAll()
    setTimeout(() => {
      const result = runValidation()
      if (result.isValid) onGenerate?.()
    }, 100)
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={panelStyle}>

      {/* Tab bar */}
      <div style={tabBarStyle}>
        {[
          { id: 'params',   label: 'Parameters' },
          { id: 'points',   label: `Points ${verifiedCount}/${shapePoints.length}` },
          { id: 'services', label: 'Services' },
          { id: 'meta',     label: 'Metadata' },
        ].map(({ id, label }) => (
          <button
            key={id}
            style={{ ...tabBtnStyle, ...(activeSection === id ? tabBtnActiveStyle : {}) }}
            onClick={() => setActiveSection(id)}
          >
            {label}
          </button>
        ))}
      </div>

      <div style={sectionBodyStyle}>

        {/* ════════════════════════ PARAMETERS ════════════════════════════════ */}
        {activeSection === 'params' && (
          <div>
            <div style={sectionHeaderStyle}>
              <span>Parameters ({params.length})</span>
              <button style={addBtnStyle} onClick={() => setAddingParam(true)}>+ Add</button>
            </div>

            {params.length === 0 && !addingParam && (
              <div style={tipsBoxStyle}>
                <div style={{ fontWeight: 700, color: ui.accent, marginBottom: 6 }}>Getting started</div>
                <div>Add parameters to describe your shape's dimensions:</div>
                <div style={{ marginTop: 4, color: ui.textMuted }}>
                  • <b>L</b> — overall width (LINEAR)<br />
                  • <b>H</b> — overall height (LINEAR)<br />
                  • <b>R1</b> — corner radius (RADIUS)
                </div>
                <div style={{ marginTop: 6, color: ui.textSubtle }}>
                  Then go to the <b>Points</b> tab and click <b>Auto-Assign All</b>.
                </div>
              </div>
            )}

            {params.map((p) => {
              const usagePoints = getParamUsagePoints(p.name)
              const usageLabel = usagePoints.length
                ? `Used in: ${usagePoints.join(', ')}`
                : 'Not used in any point yet'
              return (
                <ParameterRow
                  key={p.id}
                  param={p}
                  onUpdate={(id, fields) => paramStore.updateParameter(id, fields)}
                  onDelete={handleDeleteParam}
                  isReferenced={isParamReferenced(p.name)}
                  referenceInfo={usageLabel}
                  usageLabel={usageLabel}
                  focused={focusedParamName === p.name}
                  onFocus={() =>
                    setFocusedParamName(prev => prev === p.name ? null : p.name)
                  }
                />
              )
            })}

            {addingParam && (
              <div style={addFormStyle}>
                <div style={{ fontSize: 11, color: ui.textMuted, marginBottom: 6 }}>
                  Name must be a valid Java identifier (e.g. L, H, R1, widthLeft)
                </div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  <input
                    style={{ ...addInputStyle, width: 72 }}
                    value={newParam.name}
                    onChange={e => setNewParam(p => ({ ...p, name: e.target.value }))}
                    placeholder="Name"
                    autoFocus
                    onKeyDown={e => {
                      if (e.key === 'Enter') handleAddParam()
                      if (e.key === 'Escape') setAddingParam(false)
                    }}
                  />
                  <select
                    style={{ ...addInputStyle, width: 90 }}
                    value={newParam.type}
                    onChange={e => setNewParam(p => ({ ...p, type: e.target.value }))}
                  >
                    {['LINEAR', 'RADIUS', 'ANGLE', 'DERIVED'].map(t => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                  <input
                    style={{ ...addInputStyle, width: 60 }}
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
                    style={{ ...addInputStyle, flex: 1, minWidth: 80 }}
                    value={newParam.description}
                    onChange={e => setNewParam(p => ({ ...p, description: e.target.value }))}
                    placeholder="Description (optional)"
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
          </div>
        )}

        {/* ════════════════════════ POINTS ══════════════════════════════════════ */}
        {activeSection === 'points' && (
          <PointAssignmentPanel
            paramStore={paramStore}
            geometryStore={geometryStore}
            pointTagger={pointTagger}
            onValidate={runValidation}
          />
        )}

        {/* ════════════════════════ SERVICES ═══════════════════════════════════ */}
        {activeSection === 'services' && (
          <div>
            <div style={sectionHeaderStyle}>
              <span>Edge Services ({Object.keys(edgeServices).length}/{edges.length})</span>
            </div>

            <div style={{ maxHeight: 240, overflowY: 'auto', marginBottom: 8 }}>
              {edges.map((edge) => {
                const svc = edgeServices[edge.id] || null
                const svcColor = svc ? SERVICE_COLORS[svc] : ui.textMuted
                const len = edge.type === 'line'
                  ? Math.hypot(edge.end.x - edge.start.x, edge.end.y - edge.start.y)
                  : edge.radius * Math.abs(edge.endAngle - edge.startAngle)

                return (
                  <div key={edge.id} style={edgeRowStyle}>
                    <span style={{ color: svcColor, fontWeight: 700, fontSize: 12, minWidth: 20 }}>
                      {svc || '—'}
                    </span>
                    <span style={{ color: ui.textMuted, fontSize: 11, minWidth: 44, fontFamily: 'monospace' }}>
                      {edge.id}
                    </span>
                    <span style={{ fontSize: 10, color: edge.type === 'arc' ? '#ff88cc' : '#88aaff' }}>
                      {edge.type === 'arc' ? '◠ arc' : '╱ line'}
                    </span>
                    <span style={{ color: ui.textSubtle, fontSize: 10, marginLeft: 'auto' }}>
                      {len.toFixed(1)}mm
                    </span>
                    <select
                      style={serviceSelectStyle}
                      value={svc || ''}
                      onChange={(e) => {
                        const val = e.target.value || null
                        if (edgeTagger) edgeTagger.tagEdge(edge.id, val)
                        else paramStore.setEdgeService(edge.id, val)
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

            <div style={{ ...sectionHeaderStyle, marginTop: 8 }}>Trim Definition</div>
            <div style={{ display: 'flex', gap: 8 }}>
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

        {/* ════════════════════════ METADATA ═══════════════════════════════════ */}
        {activeSection === 'meta' && (
          <div>
            <div style={sectionHeaderStyle}>Shape Metadata</div>
            {[
              { key: 'className',   label: 'Class Name',    placeholder: 'ShapeTransformer_139' },
              { key: 'shapeNumber', label: 'Shape Number',  placeholder: '139' },
              { key: 'packageName', label: 'Package Name',  placeholder: 'com.core.shape.transformer.impl' },
            ].map(({ key, label, placeholder }) => (
              <div key={key} style={{ marginBottom: 10 }}>
                <label style={labelStyle}>{label}</label>
                <input
                  style={metaInputStyle}
                  value={meta[key]}
                  onChange={(e) => paramStore.setShapeMetadata({ [key]: e.target.value })}
                  placeholder={placeholder}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ════════════════════════ BOTTOM BAR ════════════════════════════════════ */}
      <div style={bottomBarStyle}>
        {validationResult && showValidationTips && (
          <div style={{
            padding: '7px 8px', marginBottom: 6, borderRadius: 8,
            background: validationResult.isValid
              ? (validationResult.warnings.length > 0 ? '#fffbeb' : '#ecfdf5')
              : '#fef2f2',
            border: `1px solid ${validationResult.isValid
              ? (validationResult.warnings.length > 0 ? '#fbbf24' : '#34d399')
              : '#f87171'}`,
            fontSize: 11,
            maxHeight: 'min(140px, 24vh)',
            overflowY: 'auto',
            WebkitOverflowScrolling: 'touch',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <div style={{
                fontWeight: 700,
                color: validationResult.isValid
                  ? (validationResult.warnings.length > 0 ? '#b45309' : '#059669')
                  : '#dc2626',
              }}>
                {validationResult.isValid
                  ? (validationResult.warnings.length > 0
                    ? `✓ Ready to generate  ·  ${validationResult.warnings.length} tip${validationResult.warnings.length > 1 ? 's' : ''}`
                    : '✓ Perfect — ready to generate')
                  : `✗ ${validationResult.errors.length} error${validationResult.errors.length > 1 ? 's' : ''} — fix to continue`}
              </div>
              <button
                type="button"
                onClick={() => setShowValidationTips(false)}
                title="Hide tips"
                style={{
                  marginLeft: 'auto',
                  width: 18,
                  height: 18,
                  borderRadius: 6,
                  border: `1px solid ${ui.borderStrong}`,
                  background: ui.bgSurface,
                  color: ui.textMuted,
                  fontSize: 12,
                  lineHeight: 1,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 0,
                  flexShrink: 0,
                }}
              >
                ✕
              </button>
            </div>
            {validationResult.errors.map((e, i) => (
              <div key={i} style={{ color: '#dc2626', fontSize: 10, marginBottom: 2 }}>
                ✗ {e.message}
              </div>
            ))}
            {validationResult.warnings.map((w, i) => (
              <div key={i} style={{ color: '#b45309', fontSize: 10, marginBottom: 2 }}>
                ⚠ {w.message}
              </div>
            ))}
            <div style={{ color: ui.textMuted, fontSize: 10, marginTop: 4, borderTop: `1px solid ${ui.border}`, paddingTop: 4 }}>
              {validationResult.summary.assignedPoints}/{validationResult.summary.totalPoints} pts assigned ·
              {' '}{validationResult.summary.totalParameters} params ·
              {' '}{validationResult.summary.assignedServices}/{validationResult.summary.totalEdges} edges tagged
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
          <button
            style={{ ...autoAssignBtnStyle, flex: 1, fontSize: 11, padding: '6px 8px' }}
            onClick={handleQuickGenerate}
            title="Auto-assign all points, validate, and generate in one click"
          >
            ⚡ One-Click Generate
          </button>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button style={validateBtnStyle} onClick={runValidation}>Validate</button>
          <button
            style={{
              ...generateBtnStyle,
              // Enable when: validated + no errors (warnings are OK)
              opacity: validationResult
                ? (validationResult.errors.length === 0 ? 1 : 0.35)
                : 0.55,
              cursor: validationResult
                ? (validationResult.errors.length === 0 ? 'pointer' : 'not-allowed')
                : 'pointer',
              background: validationResult?.warnings?.length > 0 && validationResult?.isValid
                ? '#fffbeb'
                : ui.accentSoft,
              border: validationResult?.warnings?.length > 0 && validationResult?.isValid
                ? '1px solid #fbbf24'
                : `1px solid ${ui.accentBorder}`,
              color: validationResult?.warnings?.length > 0 && validationResult?.isValid
                ? '#b45309'
                : ui.accent,
            }}
            onClick={handleGenerate}
            disabled={validationResult ? validationResult.errors.length > 0 : false}
            title={validationResult?.errors?.length > 0
              ? `Blocked by ${validationResult.errors.length} error(s) — click Validate to see details`
              : 'Validate then generate JSON'}
          >
            {!validationResult ? 'Generate JSON' : validationResult.isValid ? '✓ Generate JSON' : '✗ Fix Errors First'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const panelStyle = {
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
  minHeight: 0,
  overflow: 'hidden',
}

const tabBarStyle = { display: 'flex', borderBottom: `1px solid ${ui.border}`, gap: 0, flexShrink: 0 }

const tabBtnStyle = {
  flex: 1, padding: '8px 3px',
  background: 'transparent', border: 'none',
  borderBottom: '2px solid transparent',
  color: ui.textMuted, fontSize: 12, fontWeight: 600,
  cursor: 'pointer', whiteSpace: 'nowrap',
}
const tabBtnActiveStyle = { color: ui.accent, borderBottomColor: ui.accent }

const sectionBodyStyle = {
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  overflowX: 'hidden',
  paddingBottom: 8,
  WebkitOverflowScrolling: 'touch',
}

const sectionHeaderStyle = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  color: ui.accent, fontWeight: 600, fontSize: 12,
  marginBottom: 8, paddingBottom: 4,
  borderBottom: `1px solid ${ui.border}`,
}

const addBtnStyle = {
  padding: '3px 10px',
  background: ui.accentSoft, border: `1px solid ${ui.accentBorder}`,
  borderRadius: 6, color: ui.accent,
  fontSize: 11, fontWeight: 600, cursor: 'pointer',
}

const autoAssignBtnStyle = {
  flex: 2, padding: '7px 10px',
  background: `linear-gradient(135deg, ${ui.accentSoft}, #e0f2fe)`,
  border: `1px solid ${ui.accentBorder}`,
  borderRadius: 8, color: ui.accent,
  fontSize: 12, fontWeight: 700, cursor: 'pointer',
  letterSpacing: 0.3,
}

const tipsBoxStyle = {
  padding: '10px 12px', borderRadius: 8,
  background: ui.bgPanel, border: `1px dashed ${ui.borderStrong}`,
  color: ui.textMuted, fontSize: 11, lineHeight: 1.7,
  marginBottom: 8,
}

const addFormStyle = {
  padding: 10, background: ui.bgPanel,
  borderRadius: 8, border: `1px solid ${ui.border}`,
  marginBottom: 4,
}

const addInputStyle = {
  padding: '4px 6px', background: ui.bgInput,
  border: `1px solid ${ui.borderStrong}`, borderRadius: 6,
  color: ui.text, fontSize: 12, outline: 'none',
}

const confirmBtnStyle = {
  padding: '4px 14px',
  background: ui.successSoft, border: `1px solid ${ui.success}`,
  borderRadius: 6, color: ui.success,
  fontSize: 11, fontWeight: 600, cursor: 'pointer',
}

const cancelBtnStyle = {
  padding: '4px 14px',
  background: ui.dangerSoft, border: `1px solid ${ui.danger}`,
  borderRadius: 6, color: ui.danger,
  fontSize: 11, fontWeight: 600, cursor: 'pointer',
}

const edgeRowStyle = {
  display: 'flex', alignItems: 'center',
  flexWrap: 'wrap',
  padding: '5px 8px', borderRadius: 6,
  border: `1px solid ${ui.border}`, marginBottom: 4, gap: 6,
}

const serviceSelectStyle = {
  padding: '2px 4px', background: ui.bgInput,
  border: `1px solid ${ui.borderStrong}`, borderRadius: 6,
  color: ui.text, fontSize: 11, outline: 'none', minWidth: 96, marginLeft: 'auto',
}

const labelStyle = {
  fontSize: 11, color: ui.textMuted, fontWeight: 600,
  display: 'block', marginBottom: 2,
}

const metaInputStyle = {
  width: '100%', padding: '5px 8px',
  background: ui.bgInput, border: `1px solid ${ui.borderStrong}`,
  borderRadius: 6, color: ui.text, fontSize: 12,
  fontFamily: 'monospace', outline: 'none', boxSizing: 'border-box',
}

const bottomBarStyle = {
  borderTop: `1px solid ${ui.border}`,
  padding: '6px 0 0 0',
  flexShrink: 0,
  background: ui.bgSurface,
}

const validateBtnStyle = {
  flex: 1, padding: '7px 12px',
  background: ui.bgPanel, border: `1px solid ${ui.borderStrong}`,
  borderRadius: 8, color: ui.textSecondary, fontSize: 12,
  fontWeight: 600, cursor: 'pointer',
}

const generateBtnStyle = {
  flex: 1, padding: '7px 12px',
  background: ui.accentSoft, border: `1px solid ${ui.accentBorder}`,
  borderRadius: 8, color: ui.accent, fontSize: 12,
  fontWeight: 700, cursor: 'pointer',
}