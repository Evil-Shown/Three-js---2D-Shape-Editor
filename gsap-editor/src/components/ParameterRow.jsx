import React, { useState } from 'react'
import { ParameterType, PARAM_TYPE_META } from '../parameters/ParameterTypes.js'
import { ui } from '../theme/uiTheme.js'

export default function ParameterRow({
  param,
  onUpdate,
  onDelete,
  isReferenced,
  referenceInfo,
  usageLabel,
  focused,
  onFocus,
}) {
  const [editing, setEditing] = useState(false)
  const [editValues, setEditValues] = useState({})

  const meta = PARAM_TYPE_META[param.type] || {}

  const startEdit = () => {
    setEditValues({
      name: param.name,
      type: param.type,
      defaultValue: param.defaultValue,
      description: param.description,
      expression: param.expression || '',
    })
    setEditing(true)
  }

  const saveEdit = () => {
    try {
      onUpdate(param.id, editValues)
      setEditing(false)
    } catch (e) {
      alert(e.message)
    }
  }

  const cancelEdit = () => {
    setEditing(false)
    setEditValues({})
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') saveEdit()
    if (e.key === 'Escape') cancelEdit()
  }

  if (editing) {
    return (
      <div style={rowStyle}>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            style={editInputStyle}
            value={editValues.name}
            onChange={e => setEditValues(v => ({ ...v, name: e.target.value }))}
            onKeyDown={handleKeyDown}
            placeholder="Name"
            autoFocus
          />
          <select
            style={{ ...editInputStyle, width: 80 }}
            value={editValues.type}
            onChange={e => setEditValues(v => ({ ...v, type: e.target.value }))}
          >
            {Object.values(ParameterType).filter(t => t !== 'OFFSET').map(t => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <input
            style={{ ...editInputStyle, width: 60 }}
            type="number"
            value={editValues.defaultValue}
            onChange={e => setEditValues(v => ({ ...v, defaultValue: parseFloat(e.target.value) || 0 }))}
            onKeyDown={handleKeyDown}
            placeholder="Value"
          />
          <input
            style={{ ...editInputStyle, flex: 1, minWidth: 80 }}
            value={editValues.description}
            onChange={e => setEditValues(v => ({ ...v, description: e.target.value }))}
            onKeyDown={handleKeyDown}
            placeholder="Description"
          />
        </div>
        {editValues.type === ParameterType.DERIVED && (
          <input
            style={{ ...editInputStyle, width: '100%', marginTop: 4, fontFamily: 'monospace' }}
            value={editValues.expression}
            onChange={e => setEditValues(v => ({ ...v, expression: e.target.value }))}
            onKeyDown={handleKeyDown}
            placeholder="Expression (e.g. W - W1)"
          />
        )}
        <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
          <button type="button" style={actionBtnStyle} onClick={saveEdit} title="Save">
            <span style={{ color: ui.success }}>&#10003;</span>
          </button>
          <button type="button" style={actionBtnStyle} onClick={cancelEdit} title="Cancel">
            <span style={{ color: ui.danger }}>&#10007;</span>
          </button>
        </div>
      </div>
    )
  }

  return (
    <div
      style={{
        ...rowStyle,
        borderColor: focused ? ui.accentBorder : rowStyle.border,
        boxShadow: focused ? `0 0 0 2px ${ui.accentSoft}` : 'none',
      }}
      onClick={onFocus}
      onDoubleClick={startEdit}
      title="Double-click to edit"
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ color: meta.color, fontSize: 14, width: 18, textAlign: 'center' }}>{meta.icon}</span>
        <span style={{ color: ui.accent, fontWeight: 700, fontSize: 13, fontFamily: 'monospace', minWidth: 28 }}>
          {param.name}
        </span>
        <span style={{ color: ui.textMuted, fontSize: 11, flex: 1 }}>{param.description}</span>
        <span style={{ color: ui.textSubtle, fontSize: 12, fontFamily: 'monospace' }}>
          {param.defaultValue}{meta.unit || 'mm'}
        </span>
      </div>
      {usageLabel && (
        <div style={{ fontSize: 10, color: ui.textSubtle, marginTop: 3, paddingLeft: 24 }}>
          {usageLabel}
        </div>
      )}
      {param.type === ParameterType.DERIVED && param.expression && (
        <div style={{ fontSize: 11, color: '#7c3aed', fontFamily: 'monospace', marginTop: 2, paddingLeft: 24 }}>
          = {param.expression}
        </div>
      )}
      <div style={{ display: 'flex', gap: 4, position: 'absolute', right: 6, top: 6 }}>
        <button type="button" style={actionBtnStyle} onClick={startEdit} title="Edit">&#9998;</button>
        <button
          type="button"
          style={{
            ...actionBtnStyle,
            opacity: isReferenced ? 0.3 : 1,
            cursor: isReferenced ? 'not-allowed' : 'pointer',
          }}
          onClick={isReferenced ? undefined : () => onDelete(param.id)}
          title={isReferenced ? `Referenced in: ${referenceInfo}` : 'Delete'}
        >&#128465;</button>
      </div>
    </div>
  )
}

const rowStyle = {
  position: 'relative',
  padding: '8px 34px 8px 8px',
  background: ui.bgPanel,
  borderRadius: 8,
  marginBottom: 4,
  border: `1px solid ${ui.border}`,
  cursor: 'pointer',
  transition: 'border-color 0.15s, box-shadow 0.15s',
}

const editInputStyle = {
  padding: '3px 6px',
  background: ui.bgInput,
  border: `1px solid ${ui.borderStrong}`,
  borderRadius: 6,
  color: ui.text,
  fontSize: 12,
  outline: 'none',
  width: 56,
}

const actionBtnStyle = {
  background: 'transparent',
  border: 'none',
  color: ui.textMuted,
  cursor: 'pointer',
  fontSize: 13,
  padding: '2px 4px',
  borderRadius: 4,
}
