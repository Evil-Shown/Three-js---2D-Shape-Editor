// src/components/SaveConfirmModal.jsx
// Modal shown after saving to DB — asks user if they want to download the JSON file.

import React from 'react'
import ReactDOM from 'react-dom'

export default function SaveConfirmModal({ shapeName, onDownload, onClose }) {
  if (!shapeName && shapeName !== '') return null

  return ReactDOM.createPortal(
    <div
      style={backdropStyle}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <style>{`
        @keyframes modal-in {
          from { opacity: 0; transform: scale(0.93) translateY(-8px); }
          to   { opacity: 1; transform: scale(1)    translateY(0); }
        }
      `}</style>
      <div style={modalStyle}>
        {/* Icon */}
        <div style={{ fontSize: 40, marginBottom: 12, textAlign: 'center' }}>💾</div>

        {/* Title */}
        <h2 style={titleStyle}>Saved to Database</h2>

        {/* Message */}
        <p style={msgStyle}>
          <span style={{ color: '#7fffd4', fontWeight: 600 }}>"{shapeName}"</span>{' '}
          has been saved to the database successfully.
          <br />
          Do you also want to download the JSON file?
        </p>

        {/* Buttons */}
        <div style={btnRowStyle}>
          <button style={btnSecondaryStyle} onClick={onClose}>
            No, thanks
          </button>
          <button style={btnPrimaryStyle} onClick={onDownload}>
            ⬇ Download JSON
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const backdropStyle = {
  position       : 'fixed',
  inset          : 0,
  background     : 'rgba(0, 0, 0, 0.65)',
  display        : 'flex',
  alignItems     : 'center',
  justifyContent : 'center',
  zIndex         : 99998,
  backdropFilter : 'blur(3px)',
}

const modalStyle = {
  background   : '#1e2228',
  border       : '1px solid #3a4149',
  borderRadius : 12,
  padding      : '32px 36px',
  maxWidth     : 420,
  width        : '90%',
  boxShadow    : '0 20px 60px rgba(0,0,0,0.6)',
  animation    : 'modal-in 0.2s ease',
}

const titleStyle = {
  margin         : '0 0 12px',
  fontSize       : 20,
  fontWeight     : 700,
  color          : '#e5e7eb',
  textAlign      : 'center',
}

const msgStyle = {
  margin      : '0 0 24px',
  fontSize    : 14,
  color       : '#9ca3af',
  lineHeight  : 1.6,
  textAlign   : 'center',
}

const btnRowStyle = {
  display    : 'flex',
  gap        : 12,
  justifyContent: 'center',
}

const btnBase = {
  padding      : '10px 22px',
  borderRadius : 7,
  fontSize     : 14,
  fontWeight   : 600,
  cursor       : 'pointer',
  border       : 'none',
  transition   : 'opacity 0.15s',
}

const btnPrimaryStyle = {
  ...btnBase,
  background : 'linear-gradient(135deg, #00ffd4, #0099aa)',
  color      : '#0d1117',
}

const btnSecondaryStyle = {
  ...btnBase,
  background : 'transparent',
  border     : '1px solid #4b5563',
  color      : '#9ca3af',
}
