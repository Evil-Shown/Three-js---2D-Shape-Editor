// src/components/SmartCombobox.jsx
//
// A smart expression input with:
//  • Dropdown suggestion list (exact matches highlighted green)
//  • Live evaluation badge showing computed value
//  • Parameter chip insertion
//  • Keyboard navigation (↑↓ to select, Enter to apply, Esc to close)
//  • Suggestions render in a document portal so parent overflow:hidden does not clip them.

import React, { useState, useRef, useEffect, useCallback, useLayoutEffect } from 'react'
import ReactDOM from 'react-dom'
import { ui } from '../theme/uiTheme.js'

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
  const [ddPos, setDdPos] = useState(null)
  const inputRef = useRef(null)
  const rootRef = useRef(null)
  const dropdownRef = useRef(null)

  const hasValue = value && value.trim().length > 0

  const normalizedSuggestions = suggestions.map(s =>
    typeof s === 'string' ? { expr: s, score: 0.5, isExact: false } : s
  )

  const updateDropdownPosition = useCallback(() => {
    const el = inputRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const maxH = Math.max(120, Math.min(220, window.innerHeight - r.bottom - 12))
    setDdPos({
      top: r.bottom + 1,
      left: r.left,
      width: Math.max(r.width, 140),
      maxHeight: maxH,
    })
  }, [])

  useLayoutEffect(() => {
    if (!open || normalizedSuggestions.length === 0) {
      setDdPos(null)
      return
    }
    updateDropdownPosition()
    window.addEventListener('scroll', updateDropdownPosition, true)
    window.addEventListener('resize', updateDropdownPosition)
    return () => {
      window.removeEventListener('scroll', updateDropdownPosition, true)
      window.removeEventListener('resize', updateDropdownPosition)
    }
  }, [open, normalizedSuggestions.length, updateDropdownPosition, compact, label])

  // Close dropdown on outside click (input lives in rootRef; list in portal)
  useEffect(() => {
    if (!open) return
    const handleClick = (e) => {
      if (rootRef.current?.contains(e.target)) return
      if (dropdownRef.current?.contains(e.target)) return
      setOpen(false)
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

  const dropdownPortal = open && normalizedSuggestions.length > 0 && ddPos
    ? ReactDOM.createPortal(
        <div
          ref={dropdownRef}
          style={{
            position: 'fixed',
            top: ddPos.top,
            left: ddPos.left,
            width: ddPos.width,
            maxHeight: ddPos.maxHeight,
            overflowY: 'auto',
            zIndex: 25000,
            background: ui.bgElevated,
            border: `1px solid ${ui.borderStrong}`,
            borderRadius: 8,
            boxShadow: ui.shadowLg,
            WebkitOverflowScrolling: 'touch',
          }}
        >
          {normalizedSuggestions.map((s, idx) => {
            const isHighlighted = idx === highlightIdx
            const isExact = s.isExact || s.score >= 0.95
            const isCurrent = s.expr === value

            return (
              <div
                key={s.expr}
                style={{
                  ...dropdownItemStyle,
                  background: isHighlighted ? '#e0f2fe' : (isCurrent ? ui.accentSoft : 'transparent'),
                  borderLeft: isExact ? `2px solid ${ui.success}` : '2px solid transparent',
                }}
                onMouseDown={(e) => { e.preventDefault(); applySuggestion(s) }}
                onMouseEnter={() => setHighlightIdx(idx)}
              >
                <span style={{
                  fontFamily: 'monospace',
                  fontSize: 11,
                  color: isExact ? ui.success : (isCurrent ? ui.accent : ui.textSecondary),
                  fontWeight: isExact ? 700 : 400,
                }}>
                  {s.expr}
                </span>
                {isExact && (
                  <span style={{ fontSize: 9, color: ui.success, marginLeft: 'auto' }}>exact</span>
                )}
                {isCurrent && !isExact && (
                  <span style={{ fontSize: 9, color: ui.accent, marginLeft: 'auto' }}>current</span>
                )}
              </div>
            )
          })}
        </div>,
        document.body
      )
    : null

  return (
    <div ref={rootRef} style={{ position: 'relative', marginBottom: compact ? 4 : 8 }}>
      {label && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
          <label style={labelStyle}>{label}</label>
          {preview && hasValue && (
            <span style={{
              ...previewBadgeStyle,
              background: preview.ok ? '#ecfdf5' : '#fef2f2',
              color: preview.ok ? '#047857' : '#dc2626',
            }}>
              = {preview.value} {preview.ok ? '✓' : preview.expected ? `(need ${preview.expected})` : ''}
            </span>
          )}
        </div>
      )}

      <div style={{ position: 'relative' }}>
        <input
          ref={inputRef}
          style={{
            ...inputStyle,
            borderColor: hasValue
              ? (preview ? (preview.ok ? ui.success : ui.danger) : ui.borderStrong)
              : ui.borderStrong,
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

        {hasValue && preview && (
          <span style={{
            ...statusDotStyle,
            background: preview.ok ? ui.success : ui.danger,
          }} />
        )}
      </div>

      {dropdownPortal}

      {!open && normalizedSuggestions.length > 0 && !hasValue && (
        <div style={chipRowStyle}>
          {normalizedSuggestions.slice(0, 3).map(s => (
            <button
              key={s.expr}
              type="button"
              style={{
                ...chipStyle,
                borderColor: s.isExact || s.score >= 0.95 ? ui.success : ui.borderStrong,
                color: s.isExact || s.score >= 0.95 ? ui.success : ui.textMuted,
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

const labelStyle = {
  fontSize: 11, color: ui.textMuted, fontWeight: 600,
}

const inputStyle = {
  width: '100%',
  padding: '6px 8px',
  background: ui.bgInput,
  border: `1px solid ${ui.borderStrong}`,
  borderRadius: 6,
  color: ui.text,
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
  background: ui.bgPanel,
  border: `1px solid ${ui.border}`,
  borderRadius: 10,
  color: ui.textMuted,
  fontSize: 10,
  fontFamily: 'monospace',
  cursor: 'pointer',
  transition: 'all 0.1s',
}
