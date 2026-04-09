import React from 'react'
import { ui } from '../theme/uiTheme.js'

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
        Snap: <span style={{ color: snapStatus !== 'None' ? ui.accent : ui.textSubtle }}>{snapStatus}</span>
      </span>
      <span style={sep}>|</span>
      <span style={itemStyle}>
        Tool: <span style={{ color: ui.blue }}>{activeTool}</span>
      </span>
      <span style={sep}>|</span>
      <span style={itemStyle}>Edges: {edgeCount}</span>

      {isParamMode && (
        <>
          <span style={sep}>|</span>
          <span style={itemStyle}>
            Params: <span style={{ color: ui.warn }}>{parameterCount}</span>
          </span>
          <span style={sep}>|</span>
          <span style={itemStyle}>
            Points: <span style={{ color: pointsAssigned === totalPoints && totalPoints > 0 ? ui.success : '#ca8a04' }}>
              {pointsAssigned}/{totalPoints}
            </span>
          </span>
        </>
      )}

      <span style={{ flex: 1 }} />

      {isParamMode && (
        <span style={{ color: ui.warn, fontSize: 13, fontWeight: 600, marginRight: 12 }}>
          PARAMETER MODE
        </span>
      )}

      <span style={{ color: ui.accent, fontSize: 14 }}>{toolStatus}</span>
    </footer>
  )
}

const barStyle = {
  height: 34,
  background: ui.bgSurface,
  color: ui.textMuted,
  fontSize: 13,
  display: 'flex',
  alignItems: 'center',
  padding: '0 16px',
  borderTop: `1px solid ${ui.border}`,
  zIndex: 20,
  userSelect: 'none',
  flexShrink: 0,
  fontFamily: 'ui-monospace, monospace',
  boxShadow: '0 -1px 0 rgba(255,255,255,0.8) inset',
}

const itemStyle = { marginRight: 0 }
const sep = { margin: '0 10px', color: ui.borderStrong }
