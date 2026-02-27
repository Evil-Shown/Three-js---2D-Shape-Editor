import React, { useRef, useEffect, useState, useCallback } from 'react'
import { SceneManager } from '../three/SceneManager'
import { GeometryStore } from '../store/GeometryStore'
import { CoordinateEngine } from '../core/CoordinateEngine'
import { CommandHistory } from '../core/CommandHistory'
import { SnapEngine } from '../snap/SnapEngine'
import { ConstraintEngine } from '../constraints/ConstraintEngine'
import { ToolManager } from '../tools/ToolManager'
import { PreviewLayer } from '../three/PreviewLayer'
import { AnnotationLayer } from '../render/AnnotationLayer'
import { GridRenderer } from '../render/GridRenderer'
import { ExportService } from '../export/ExportService'
import { bus } from '../core/EventBus.js'

import { SelectTool } from '../tools/SelectTool'
import { LineTool } from '../tools/LineTool'
import { ArcTool } from '../tools/ArcTool'
import { RectangleTool } from '../tools/RectangleTool'
import { CircleTool } from '../tools/CircleTool'
import { MoveTool } from '../tools/MoveTool'
import { TrimTool } from '../tools/TrimTool'
import { OffsetTool } from '../tools/OffsetTool'
import { MeasureTool } from '../tools/MeasureTool'
import { DimensionTool } from '../tools/DimensionTool'

const TOOL_DEFS = [
  { key: 'select',    icon: '⇱', label: 'Select',    shortcut: 'S', group: 'edit' },
  { key: 'line',      icon: '╱', label: 'Line',      shortcut: 'L', group: 'draw' },
  { key: 'arc',       icon: '◠', label: 'Arc',       shortcut: 'A', group: 'draw' },
  { key: 'rectangle', icon: '▭', label: 'Rectangle', shortcut: 'R', group: 'draw' },
  { key: 'circle',    icon: '○', label: 'Circle',    shortcut: 'C', group: 'draw' },
  { key: 'move',      icon: '✥', label: 'Move',      shortcut: 'M', group: 'edit' },
  { key: 'trim',      icon: '✂', label: 'Trim',      shortcut: 'T', group: 'edit' },
  { key: 'offset',    icon: '⟺', label: 'Offset',   shortcut: 'O', group: 'edit' },
  { key: 'measure',   icon: '📏', label: 'Measure',  shortcut: 'Q', group: 'info' },
  { key: 'dimension', icon: '↔', label: 'Dimension', shortcut: 'D', group: 'info' },
]

