import React from 'react'
import { ui } from '../theme/uiTheme.js'

export default function Toolbar({ editorMode, onModeSwitch, canSwitchToParam, switchError }) {
  const isDraw = editorMode === 'draw'

  return (
    <div style={toolbarStyle}>
      <button
        type="button"
        style={{
          ...modeBtnStyle,
          ...(isDraw ? modeBtnActiveStyle : {}),
        }}
        onClick={() => onModeSwitch('draw')}
      >
        <span style={{ fontSize: 16 }}>✏</span>
        <span>Draw</span>
      </button>

      <div style={{ position: 'relative' }}>
        <button
          type="button"
          style={{
            ...modeBtnStyle,
            ...(!isDraw ? modeBtnActiveParamStyle : {}),
            opacity: (!isDraw || canSwitchToParam) ? 1 : 0.5,
            cursor: (!isDraw || canSwitchToParam) ? 'pointer' : 'not-allowed',
          }}
          onClick={() => {
            if (canSwitchToParam || !isDraw) {
              onModeSwitch('parameter')
            }
          }}
          title={!canSwitchToParam && isDraw ? switchError : 'Switch to Parameter Mode'}
        >
          <span style={{ fontSize: 16 }}>⚙</span>
          <span>Parameters</span>
        </button>
        {!canSwitchToParam && isDraw && switchError && (
          <div style={errorTooltipStyle}>
            {switchError}
          </div>
        )}
      </div>

      <div style={modeDividerStyle} />

      <div style={modeIndicatorStyle}>
        <span style={{
          width: 10,
          height: 10,
          borderRadius: '50%',
          background: isDraw ? ui.accent : ui.warn,
          display: 'inline-block',
          marginRight: 8,
        }} />
        <span style={{ fontSize: 13, fontWeight: 600, color: isDraw ? ui.accent : ui.warn }}>
          {isDraw ? 'DRAW MODE' : 'PARAMETER MODE'}
        </span>
      </div>
    </div>
  )
}

const toolbarStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '6px 10px',
  background: ui.bgPanel,
  borderRadius: 10,
  marginLeft: 8,
  border: `1px solid ${ui.border}`,
  boxShadow: ui.shadow,
}

const modeBtnStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '6px 14px',
  background: 'transparent',
  border: '1px solid transparent',
  borderRadius: 8,
  color: ui.textMuted,
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
  transition: 'all 0.15s',
}

const modeBtnActiveStyle = {
  background: ui.accentSoft,
  border: `1px solid ${ui.accentBorder}`,
  color: ui.accent,
}

const modeBtnActiveParamStyle = {
  background: ui.warnSoft,
  border: `1px solid ${ui.warn}`,
  color: ui.warn,
}

const modeDividerStyle = {
  width: 1,
  height: 24,
  background: ui.borderStrong,
  margin: '0 4px',
}

const modeIndicatorStyle = {
  display: 'flex',
  alignItems: 'center',
  padding: '0 10px',
}

const errorTooltipStyle = {
  position: 'absolute',
  top: '100%',
  left: '50%',
  transform: 'translateX(-50%)',
  padding: '8px 12px',
  background: ui.dangerSoft,
  border: `1px solid ${ui.danger}`,
  borderRadius: 8,
  color: ui.danger,
  fontSize: 13,
  whiteSpace: 'nowrap',
  zIndex: 10001,
  marginTop: 6,
  pointerEvents: 'none',
  boxShadow: ui.shadow,
}
