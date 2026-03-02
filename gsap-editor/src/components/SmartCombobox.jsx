// src/components/SmartCombobox.jsx
//
// A smart expression input with:
//  • Dropdown suggestion list (exact matches highlighted green)
//  • Live evaluation badge showing computed value
//  • Parameter chip insertion
//  • Keyboard navigation (↑↓ to select, Enter to apply, Esc to close)

import React, { useState, useRef, useEffect, useCallback } from 'react'

export default function SmartCombobox({
  value,
  onChange,
  suggestions = [],    // [{ expr, score, isExact }]
  preview = null,      // { value, ok, expected }
  placeholder = '',
  label = '',
  disabled = false,
  compact = false,
}) {
  const [open, setOpen] = useState(false)
  const [highlightIdx, setHighlightIdx] = useState(-1)
  const inputRef = useRef(null)
  const listRef = useRef(null)

  const hasValue = value && value.trim().length > 0

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return
    const handleClick = (e) => {
      if (!inputRef.current?.parentElement.contains(e.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  const handleFocus = () => {
    if (suggestions.length > 0) setOpen(true)
  }

  const handleKeyDown = useCallback((e) => {
    if (!open || suggestions.length === 0) {
      if (e.key === 'ArrowDown' && suggestions.length > 0) {
        setOpen(true)
        setHighlightIdx(0)
        e.preventDefault()
      }
      return
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlightIdx(i => Math.min(i + 1, suggestions.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlightIdx(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && highlightIdx >= 0) {
      e.preventDefault()
      const s = suggestions[highlightIdx]
      if (s) {
        onChange(typeof s === 'string' ? s : s.expr)
        setOpen(false)
      }
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }, [open, suggestions, highlightIdx, onChange])

  const applySuggestion = (s) => {
    onChange(typeof s === 'string' ? s : s.expr)
    setOpen(false)
    inputRef.current?.focus()
  }

  // Normalize suggestions to objects
  const normalizedSuggestions = suggestions.map(s =>
    typeof s === 'string' ? { expr: s, score: 0.5, isExact: false } : s
  )

  return (
    <div style={{ position: 'relative', marginBottom: compact ? 4 : 8 }}>
      {/* Label + preview badge */}
      {label && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
          <label style={labelStyle}>{label}</label>
          {preview && hasValue && (
            <span style={{
              ...previewBadgeStyle,
              background: preview.ok ? '#0e2012' : '#200e0e',
              color: preview.ok ? '#44ee66' : '#ff6666',
            }}>
              = {preview.value} {preview.ok ? '✓' : preview.expected ? `(need ${preview.expected})` : ''}
            </span>
          )}
        </div>
      )}

      {/* Input field */}
      <div style={{ position: 'relative' }}>
        <input
          ref={inputRef}
          style={{
            ...inputStyle,
            borderColor: hasValue
              ? (preview ? (preview.ok ? '#44cc66' : '#cc4444') : '#4a5060')
              : '#3a3d42',
            opacity: disabled ? 0.5 : 1,
            fontSize: compact ? 11 : 12,
            padding: compact ? '4px 7px' : '6px 8px',
          }}
          value={value}
          onChange={(e) => {
            onChange(e.target.value)
            if (!open && suggestions.length > 0) setOpen(true)
          }}
          onFocus={handleFocus}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          spellCheck={false}
          disabled={disabled}
        />

        {/* Status dot */}
        {hasValue && preview && (
          <span style={{
            ...statusDotStyle,
            background: preview.ok ? '#44cc66' : '#cc4444',
          }} />
        )}
      </div>

      {/* Suggestion dropdown */}
      {open && normalizedSuggestions.length > 0 && (
        <div ref={listRef} style={dropdownStyle}>
          {normalizedSuggestions.map((s, idx) => {
            const isHighlighted = idx === highlightIdx
            const isExact = s.isExact || s.score >= 0.95
            const isCurrent = s.expr === value

            return (
              <div
                key={s.expr}
                style={{
                  ...dropdownItemStyle,
                  background: isHighlighted ? '#2a3540' : (isCurrent ? '#1a2e28' : 'transparent'),
                  borderLeft: isExact ? '2px solid #44cc66' : '2px solid transparent',
                }}
                onMouseDown={(e) => { e.preventDefault(); applySuggestion(s) }}
                onMouseEnter={() => setHighlightIdx(idx)}
              >
                <span style={{
                  fontFamily: 'monospace',
                  fontSize: 11,
                  color: isExact ? '#66ee88' : (isCurrent ? '#7fffd4' : '#ccc'),
                  fontWeight: isExact ? 700 : 400,
                }}>
                  {s.expr}
                </span>
                {isExact && (
                  <span style={{ fontSize: 9, color: '#44aa66', marginLeft: 'auto' }}>exact</span>
                )}
                {isCurrent && !isExact && (
                  <span style={{ fontSize: 9, color: '#7fffd4', marginLeft: 'auto' }}>current</span>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Chip row (shown when dropdown is closed and there are suggestions) */}
      {!open && normalizedSuggestions.length > 0 && !hasValue && (
        <div style={chipRowStyle}>
          {normalizedSuggestions.slice(0, 3).map(s => (
            <button
              key={s.expr}
              style={{
                ...chipStyle,
                borderColor: s.isExact || s.score >= 0.95 ? '#44aa55' : '#3a3d42',
                color: s.isExact || s.score >= 0.95 ? '#88dd88' : '#aaa',
                fontWeight: s.isExact || s.score >= 0.95 ? 700 : 400,
              }}
              onClick={() => applySuggestion(s)}
              title="Click to use this expression"
            >
              {s.expr}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const labelStyle = {
  fontSize: 11, color: '#666', fontWeight: 600,
}

const inputStyle = {
  width: '100%',
  padding: '6px 8px',
  background: '#0f1114',
  border: '1px solid #3a3d42',
  borderRadius: 4,
  color: '#e8eaec',
  fontSize: 12,
  fontFamily: 'monospace',
  outline: 'none',
  boxSizing: 'border-box',
  letterSpacing: 0.3,
}

const previewBadgeStyle = {
  fontSize: 10,
  padding: '1px 6px',
  borderRadius: 3,
  fontFamily: 'monospace',
}

const statusDotStyle = {
  position: 'absolute',
  right: 8,
  top: '50%',
  transform: 'translateY(-50%)',
  width: 6,
  height: 6,
  borderRadius: '50%',
}

const dropdownStyle = {
  position: 'absolute',
  top: '100%',
  left: 0,
  right: 0,
  zIndex: 100,
  background: '#252830',
  border: '1px solid #3a3d42',
  borderTop: 'none',
  borderRadius: '0 0 5px 5px',
  maxHeight: 160,
  overflowY: 'auto',
  boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
}

const dropdownItemStyle = {
  display: 'flex',
  alignItems: 'center',
  padding: '5px 8px',
  cursor: 'pointer',
  gap: 8,
  transition: 'background 0.1s',
}

const chipRowStyle = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 4,
  marginTop: 4,
}

const chipStyle = {
  padding: '2px 8px',
  background: '#252830',
  border: '1px solid #3a3d42',
  borderRadius: 10,
  color: '#aaa',
  fontSize: 10,
  fontFamily: 'monospace',
  cursor: 'pointer',
  transition: 'all 0.1s',
}