export default function Editor() {
  const canvasRef = useRef(null)
  const commandRef = useRef(null)
  const enginesRef = useRef(null)

  const [activeTool, setActiveTool] = useState('select')
  const [coordStatus, setCoordStatus] = useState('X: 0.00  Y: 0.00')
  const [snapStatus, setSnapStatus] = useState('None')
  const [toolStatus, setToolStatus] = useState('')
  const [constraintStatus, setConstraintStatus] = useState('')
  const [measureResult, setMeasureResult] = useState(null)
  const [selectedEdges, setSelectedEdges] = useState([])
  const [edgeCount, setEdgeCount] = useState(0)
  const [historyInfo, setHistoryInfo] = useState({ canUndo: false, canRedo: false })
  const [commandHistory, setCommandHistory] = useState([])
  const [cmdHistoryIdx, setCmdHistoryIdx] = useState(-1)
  const [menuOpen, setMenuOpen] = useState(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const scene = new SceneManager(canvas)
    const store = new GeometryStore()
    const coord = new CoordinateEngine(scene.camera, canvas)
    const history = new CommandHistory()
    const snap = new SnapEngine(coord, store)
    const constraint = new ConstraintEngine(coord)
    const meshMap = new Map()

    const previewLayer = new PreviewLayer(scene.scene, coord)
    const annotationLayer = new AnnotationLayer(scene.scene)
    const gridRenderer = new GridRenderer(scene.scene, coord)

    const deps = {
      scene: scene.scene,
      store, coord, snap, constraint, history,
      canvas, meshMap, previewLayer, annotationLayer
    }

    const tm = new ToolManager(deps)

    // Instantiate and register all tools
    const selectTool = new SelectTool(deps)
    const lineTool = new LineTool(deps)
    const arcTool = new ArcTool(deps)
    const rectTool = new RectangleTool(deps)
    const circleTool = new CircleTool(deps)
    const moveTool = new MoveTool(deps)
    const trimTool = new TrimTool(deps)
    const offsetTool = new OffsetTool(deps)
    const measureTool = new MeasureTool(deps)
    const dimensionTool = new DimensionTool(deps)

    tm.register('select', selectTool)
    tm.register('line', lineTool)
    tm.register('arc', arcTool)
    tm.register('rectangle', rectTool)
    tm.register('circle', circleTool)
    tm.register('move', moveTool)
    tm.register('trim', trimTool)
    tm.register('offset', offsetTool)
    tm.register('measure', measureTool)
    tm.register('dimension', dimensionTool)

    moveTool.toolMgr = tm

    tm.setActive('select')

    gridRenderer.render()

    enginesRef.current = {
      sceneManager: scene, threeScene: scene.scene,
      store, coord, history, snap, constraint,
      meshMap, previewLayer, annotationLayer, gridRenderer,
      tm, selectTool, offsetTool, arcTool, exportService: new ExportService(store)
    }

    // --- Event subscriptions ---
    const unsubs = []

    unsubs.push(bus.on('toolStatus', msg => setToolStatus(msg)))

    unsubs.push(bus.on('cursorMove', ({ x, y }) => {
      setCoordStatus(`X: ${x.toFixed(2)}  Y: ${y.toFixed(2)}`)
    }))

    unsubs.push(bus.on('snapChanged', info => {
      if (info.type === 'None') setSnapStatus('None')
      else setSnapStatus(info.type + (info.angle != null ? ` ${info.angle}°` : ''))
    }))

    unsubs.push(bus.on('constraintChanged', info => {
      setConstraintStatus(info.status || '')
    }))

    unsubs.push(bus.on('toolChanged', ({ name }) => {
      setActiveTool(name)
    }))

    unsubs.push(bus.on('geometryChanged', () => {
      setEdgeCount(store.getEdgeCount())
      gridRenderer.render()
    }))

    unsubs.push(bus.on('selectionChanged', ({ edges }) => {
      setSelectedEdges(edges || [])
    }))

    unsubs.push(bus.on('measureResult', result => {
      setMeasureResult(result)
    }))

    unsubs.push(bus.on('historyChanged', info => {
      setHistoryInfo(info)
    }))

    unsubs.push(bus.on('viewChanged', () => {
      gridRenderer.render()
    }))

    unsubs.push(bus.on('zoomToFit', () => {
      const edges = store.getEdges()
      if (edges.length === 0) return
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
      for (const e of edges) {
        if (e.type === 'line') {
          minX = Math.min(minX, e.start.x, e.end.x)
          maxX = Math.max(maxX, e.start.x, e.end.x)
          minY = Math.min(minY, e.start.y, e.end.y)
          maxY = Math.max(maxY, e.start.y, e.end.y)
        } else if (e.type === 'arc') {
          minX = Math.min(minX, e.center.x - e.radius)
          maxX = Math.max(maxX, e.center.x + e.radius)
          minY = Math.min(minY, e.center.y - e.radius)
          maxY = Math.max(maxY, e.center.y + e.radius)
        }
      }
      if (minX === Infinity) return
      coord.zoomToFit({ left: minX, right: maxX, top: maxY, bottom: minY })
    }))

    // Resize
    const resizeObs = new ResizeObserver(entries => {
      const entry = entries[0]
      if (!entry) return
      const { width, height } = entry.contentRect
      if (width > 0 && height > 0) {
        scene.resize(width, height)
        coord._applyCamera()
        gridRenderer.render()
      }
    })
    resizeObs.observe(canvas.parentElement)

    return () => {
      unsubs.forEach(fn => fn())
      resizeObs.disconnect()
      tm.dispose()
      constraint.dispose()
      coord.dispose()
      scene.dispose()
    }
  }, [])

  // Tool switching from buttons
  const switchTool = useCallback((name) => {
    if (enginesRef.current) {
      enginesRef.current.tm.setActive(name)
    }
  }, [])

  // Command input handler
  const handleCommand = useCallback((e) => {
    if (e.key === 'Escape') {
      e.target.blur()
      return
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setCommandHistory(prev => {
        setCmdHistoryIdx(idx => {
          const next = Math.min(idx + 1, prev.length - 1)
          if (prev[next]) e.target.value = prev[next]
          return next
        })
        return prev
      })
      return
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setCmdHistoryIdx(idx => {
        const next = Math.max(idx - 1, -1)
        setCommandHistory(prev => {
          e.target.value = next >= 0 ? (prev[next] || '') : ''
          return prev
        })
        return next
      })
      return
    }

    if (e.key !== 'Enter') return
    const text = e.target.value.trim()
    if (!text) return

    e.target.value = ''
    setCmdHistoryIdx(-1)
    setCommandHistory(prev => [text, ...prev].slice(0, 50))

    const eng = enginesRef.current
    if (!eng) return

    const parsed = eng.coord.parseInput(text)
    if (!parsed) {
      setToolStatus(`Unknown command: ${text}`)
      return
    }

    if (parsed.constraint) {
      const applied = eng.constraint.setFromInput(parsed)
      if (applied) setToolStatus(`Constraint set: ${eng.constraint.status()}`)

      if (parsed.constraint === 'length' && eng.tm.activeName === 'offset') {
        eng.offsetTool.applyOffset(parsed.value)
      }
      return
    }

    // It's a coordinate — send to active tool
    const tool = eng.tm.activeTool
    if (tool && tool.acceptPoint) {
      tool.acceptPoint(parsed)
    }
  }, [])

  // --- Menu actions ---
  const menuAction = useCallback((action) => {
    setMenuOpen(null)
    const eng = enginesRef.current
    if (!eng) return

    switch (action) {
      case 'new':
        eng.store.clear()
        eng.history.clear()
        eng.meshMap.forEach((m) => { eng.threeScene.remove(m); m.geometry?.dispose(); m.material?.dispose() })
        eng.meshMap.clear()
        eng.annotationLayer.clear()
        setEdgeCount(0)
        setSelectedEdges([])
        bus.emit('geometryChanged')
        break
      case 'export':
        eng.exportService.exportJSON()
        break
      case 'undo':
        eng.history.undo()
        bus.emit('geometryChanged')
        break
      case 'redo':
        eng.history.redo()
        bus.emit('geometryChanged')
        break
      case 'selectAll':
        eng.tm.setActive('select')
        setTimeout(() => eng.selectTool.selectAll(), 0)
        break
      case 'zoomFit':
        bus.emit('zoomToFit')
        break
      case 'zoomIn':
        eng.coord.zoomBy(1.5)
        break
      case 'zoomOut':
        eng.coord.zoomBy(0.667)
        break
      case 'toggleArcMode':
        eng.arcTool.toggleMode()
        break
    }
  }, [])

  // --- Property panel content ---
  const renderPropertyPanel = () => {
    if (measureResult) {
      return (
        <div style={{ fontSize: 13, color: '#ccc' }}>
          <div style={propHeaderStyle}>Measurement</div>
          <PropRow label="Distance" value={measureResult.distance + ' mm'} />
          <PropRow label="Angle" value={measureResult.angle + '°'} />
          <PropRow label="ΔX" value={measureResult.dx + ' mm'} />
          <PropRow label="ΔY" value={measureResult.dy + ' mm'} />
          <PropRow label="From" value={`(${measureResult.from.x.toFixed(2)}, ${measureResult.from.y.toFixed(2)})`} />
          <PropRow label="To" value={`(${measureResult.to.x.toFixed(2)}, ${measureResult.to.y.toFixed(2)})`} />
        </div>
      )
    }

    if (selectedEdges.length === 1) {
      const e = selectedEdges[0]
      if (e.type === 'line') {
        const len = Math.hypot(e.end.x - e.start.x, e.end.y - e.start.y)
        const ang = Math.atan2(e.end.y - e.start.y, e.end.x - e.start.x) * 180 / Math.PI
        return (
          <div style={{ fontSize: 13, color: '#ccc' }}>
            <div style={propHeaderStyle}>Line Edge</div>
            <PropRow label="Start X" value={e.start.x.toFixed(4)} />
            <PropRow label="Start Y" value={e.start.y.toFixed(4)} />
            <PropRow label="End X" value={e.end.x.toFixed(4)} />
            <PropRow label="End Y" value={e.end.y.toFixed(4)} />
            <PropRow label="Length" value={len.toFixed(4) + ' mm'} />
            <PropRow label="Angle" value={ang.toFixed(2) + '°'} />
          </div>
        )
      }
      if (e.type === 'arc') {
        const sweep = Math.abs(e.endAngle - e.startAngle)
        const arcLen = e.radius * sweep
        return (
          <div style={{ fontSize: 13, color: '#ccc' }}>
            <div style={propHeaderStyle}>Arc Edge</div>
            <PropRow label="Center X" value={e.center.x.toFixed(4)} />
            <PropRow label="Center Y" value={e.center.y.toFixed(4)} />
            <PropRow label="Radius" value={e.radius.toFixed(4) + ' mm'} />
            <PropRow label="Start ∠" value={(e.startAngle * 180 / Math.PI).toFixed(2) + '°'} />
            <PropRow label="End ∠" value={(e.endAngle * 180 / Math.PI).toFixed(2) + '°'} />
            <PropRow label="Sweep" value={(sweep * 180 / Math.PI).toFixed(2) + '°'} />
            <PropRow label="Arc Length" value={arcLen.toFixed(4) + ' mm'} />
          </div>
        )
      }
    }

    if (selectedEdges.length > 1) {
      return (
        <div style={{ fontSize: 13, color: '#ccc' }}>
          <div style={propHeaderStyle}>Selection</div>
          <PropRow label="Edges" value={selectedEdges.length} />
          <PropRow label="Lines" value={selectedEdges.filter(e => e.type === 'line').length} />
          <PropRow label="Arcs" value={selectedEdges.filter(e => e.type === 'arc').length} />
        </div>
      )
    }

    return (
      <div style={{ fontSize: 13, color: '#888' }}>
        <div style={propHeaderStyle}>Shape Info</div>
        <PropRow label="Edges" value={edgeCount} />
        <div style={{ marginTop: 16, color: '#555', fontSize: 12, lineHeight: 1.6 }}>
          Click an edge with Select tool to see its properties.
        </div>
      </div>
    )
  }

  return (
    <div style={rootStyle}>
      {/* Menu Bar */}
      <nav style={menuBarStyle}>
        <div style={{ marginRight: 28, fontWeight: 700, fontSize: 16, letterSpacing: 1.5, color: '#7fffd4' }}>ShapeCAD</div>
        <MenuBtn label="File" open={menuOpen === 'file'} onClick={() => setMenuOpen(menuOpen === 'file' ? null : 'file')}>
          <MenuItem label="New" shortcut="—" onClick={() => menuAction('new')} />
          <MenuItem label="Export JSON" shortcut="—" onClick={() => menuAction('export')} />
        </MenuBtn>
        <MenuBtn label="Edit" open={menuOpen === 'edit'} onClick={() => setMenuOpen(menuOpen === 'edit' ? null : 'edit')}>
          <MenuItem label="Undo" shortcut="Ctrl+Z" onClick={() => menuAction('undo')} disabled={!historyInfo.canUndo} />
          <MenuItem label="Redo" shortcut="Ctrl+Y" onClick={() => menuAction('redo')} disabled={!historyInfo.canRedo} />
          <MenuItem label="Select All" shortcut="Ctrl+A" onClick={() => menuAction('selectAll')} />
        </MenuBtn>
        <MenuBtn label="View" open={menuOpen === 'view'} onClick={() => setMenuOpen(menuOpen === 'view' ? null : 'view')}>
          <MenuItem label="Zoom to Fit" shortcut="F" onClick={() => menuAction('zoomFit')} />
          <MenuItem label="Zoom In" shortcut="+" onClick={() => menuAction('zoomIn')} />
          <MenuItem label="Zoom Out" shortcut="-" onClick={() => menuAction('zoomOut')} />
        </MenuBtn>
        <MenuBtn label="Tools" open={menuOpen === 'tools'} onClick={() => setMenuOpen(menuOpen === 'tools' ? null : 'tools')}>
          {TOOL_DEFS.map(t => (
            <MenuItem key={t.key} label={t.label} shortcut={t.shortcut} onClick={() => { setMenuOpen(null); switchTool(t.key) }} />
          ))}
          <div style={{ borderTop: '1px solid #444', margin: '4px 0' }} />
          <MenuItem label="Toggle Arc Mode" shortcut="—" onClick={() => menuAction('toggleArcMode')} />
        </MenuBtn>
      </nav>

      {/* Main area */}
      <div style={mainAreaStyle}>
        {/* Toolbox */}
        <aside style={toolboxStyle}>
          {['draw', 'edit', 'info'].map(group => (
            <React.Fragment key={group}>
              <div style={toolGroupLabel}>{group.toUpperCase()}</div>
              {TOOL_DEFS.filter(t => t.group === group).map(t => (
                <ToolBtn
                  key={t.key}
                  icon={t.icon}
                  label={t.label}
                  shortcut={t.shortcut}
                  active={activeTool === t.key}
                  onClick={() => switchTool(t.key)}
                />
              ))}
            </React.Fragment>
          ))}
        </aside>

        {/* Canvas */}
        <div style={canvasAreaStyle}>
          <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
        </div>

        {/* Property Panel */}
        <aside style={propertyPanelStyle}>
          <div style={{ color: '#7fffd4', fontWeight: 700, fontSize: 14, marginBottom: 12, letterSpacing: 0.5 }}>PROPERTIES</div>
          {renderPropertyPanel()}
        </aside>
      </div>

      {/* Command Input */}
      <div style={commandInputStyle}>
        <span style={{ color: '#7fffd4', fontWeight: 600, marginRight: 10, fontSize: 13, userSelect: 'none' }}>CMD:</span>
        <input
          ref={commandRef}
          type="text"
          style={cmdInputFieldStyle}
          placeholder="Type coordinates (100,80) or constraints (L150, A45, R75)..."
          onKeyDown={handleCommand}
        />
        {constraintStatus && (
          <span style={{ marginLeft: 12, color: '#ff8844', fontSize: 12, fontWeight: 600 }}>{constraintStatus}</span>
        )}
      </div>

      {/* Status Bar */}
      <footer style={statusBarStyle}>
        <span style={statusItemStyle}>{coordStatus}</span>
        <span style={statusSep}>|</span>
        <span style={statusItemStyle}>Snap: <span style={{ color: snapStatus !== 'None' ? '#7fffd4' : '#666' }}>{snapStatus}</span></span>
        <span style={statusSep}>|</span>
        <span style={statusItemStyle}>Tool: <span style={{ color: '#88aaff' }}>{activeTool}</span></span>
        <span style={statusSep}>|</span>
        <span style={statusItemStyle}>Edges: {edgeCount}</span>
        <span style={{ flex: 1 }} />
        <span style={{ color: '#7fffd4', fontSize: 12 }}>{toolStatus}</span>
      </footer>

      {/* Click-away for menus */}
      {menuOpen && <div style={menuBackdropStyle} onClick={() => setMenuOpen(null)} />}
    </div>
  )
}

