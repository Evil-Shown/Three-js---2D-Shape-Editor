import React, { useState, useEffect, useRef } from 'react'

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
    ? '#44cc66'
    : validationState === false
      ? '#ff4444'
      : status === 'verified'
        ? '#44cc66'
        : status === 'error'
          ? '#ff4444'
          : '#3a3d42'

  return (
    <div style={{ marginBottom: 4 }}>
      {label && (
        <label style={{
          fontSize: 11, color: '#888', fontWeight: 600,
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
          background: disabled ? '#1a1c1e' : '#252830',
          border: `1px solid ${borderColor}`,
          borderRadius: 4,
          color: disabled ? '#666' : '#e0e3e6',
          fontSize: 12,
          fontFamily: 'monospace',
          outline: 'none',
          transition: 'border-color 0.2s',
          boxSizing: 'border-box',
        }}
        onFocus={(e) => {
          e.target.style.borderColor = '#7fffd4'
        }}
        onBlur={(e) => {
          e.target.style.borderColor = borderColor
        }}
      />
    </div>
  )
}
