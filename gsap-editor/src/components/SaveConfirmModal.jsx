// src/components/SaveConfirmModal.jsx
// Modal shown after saving to DB — asks user if they want to download the JSON file.

import React from 'react'
import ReactDOM from 'react-dom'
import { ui } from '../theme/uiTheme.js'

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
        <div style={{ fontSize: 40, marginBottom: 12, textAlign: 'center' }}>💾</div>

        <h2 style={titleStyle}>Saved to Database</h2>

        <p style={msgStyle}>
          <span style={{ color: ui.accent, fontWeight: 600 }}>&quot;{shapeName}&quot;</span>{' '}
          has been saved to the database successfully.
          <br />
          Do you also want to download the JSON file?
        </p>

        <div style={btnRowStyle}>
          <button type="button" style={btnSecondaryStyle} onClick={onClose}>
            No, thanks
          </button>
          <button type="button" style={btnPrimaryStyle} onClick={onDownload}>
            ⬇ Download JSON
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

const backdropStyle = {
  position       : 'fixed',
  inset          : 0,
  background     : 'rgba(15, 23, 42, 0.35)',
  display        : 'flex',
  alignItems     : 'center',
  justifyContent : 'center',
  zIndex         : 99998,
  backdropFilter : 'blur(6px)',
}

const modalStyle = {
  background   : ui.bgElevated,
  border       : `1px solid ${ui.border}`,
  borderRadius : 16,
  padding      : '32px 36px',
  maxWidth     : 420,
  width        : '90%',
  boxShadow    : ui.shadowLg,
  animation    : 'modal-in 0.2s ease',
}

const titleStyle = {
  margin         : '0 0 12px',
  fontSize       : 20,
  fontWeight     : 700,
  color          : ui.text,
  textAlign      : 'center',
}

const msgStyle = {
  margin      : '0 0 24px',
  fontSize    : 14,
  color       : ui.textMuted,
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
  borderRadius : 10,
  fontSize     : 14,
  fontWeight   : 600,
  cursor       : 'pointer',
  transition   : 'opacity 0.15s, filter 0.15s',
}

const btnPrimaryStyle = {
  ...btnBase,
  background : `linear-gradient(135deg, ${ui.accent}, #0891b2)`,
  color      : '#ffffff',
  border     : 'none',
}

const btnSecondaryStyle = {
  ...btnBase,
  background : ui.bgPanel,
  border     : `1px solid ${ui.borderStrong}`,
  color      : ui.textSecondary,
}