// --- Sub-components ---

function ToolBtn({ icon, label, shortcut, active, onClick }) {
  return (
    <button
      onClick={onClick}
      title={`${label} (${shortcut})`}
      style={{
        width: 40, height: 40, margin: '2px 0',
        borderRadius: 6,
        border: active ? '2px solid #7fffd4' : '2px solid transparent',
        background: active ? '#1a3328' : 'transparent',
        color: active ? '#7fffd4' : '#aaa',
        fontSize: 18, fontWeight: 700,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        position: 'relative', cursor: 'pointer',
        transition: 'all 0.15s',
      }}
    >
      {icon}
      <span style={{
        position: 'absolute', bottom: 1, right: 3,
        fontSize: 8, color: '#555', fontWeight: 400
      }}>{shortcut}</span>
    </button>
  )
}

function MenuBtn({ label, open, onClick, children }) {
  return (
    <div style={{ position: 'relative', marginRight: 4 }}>
      <div
        onClick={onClick}
        style={{
          padding: '4px 12px', cursor: 'pointer', borderRadius: 4,
          background: open ? '#333' : 'transparent',
          color: open ? '#fff' : '#bbb',
          fontSize: 13, userSelect: 'none',
        }}
      >{label}</div>
      {open && (
        <div style={menuDropdownStyle}>
          {children}
        </div>
      )}
    </div>
  )
}

