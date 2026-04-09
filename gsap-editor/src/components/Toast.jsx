// src/components/Toast.jsx
// Lightweight toast notification system (no external deps needed).
// Usage:  import { Toaster, toast } from './Toast'
//   - Place <Toaster /> once in your tree (Editor.jsx)
//   - Call toast.success('msg'), toast.error('msg'), toast.info('msg')

import React, { useState, useEffect, useCallback } from 'react'
import ReactDOM from 'react-dom'

// ─── Global event emitter (tiny) ─────────────────────────────────────────────
let _listeners = []
const toastBus = {
  emit : (toast) => _listeners.forEach(fn => fn(toast)),
  on   : (fn)    => { _listeners.push(fn) },
  off  : (fn)    => { _listeners = _listeners.filter(l => l !== fn) },
}

let _idCounter = 0

// ─── Public API ───────────────────────────────────────────────────────────────
export const toast = {
  success: (msg, opts = {}) => toastBus.emit({ id: ++_idCounter, type: 'success', msg, ...opts }),
  error  : (msg, opts = {}) => toastBus.emit({ id: ++_idCounter, type: 'error',   msg, ...opts }),
  info   : (msg, opts = {}) => toastBus.emit({ id: ++_idCounter, type: 'info',    msg, ...opts }),
  loading: (msg, opts = {}) => toastBus.emit({ id: ++_idCounter, type: 'loading', msg, ...opts }),
}

// ─── Single toast item ────────────────────────────────────────────────────────
function ToastItem({ item, onRemove }) {
  const [visible, setVisible] = useState(false)
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    // Slide in
    requestAnimationFrame(() => setVisible(true))
    const defaultDuration = item.type === 'loading' ? 3000 : 4000
    const t = setTimeout(() => dismiss(), item.duration || defaultDuration)
    return () => clearTimeout(t)
  }, [])  // eslint-disable-line

  const dismiss = useCallback(() => {
    setLeaving(true)
    setTimeout(() => onRemove(item.id), 350)
  }, [item.id, onRemove])

  const icons = {
    success: '✓',
    error  : '✕',
    info   : 'ℹ',
    loading: '⟳',
  }

  const colors = {
    success: { bg: '#ecfdf5', border: '#10b981', icon: '#059669', spin: false },
    error  : { bg: '#fef2f2', border: '#f87171', icon: '#dc2626', spin: false },
    info   : { bg: '#eff6ff', border: '#60a5fa', icon: '#2563eb', spin: false },
    loading: { bg: '#f8fafc', border: '#cbd5e1', icon: '#64748b', spin: true  },
  }

  const c = colors[item.type] || colors.info

  return (
    <div
      onClick={dismiss}
      style={{
        display       : 'flex',
        alignItems    : 'center',
        gap           : 10,
        padding       : '11px 16px',
        marginBottom  : 8,
        background    : c.bg,
        border        : `1px solid ${c.border}`,
        borderRadius  : 8,
        color         : '#0f172a',
        fontSize      : 14,
        fontWeight    : 500,
        boxShadow     : '0 8px 30px rgba(15, 23, 42, 0.12)',
        cursor        : 'pointer',
        minWidth      : 260,
        maxWidth      : 400,
        userSelect    : 'none',
        opacity       : visible && !leaving ? 1 : 0,
        transform     : visible && !leaving ? 'translateX(0)' : 'translateX(40px)',
        transition    : 'opacity 0.3s ease, transform 0.3s ease',
        pointerEvents : 'auto',
      }}
      title="Click to dismiss"
    >
      <span style={{
        fontSize    : 16,
        color       : c.icon,
        fontWeight  : 700,
        flexShrink  : 0,
        display     : 'inline-block',
        animation   : c.spin ? 'toast-spin 1s linear infinite' : 'none',
      }}>
        {icons[item.type]}
      </span>
      <span style={{ lineHeight: 1.4 }}>{item.msg}</span>
    </div>
  )
}

// ─── Container rendered via portal ───────────────────────────────────────────
export function Toaster() {
  const [items, setItems] = useState([])

  useEffect(() => {
    const handler = (item) => setItems(prev => [...prev, item])
    toastBus.on(handler)
    return () => toastBus.off(handler)
  }, [])

  const remove = useCallback((id) => {
    setItems(prev => prev.filter(t => t.id !== id))
  }, [])

  if (items.length === 0) return null

  return ReactDOM.createPortal(
    <div
      style={{
        position      : 'fixed',
        bottom        : 28,
        right         : 28,
        zIndex        : 99999,
        display       : 'flex',
        flexDirection : 'column-reverse',
        pointerEvents : 'none',
      }}
    >
      <style>{`
        @keyframes toast-spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
      `}</style>
      {items.map(item => (
        <ToastItem key={item.id} item={item} onRemove={remove} />
      ))}
    </div>,
    document.body
  )
}
