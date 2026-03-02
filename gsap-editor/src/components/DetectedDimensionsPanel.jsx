// src/components/DetectedDimensionsPanel.jsx
//
// Appears when switching to Parameter mode with no parameters defined yet.
// Shows auto-detected dimensions from the drawn geometry (via GeometryAnalyzer)
// and lets the user confirm them with a single click.
//
// Flow: GeometryAnalyzer.analyze() → this panel → "Create All" → paramStore.addParametersFromAnalysis()
//       → AutoAssignService.autoAssignAll() → validate → success message

import React, { useState, useMemo } from 'react'
import { PARAM_TYPE_META } from '../parameters/ParameterTypes.js'

export default function DetectedDimensionsPanel({
  analysis,
  paramStore,
  geometryStore,
  onCreated,
  onDismiss,
  autoAssignService,
  pointTagger,
}) {
  const [checked, setChecked] = useState(
    () => new Set(analysis.suggestedParams.map(p => p.name))
  )
  const [renamed, setRenamed] = useState({})
  const [status, setStatus] = useState(null) // { type: 'success'|'error', msg }

  const shapeName = useMemo(() => {
    const names = {
      RECTANGLE: 'Rectangle',
      ROUNDED_RECTANGLE: 'Rounded Rectangle',
      L_SHAPE: 'L-Shape',
      T_SHAPE: 'T-Shape',
      U_CHANNEL: 'U-Channel',
      SLOT: 'Slot / Stadium',
      CIRCLE: 'Circle',
      CUSTOM: 'Custom Shape',
    }
    return names[analysis.shapeType] || 'Shape'
  }, [analysis.shapeType])

  const toggleCheck = (name) => {
    setChecked(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const handleRename = (origName, newName) => {
    setRenamed(prev => ({ ...prev, [origName]: newName }))
  }

  const handleCreateAll = () => {
    try {
      // Build the list of params to add (only checked ones)
      const toAdd = analysis.suggestedParams
        .filter(p => checked.has(p.name))
        .map(p => ({
          ...p,
          name: renamed[p.name] || p.name,
        }))

      if (toAdd.length === 0) {
        setStatus({ type: 'error', msg: 'No parameters selected' })
        return
      }

      const added = paramStore.addParametersFromAnalysis(toAdd)

      // Auto-assign all points using the new parameters
      if (autoAssignService) {
        autoAssignService.autoAssignAll(paramStore, geometryStore)
        if (pointTagger) pointTagger.refreshIndicators()
      }

      setStatus({
        type: 'success',
        msg: `✓ Created ${added} parameters and auto-assigned all points!`,
      })

      // Notify parent after a short delay so the user sees the success message
      setTimeout(() => onCreated?.(), 800)
    } catch (e) {
      setStatus({ type: 'error', msg: `Error: ${e.message}` })
    }
  }

  const bb = analysis.boundingBox

  return (
    <div style={panelStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 20 }}>✨</span>
          <div>
            <div style={{ fontWeight: 700, color: '#7fffd4', fontSize: 14, letterSpacing: 0.3 }}>
              Detected: {shapeName}
            </div>
            <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>
              {bb.width.toFixed(1)} × {bb.height.toFixed(1)} mm · {analysis.suggestedParams.length} parameters found
            </div>
          </div>
        </div>
        <button onClick={onDismiss} style={dismissBtnStyle} title="Skip auto-detection">✕</button>
      </div>

      {/* Parameter list with checkboxes */}
      <div style={listStyle}>
        {analysis.suggestedParams.map(param => {
          const meta = PARAM_TYPE_META[param.type]
          const isChecked = checked.has(param.name)
          const displayName = renamed[param.name] || param.name

          return (
            <div key={param.name} style={{
              ...paramRowStyle,
              opacity: isChecked ? 1 : 0.4,
              borderColor: isChecked ? '#2e4038' : '#2a2d30',
            }}>
              {/* Checkbox */}
              <label style={checkboxLabelStyle}>
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={() => toggleCheck(param.name)}
                  style={{ accentColor: '#7fffd4' }}
                />
              </label>

              {/* Type icon */}
              <span style={{ color: meta?.color || '#888', fontSize: 14, minWidth: 18, textAlign: 'center' }}>
                {meta?.icon || '?'}
              </span>

              {/* Editable name */}
              <input
                style={nameInputStyle}
                value={displayName}
                onChange={(e) => handleRename(param.name, e.target.value)}
                title="Click to rename"
                spellCheck={false}
              />

              {/* Value */}
              <span style={valueStyle}>
                = {param.defaultValue}{param.type === 'ANGLE' ? '°' : ' mm'}
              </span>

              {/* Description */}
              <span style={descStyle}>{param.description}</span>
            </div>
          )
        })}
      </div>

      {/* Status message */}
      {status && (
        <div style={{
          ...statusStyle,
          background: status.type === 'success' ? '#0f2018' : '#200f0f',
          borderColor: status.type === 'success' ? '#2a5a38' : '#5a2a2a',
          color: status.type === 'success' ? '#66cc88' : '#cc6666',
        }}>
          {status.msg}
        </div>
      )}

      {/* Action buttons */}
      <div style={actionBarStyle}>
        <button style={createBtnStyle} onClick={handleCreateAll}>
          ⚡ Create {checked.size} Parameter{checked.size !== 1 ? 's' : ''} & Auto-Assign
        </button>
        <button style={skipBtnStyle} onClick={onDismiss}>
          Skip — I'll add manually
        </button>
      </div>
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const panelStyle = {
  background: '#1a1e22',
  border: '1px solid #2e4038',
  borderRadius: 10,
  padding: 0,
  marginBottom: 14,
  overflow: 'hidden',
  boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
  position: 'relative',
  zIndex: 2,
  minHeight: 280,
}

const headerStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '14px 16px',
  background: 'linear-gradient(135deg, #152420, #1a2030)',
  borderBottom: '1px solid #2e4038',
}

const dismissBtnStyle = {
  background: 'none',
  border: 'none',
  color: '#555',
  fontSize: 16,
  cursor: 'pointer',
  padding: '2px 6px',
  borderRadius: 4,
}

const listStyle = {
  padding: '10px 12px',
  maxHeight: 320,
  overflowY: 'auto',
}

const paramRowStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '7px 8px',
  borderRadius: 5,
  border: '1px solid #2e4038',
  marginBottom: 5,
  transition: 'opacity 0.15s',
}

const checkboxLabelStyle = {
  display: 'flex',
  alignItems: 'center',
  cursor: 'pointer',
  flexShrink: 0,
}

const nameInputStyle = {
  background: '#252830',
  border: '1px solid #3a3d42',
  borderRadius: 3,
  color: '#7fffd4',
  fontSize: 13,
  fontFamily: 'monospace',
  fontWeight: 700,
  padding: '4px 8px',
  width: 64,
  outline: 'none',
  textAlign: 'center',
}

const valueStyle = {
  color: '#aaa',
  fontSize: 12,
  fontFamily: 'monospace',
  minWidth: 92,
  flexShrink: 0,
}

const descStyle = {
  color: '#666',
  fontSize: 11,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  flex: 1,
}

const statusStyle = {
  margin: '0 10px 8px',
  padding: '6px 10px',
  borderRadius: 5,
  border: '1px solid',
  fontSize: 11,
}

const actionBarStyle = {
  padding: '8px 10px 12px',
  borderTop: '1px solid #252830',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
}

const createBtnStyle = {
  width: '100%',
  padding: '9px 12px',
  background: 'linear-gradient(135deg, #1a3828, #1e3a40)',
  border: '1px solid #7fffd4',
  borderRadius: 6,
  color: '#7fffd4',
  fontSize: 13,
  fontWeight: 700,
  cursor: 'pointer',
  letterSpacing: 0.3,
}

const skipBtnStyle = {
  width: '100%',
  padding: '6px 12px',
  background: 'transparent',
  border: '1px solid #3a3d42',
  borderRadius: 6,
  color: '#888',
  fontSize: 11,
  cursor: 'pointer',
}
