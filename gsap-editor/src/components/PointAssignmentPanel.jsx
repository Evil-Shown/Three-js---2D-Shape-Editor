// src/components/PointAssignmentPanel.jsx
//
// Redesigned Points panel — replaces the old Points tab in ParameterPanel.
// Features:
//  • All points visible at once with status dots
//  • Unassigned points auto-expanded, verified ones collapsed
//  • SmartCombobox for X and Y expressions
//  • Progress indicator and bulk action buttons
//  • No manual typing required — just click suggestions

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import SmartCombobox from './SmartCombobox.jsx'
import { ExpressionBuilder } from '../parameters/ExpressionBuilder.js'
import { SmartSuggestionEngine } from '../parameters/SmartSuggestionEngine.js'
import { AutoAssignService } from '../parameters/AutoAssignService.js'
import { POINT_STATUS_COLORS } from '../parameters/ParameterTypes.js'

export default function PointAssignmentPanel({
  paramStore,
  geometryStore,
  pointTagger,
  onValidate,
}) {
  const [expandedId, setExpandedId] = useState(null)
  const [autoMsg, setAutoMsg] = useState(null)

  const builderRef = useRef(new ExpressionBuilder())
  const suggRef = useRef(new SmartSuggestionEngine())
  const autoRef = useRef(new AutoAssignService())

  const shapePoints = useMemo(
    () => builderRef.current.extractShapePoints(geometryStore),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [geometryStore, paramStore.version]
  )

  const pointExprs = paramStore.getAllPointExpressions()

  // Count verified points
  const verifiedCount = shapePoints.filter(pt => {
    const s = pointTagger ? pointTagger.getPointStatus(pt.id) : 'unset'
    return s === 'verified'
  }).length

  // Auto-expand first unassigned point
  useEffect(() => {
    if (expandedId) return
    const first = shapePoints.find(pt => {
      const expr = pointExprs[pt.id]
      return !expr || !expr.x.trim() || !expr.y.trim()
    })
    if (first) setExpandedId(first.id)
    else if (shapePoints.length > 0) setExpandedId(shapePoints[0].id)
  }, [shapePoints, pointExprs, expandedId])

  const handleAutoAssignAll = () => {
    const stats = autoRef.current.autoAssignAll(paramStore, geometryStore)
    if (pointTagger) pointTagger.refreshIndicators()
    const litCount = stats.literals.length
    setAutoMsg(
      `✓ Assigned ${stats.assigned}/${shapePoints.length} points · ${stats.paramMatched} matched params` +
      (litCount ? ` · ${litCount} literals` : '')
    )
    setTimeout(() => setAutoMsg(null), 5000)
  }

  const handleFillMissing = () => {
    const count = autoRef.current.autoAssignMissing(paramStore, geometryStore)
    if (pointTagger) pointTagger.refreshIndicators()
    setAutoMsg(`✓ Filled ${count} missing expressions`)
    setTimeout(() => setAutoMsg(null), 4000)
  }

  const handleSavePoint = useCallback((pointId, xExpr, yExpr) => {
    paramStore.setPointExpression(pointId, xExpr, yExpr)
    if (pointTagger) pointTagger.refreshIndicators()
  }, [paramStore, pointTagger])

  // Progress bar
  const progressPct = shapePoints.length > 0
    ? Math.round((verifiedCount / shapePoints.length) * 100)
    : 0

  return (
    <div>
      {/* Progress bar */}
      <div style={progressContainerStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
          <span style={{ color: '#888', fontSize: 11, fontWeight: 600 }}>
            Point Assignment
          </span>
          <span style={{
            fontSize: 11, fontWeight: 700,
            color: progressPct === 100 ? '#44cc66' : '#cccc44',
          }}>
            {verifiedCount}/{shapePoints.length} verified
          </span>
        </div>
        <div style={progressBarBg}>
          <div style={{
            ...progressBarFill,
            width: `${progressPct}%`,
            background: progressPct === 100
              ? 'linear-gradient(90deg, #2a8a4a, #44cc66)'
              : 'linear-gradient(90deg, #8a8a2a, #cccc44)',
          }} />
        </div>
      </div>

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        <button style={autoAssignBtnStyle} onClick={handleAutoAssignAll}>
          🪄 Re-Assign All
        </button>
        <button style={fillMissingBtnStyle} onClick={handleFillMissing}>
          Fill Missing
        </button>
      </div>

      {autoMsg && <div style={autoMsgStyle}>{autoMsg}</div>}

      {/* Point list */}
      <div style={{ maxHeight: 360, overflowY: 'auto' }}>
        {shapePoints.map(pt => (
          <PointRow
            key={pt.id}
            point={pt}
            expression={pointExprs[pt.id]}
            status={pointTagger ? pointTagger.getPointStatus(pt.id) : 'unset'}
            isExpanded={expandedId === pt.id}
            onToggle={() => setExpandedId(expandedId === pt.id ? null : pt.id)}
            onSave={handleSavePoint}
            paramStore={paramStore}
            geometryStore={geometryStore}
            shapePoints={shapePoints}
            suggEngine={suggRef.current}
            builder={builderRef.current}
          />
        ))}
      </div>

      {shapePoints.length === 0 && (
        <div style={emptyStyle}>
          No shape points detected. Draw and close a shape first.
        </div>
      )}
    </div>
  )
}

// ── PointRow ─────────────────────────────────────────────────────────────────

function PointRow({
  point, expression, status, isExpanded, onToggle, onSave,
  paramStore, geometryStore, shapePoints, suggEngine, builder,
}) {
  const [localX, setLocalX] = useState(expression?.x || '')
  const [localY, setLocalY] = useState(expression?.y || '')
  const [xPreview, setXPreview] = useState(null)
  const [yPreview, setYPreview] = useState(null)
  const [saved, setSaved] = useState(false)

  const statusColor = POINT_STATUS_COLORS[status] || '#666'
  const isP0 = point.id === 'p0'

  // Sync with external changes
  useEffect(() => {
    setLocalX(expression?.x || '')
    setLocalY(expression?.y || '')
  }, [expression])

  // Generate suggestions
  const suggestions = useMemo(() => {
    if (isP0) return { x: ['trimLeft'], y: ['trimBottom'] }
    return suggEngine.suggest(point.id, point.x, point.y, paramStore, shapePoints)
  }, [point, paramStore, shapePoints, suggEngine, isP0])

  // Build rich suggestion objects with scores
  const xSuggestions = useMemo(() => {
    if (isP0) return [{ expr: 'trimLeft', score: 1.0, isExact: true }]
    return (suggestions.x || []).map((expr, idx) => ({
      expr,
      score: 1.0 - idx * 0.15,
      isExact: idx === 0 && suggestions.x.length > 1,
    }))
  }, [suggestions, isP0])

  const ySuggestions = useMemo(() => {
    if (isP0) return [{ expr: 'trimBottom', score: 1.0, isExact: true }]
    return (suggestions.y || []).map((expr, idx) => ({
      expr,
      score: 1.0 - idx * 0.15,
      isExact: idx === 0 && suggestions.y.length > 1,
    }))
  }, [suggestions, isP0])

  // Live evaluation
  useEffect(() => {
    if (!localX.trim()) { setXPreview(null); return }
    try {
      const v = builder.evaluateSingle(localX, paramStore, geometryStore)
      const ok = !isNaN(v) && Math.abs(v - point.x) < 0.5
      setXPreview({ value: isNaN(v) ? '?' : v.toFixed(3), ok, expected: point.x.toFixed(3) })
    } catch { setXPreview({ value: '?', ok: false }) }
  }, [localX, point, paramStore, geometryStore, builder])

  useEffect(() => {
    if (!localY.trim()) { setYPreview(null); return }
    try {
      const v = builder.evaluateSingle(localY, paramStore, geometryStore)
      const ok = !isNaN(v) && Math.abs(v - point.y) < 0.5
      setYPreview({ value: isNaN(v) ? '?' : v.toFixed(3), ok, expected: point.y.toFixed(3) })
    } catch { setYPreview({ value: '?', ok: false }) }
  }, [localY, point, paramStore, geometryStore, builder])

  const handleSave = () => {
    onSave(point.id, localX, localY)
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  return (
    <div style={{
      ...pointContainerStyle,
      borderColor: isExpanded ? '#7fffd4' : '#2a2d30',
      background: isExpanded ? '#1a2520' : '#1e2124',
    }}>
      {/* Collapsed row — always visible */}
      <div style={pointHeaderStyle} onClick={onToggle}>
        {/* Status dot */}
        <span style={{
          width: 8, height: 8, borderRadius: '50%',
          background: statusColor,
          flexShrink: 0,
        }} />
        {/* Point ID */}
        <span style={{ color: '#7fffd4', fontFamily: 'monospace', fontWeight: 700, fontSize: 12, minWidth: 26 }}>
          {point.id}
        </span>
        {/* Coordinates */}
        <span style={{ color: '#555', fontSize: 10, minWidth: 80 }}>
          ({point.x.toFixed(1)}, {point.y.toFixed(1)})
        </span>
        {/* Expression preview */}
        {expression && expression.x ? (
          <span style={{
            color: status === 'verified' ? '#66aa77' : '#777',
            fontSize: 10, fontFamily: 'monospace',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            flex: 1, textAlign: 'right',
          }}>
            {expression.x} · {expression.y}
          </span>
        ) : (
          <span style={{ color: '#aa4444', fontSize: 10, flex: 1, textAlign: 'right' }}>
            unset
          </span>
        )}
        {/* Expand arrow */}
        <span style={{ color: '#555', fontSize: 10, marginLeft: 4 }}>
          {isExpanded ? '▾' : '▸'}
        </span>
      </div>

      {/* Expanded editor */}
      {isExpanded && (
        <div style={pointEditorStyle}>
          {isP0 ? (
            <div style={p0InfoStyle}>
              <span style={{ fontSize: 16, marginRight: 8 }}>⚓</span>
              <div>
                <div style={{ fontWeight: 700, color: '#7fffd4', fontSize: 12 }}>Shape Origin</div>
                <div style={{ color: '#999', fontSize: 11, marginTop: 2 }}>
                  X = <code style={{ color: '#ccc' }}>trimLeft</code>,
                  Y = <code style={{ color: '#ccc' }}>trimBottom</code>
                </div>
              </div>
            </div>
          ) : (
            <>
              <SmartCombobox
                label="X (horizontal)"
                value={localX}
                onChange={setLocalX}
                suggestions={xSuggestions}
                preview={xPreview}
                placeholder={`e.g. p0.x + L  or  ${point.x.toFixed(2)}`}
                compact
              />
              <SmartCombobox
                label="Y (vertical)"
                value={localY}
                onChange={setLocalY}
                suggestions={ySuggestions}
                preview={yPreview}
                placeholder={`e.g. p0.y + H  or  ${point.y.toFixed(2)}`}
                compact
              />
              <button
                style={{
                  ...saveBtnStyle,
                  ...(saved ? {
                    background: '#1a3a28',
                    borderColor: '#66ee88',
                    color: '#66ee88',
                  } : {}),
                }}
                onClick={handleSave}
              >
                {saved ? '✓ Saved!' : '✓ Save'}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const progressContainerStyle = {
  marginBottom: 10,
}

const progressBarBg = {
  height: 4,
  borderRadius: 2,
  background: '#2a2d30',
  overflow: 'hidden',
}

const progressBarFill = {
  height: '100%',
  borderRadius: 2,
  transition: 'width 0.3s ease',
}

const autoAssignBtnStyle = {
  flex: 2, padding: '7px 10px',
  background: 'linear-gradient(135deg, #1a3328, #1e2e3a)',
  border: '1px solid #7fffd4',
  borderRadius: 5, color: '#7fffd4',
  fontSize: 12, fontWeight: 700, cursor: 'pointer',
}

const fillMissingBtnStyle = {
  flex: 1, padding: '7px 10px',
  background: '#1e2124',
  border: '1px solid #3a3d42',
  borderRadius: 5, color: '#aaa',
  fontSize: 11, fontWeight: 600, cursor: 'pointer',
}

const autoMsgStyle = {
  padding: '6px 8px', marginBottom: 8,
  background: '#0f2018', borderRadius: 4,
  border: '1px solid #2a5a38',
  color: '#66cc88', fontSize: 11,
}

const pointContainerStyle = {
  borderRadius: 6,
  border: '1px solid #2a2d30',
  marginBottom: 4,
  overflow: 'hidden',
  transition: 'border-color 0.15s',
}

const pointHeaderStyle = {
  display: 'flex',
  alignItems: 'center',
  padding: '6px 8px',
  gap: 6,
  cursor: 'pointer',
}

const pointEditorStyle = {
  padding: '6px 10px 10px',
  borderTop: '1px solid #2a2d30',
  background: '#181c20',
}

const p0InfoStyle = {
  display: 'flex',
  alignItems: 'center',
  padding: '8px 10px',
  background: '#1f1812',
  borderRadius: 5,
  border: '1px solid #3d2810',
}

const saveBtnStyle = {
  width: '100%',
  padding: '5px 12px',
  background: '#1a3328',
  border: '1px solid #44cc66',
  borderRadius: 4,
  color: '#44cc66',
  fontSize: 11,
  fontWeight: 600,
  cursor: 'pointer',
  marginTop: 4,
}

const emptyStyle = {
  padding: '16px 12px',
  color: '#666',
  fontSize: 12,
  textAlign: 'center',
}
