import React, { useState, useEffect, useRef } from 'react'
import { ui } from '../theme/uiTheme.js'

export default function ExpressionInput({
  value,
  onChange,
  onValidate,
  placeholder,
  label,
  status,
  disabled,
}) {
  const [localValue, setLocalValue] = useState(value || '')
  const [validationState, setValidationState] = useState(null)
  const inputRef = useRef(null)

  useEffect(() => {
    setLocalValue(value || '')
  }, [value])

  const handleChange = (e) => {
    const newVal = e.target.value
    setLocalValue(newVal)
    onChange?.(newVal)
    if (onValidate) {
      const result = onValidate(newVal)
      setValidationState(result)
    }
  }

  const borderColor = validationState === true
    ? ui.success
    : validationState === false
      ? ui.danger
      : status === 'verified'
        ? ui.success
        : status === 'error'
          ? ui.danger
          : ui.borderStrong

  return (
    <div style={{ marginBottom: 4 }}>
      {label && (
        <label style={{
          fontSize: 11, color: ui.textMuted, fontWeight: 600,
          display: 'block', marginBottom: 2,
        }}>{label}</label>
      )}
      <input
        ref={inputRef}
        type="text"
        value={localValue}
        onChange={handleChange}
        placeholder={placeholder || 'Enter expression...'}
        disabled={disabled}
        style={{
          width: '100%',
          padding: '5px 8px',
          background: disabled ? ui.bgMuted : ui.bgInput,
          border: `1px solid ${borderColor}`,
          borderRadius: 6,
          color: disabled ? ui.textSubtle : ui.text,
          fontSize: 12,
          fontFamily: 'monospace',
          outline: 'none',
          transition: 'border-color 0.2s',
          boxSizing: 'border-box',
        }}
        onFocus={(e) => {
          e.target.style.borderColor = ui.accentBorder
        }}
        onBlur={(e) => {
          e.target.style.borderColor = borderColor
        }}
      />
    </div>
  )
}