function MenuItem({ label, shortcut, onClick, disabled }) {
  return (
    <div
      onClick={disabled ? undefined : onClick}
      style={{
        padding: '6px 16px', display: 'flex', justifyContent: 'space-between',
        cursor: disabled ? 'default' : 'pointer', fontSize: 13,
        color: disabled ? '#555' : '#ccc', gap: 24,
        background: 'transparent', borderRadius: 3,
      }}
      onMouseEnter={e => { if (!disabled) e.target.style.background = '#333' }}
      onMouseLeave={e => { e.target.style.background = 'transparent' }}
    >
      <span>{label}</span>
      <span style={{ color: '#666', fontSize: 11 }}>{shortcut}</span>
    </div>
  )
}

function PropRow({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderBottom: '1px solid #2a2d30' }}>
      <span style={{ color: '#888' }}>{label}</span>
      <span style={{ color: '#ddd', fontFamily: 'monospace', fontSize: 12 }}>{value}</span>
    </div>
  )
}

// --- Styles ---

const rootStyle = {
  width: '100vw', height: '100vh',
  display: 'flex', flexDirection: 'column',
  background: '#181a1b', fontFamily: "'Inter', system-ui, sans-serif",
  overflow: 'hidden', color: '#e0e3e6',
}

const menuBarStyle = {
  height: 36, background: '#1e2124',
  display: 'flex', alignItems: 'center',
  padding: '0 16px', borderBottom: '1px solid #2a2d30',
  zIndex: 100, userSelect: 'none', flexShrink: 0,
}

