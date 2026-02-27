import React from 'react'

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
          background: isDraw ? '#7fffd4' : '#ff8844',
          display: 'inline-block',
          marginRight: 8,
        }} />
        <span style={{ fontSize: 13, fontWeight: 600, color: isDraw ? '#7fffd4' : '#ff8844' }}>
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
  background: 'rgba(40, 46, 52, 0.9)',
  borderRadius: 8,
  marginLeft: 8,
  border: '1px solid #3a4149',
}

const modeBtnStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '6px 14px',
  background: 'transparent',
  border: '1px solid transparent',
  borderRadius: 6,
  color: '#9ca3af',
  fontSize: 15,
  fontWeight: 600,
  cursor: 'pointer',
  transition: 'all 0.15s',
}

const modeBtnActiveStyle = {
  background: 'rgba(0, 255, 212, 0.12)',
  border: '1px solid #7fffd4',
  color: '#7fffd4',
}

const modeBtnActiveParamStyle = {
  background: 'rgba(255, 136, 68, 0.12)',
  border: '1px solid #ff8844',
  color: '#ff8844',
}

const modeDividerStyle = {
  width: 1,
  height: 24,
  background: '#4b5563',
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
  background: '#3b1f1f',
  border: '1px solid #dc2626',
  borderRadius: 6,
  color: '#fca5a5',
  fontSize: 13,
  whiteSpace: 'nowrap',
  zIndex: 10001,
  marginTop: 6,
  pointerEvents: 'none',
  boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
}
