import React from 'react'

export default function StatusBar({
  coordStatus,
  snapStatus,
  activeTool,
  edgeCount,
  toolStatus,
  editorMode,
  parameterCount,
  pointsAssigned,
  totalPoints,
}) {
  const isParamMode = editorMode === 'parameter'

  return (
    <footer style={barStyle}>
      <span style={itemStyle}>{coordStatus}</span>
      <span style={sep}>|</span>
      <span style={itemStyle}>
        Snap: <span style={{ color: snapStatus !== 'None' ? '#7fffd4' : '#666' }}>{snapStatus}</span>
      </span>
      <span style={sep}>|</span>
      <span style={itemStyle}>
        Tool: <span style={{ color: '#88aaff' }}>{activeTool}</span>
      </span>
      <span style={sep}>|</span>
      <span style={itemStyle}>Edges: {edgeCount}</span>

      {isParamMode && (
        <>
          <span style={sep}>|</span>
          <span style={itemStyle}>
            Params: <span style={{ color: '#ff8844' }}>{parameterCount}</span>
          </span>
          <span style={sep}>|</span>
          <span style={itemStyle}>
            Points: <span style={{ color: pointsAssigned === totalPoints && totalPoints > 0 ? '#44cc66' : '#cccc44' }}>
              {pointsAssigned}/{totalPoints}
            </span>
          </span>
        </>
      )}

      <span style={{ flex: 1 }} />

      {isParamMode && (
        <span style={{ color: '#ff8844', fontSize: 13, fontWeight: 600, marginRight: 12 }}>
          PARAMETER MODE
        </span>
      )}

      <span style={{ color: '#7fffd4', fontSize: 14 }}>{toolStatus}</span>
    </footer>
  )
}

const barStyle = {
  height: 30,
  background: '#1a1c1e',
  color: '#9ca3af',
  fontSize: 14,
  display: 'flex',
  alignItems: 'center',
  padding: '0 16px',
  borderTop: '1px solid #2a2d30',
  zIndex: 20,
  userSelect: 'none',
  flexShrink: 0,
  fontFamily: 'monospace',
}

const itemStyle = { marginRight: 0 }
const sep = { margin: '0 10px', color: '#333' }