const mainAreaStyle = {
  flex: 1, display: 'flex', flexDirection: 'row',
  minHeight: 0, minWidth: 0,
}

const toolboxStyle = {
  width: 52, background: '#1e2124',
  borderRight: '1px solid #2a2d30',
  display: 'flex', flexDirection: 'column', alignItems: 'center',
  paddingTop: 4, zIndex: 10, overflowY: 'auto', flexShrink: 0,
}

const toolGroupLabel = {
  fontSize: 9, color: '#555', fontWeight: 700, letterSpacing: 1,
  marginTop: 8, marginBottom: 2, userSelect: 'none',
}

const propertyPanelStyle = {
  width: 240, background: '#1e2124',
  borderLeft: '1px solid #2a2d30',
  display: 'flex', flexDirection: 'column',
  padding: '12px 14px', zIndex: 10, overflowY: 'auto', flexShrink: 0,
}

const propHeaderStyle = {
  color: '#7fffd4', fontWeight: 600, fontSize: 12, marginBottom: 8,
  paddingBottom: 4, borderBottom: '1px solid #2a2d30', letterSpacing: 0.5,
}

const canvasAreaStyle = {
  flex: 1, position: 'relative',
  minWidth: 0, minHeight: 0,
  background: '#111', display: 'flex',
}

const statusBarStyle = {
  height: 26, background: '#1a1c1e',
  color: '#888', fontSize: 12,
  display: 'flex', alignItems: 'center',
  padding: '0 12px', borderTop: '1px solid #2a2d30',
  zIndex: 20, userSelect: 'none', flexShrink: 0,
  fontFamily: 'monospace',
}

const statusItemStyle = { marginRight: 0 }
const statusSep = { margin: '0 10px', color: '#333' }

const commandInputStyle = {
  height: 30, background: '#1a1c1e',
  borderTop: '1px solid #2a2d30',
  display: 'flex', alignItems: 'center',
  padding: '0 12px', zIndex: 20, flexShrink: 0,
}

const cmdInputFieldStyle = {
  flex: 1, background: 'transparent', border: 'none',
  color: '#fff', fontSize: 13, outline: 'none',
  fontFamily: 'monospace',
}

const menuDropdownStyle = {
  position: 'absolute', top: '100%', left: 0,
  background: '#252830', border: '1px solid #3a3d42',
  borderRadius: 6, padding: '4px 0', minWidth: 200,
  zIndex: 200, boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
}

const menuBackdropStyle = {
  position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
  zIndex: 50,
}
