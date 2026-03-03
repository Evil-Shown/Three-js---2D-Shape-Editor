import React, { useRef, useEffect, useState, useCallback } from 'react'
import ReactDOM from 'react-dom'
import * as THREE from 'three'
import { SceneManager } from '../three/SceneManager'
import { GeometryStore } from '../store/GeometryStore'
import { ParameterStore } from '../store/ParameterStore'
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
import { PathConnectivity } from '../core/PathConnectivity.js'
import { ExpressionBuilder } from '../parameters/ExpressionBuilder'
import { AutoAssignService } from '../parameters/AutoAssignService'
import { GeometryAnalyzer } from '../parameters/GeometryAnalyzer'

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
import { EdgeTagger } from '../tools/EdgeTagger'
import { PointTagger } from '../tools/PointTagger'
import { RoundedRectTool } from '../tools/RoundedRectTool'
import { SketchTool } from '../tools/SketchTool'

import Toolbar from './Toolbar'
import ParameterPanel from './ParameterPanel'
import DetectedDimensionsPanel from './DetectedDimensionsPanel'
import StatusBar from './StatusBar'
import { Toaster, toast } from './Toast'
import SaveConfirmModal from './SaveConfirmModal'
import { saveShape, getNextShapeNumber } from '../api/shapesApi'

const TOOL_DEFS = [
  { key: 'select',      icon: '⇱', label: 'Select',      shortcut: 'S', group: 'edit' },
  { key: 'sketch',      icon: '✎', label: 'Sketch',      shortcut: 'K', group: 'draw' },
  { key: 'line',        icon: '╱', label: 'Line',        shortcut: 'L', group: 'draw' },
  { key: 'arc',         icon: '◠', label: 'Arc',         shortcut: 'A', group: 'draw' },
  { key: 'rectangle',   icon: '▭', label: 'Rect',        shortcut: 'R', group: 'draw' },
  { key: 'roundedRect', icon: '▢', label: 'Round Rect',  shortcut: 'G', group: 'draw' },
  { key: 'circle',      icon: '○', label: 'Circle',      shortcut: 'C', group: 'draw' },
  { key: 'move',        icon: '✥', label: 'Move',        shortcut: 'M', group: 'edit' },
  { key: 'trim',        icon: '✂', label: 'Trim',        shortcut: 'T', group: 'edit' },
  { key: 'offset',      icon: '⟺', label: 'Offset',     shortcut: 'O', group: 'edit' },
  { key: 'measure',     icon: '📏', label: 'Measure',    shortcut: 'Q', group: 'info' },
  { key: 'dimension',   icon: '↔', label: 'Dimension',   shortcut: 'D', group: 'info' },
]

const PARAM_TOOL_DEFS = [
  { key: 'edgeTagger', icon: '🏷', label: 'Tag Edges', shortcut: 'E', group: 'tag' },
  { key: 'pointTagger', icon: '📍', label: 'Tag Points', shortcut: 'P', group: 'tag' },
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

  // --- Parameter Mode state ---
  const [editorMode, setEditorMode] = useState('draw')
  const [canSwitchToParam, setCanSwitchToParam] = useState(false)
  const [switchError, setSwitchError] = useState('')
  const [parameterCount, setParameterCount] = useState(0)
  const [pointsAssigned, setPointsAssigned] = useState(0)
  const [totalPoints, setTotalPoints] = useState(0)
  const [, forceRerender] = useState(0)

  // --- Save-to-DB modal state ---
  const [saveModal, setSaveModal] = useState(null)

  // --- Edge tagger popup state ---
  const [edgePopup, setEdgePopup] = useState(null)

  // --- Detected dimensions panel state ---
  const [showDetectedDims, setShowDetectedDims] = useState(false)
  const [detectedAnalysis, setDetectedAnalysis] = useState(null)
  const autoAssignRef = useRef(new AutoAssignService())

  // --- Point expression popup (floats near clicked point on canvas) ---
  const [pointExpressionPopup, setPointExpressionPopup] = useState(null)
  const [pointExprInputX, setPointExprInputX] = useState('')
  const [pointExprInputY, setPointExprInputY] = useState('')
  const canvasAreaRef = useRef(null)

  const syncNextShapeMetadata = useCallback(async () => {
    const eng = enginesRef.current
    if (!eng) return

    try {
      const { nextShapeNumber, suggestedClassName } = await getNextShapeNumber()
      eng.paramStore.setShapeMetadata({
        shapeNumber: nextShapeNumber,
        className: suggestedClassName || `ShapeTransformer_${nextShapeNumber}`,
      })
    } catch (err) {
      console.warn('Could not fetch next shape number from DB:', err?.message || err)
    }
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const scene = new SceneManager(canvas)
    const store = new GeometryStore()
    const paramStore = new ParameterStore()
    const coord = new CoordinateEngine(scene.camera, canvas)
    const history = new CommandHistory()
    const snap = new SnapEngine(coord, store)
    const constraint = new ConstraintEngine(coord)
    const pathConnectivity = new PathConnectivity(store)
    const meshMap = new Map()

    // Wire PathConnectivity into SnapEngine for close-path snapping
    snap.setPathConnectivity(pathConnectivity)

    const previewLayer = new PreviewLayer(scene.scene, coord)
    const annotationLayer = new AnnotationLayer(scene.scene)
    const gridRenderer = new GridRenderer(scene.scene, coord)

    const deps = {
      scene: scene.scene,
      store, coord, snap, constraint, history,
      canvas, meshMap, previewLayer, annotationLayer,
      paramStore,
    }

    const tm = new ToolManager(deps)

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
    const roundedRectTool = new RoundedRectTool(deps)
    const sketchTool = new SketchTool(deps)
    const edgeTagger = new EdgeTagger(deps)
    const pointTagger = new PointTagger(deps)

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
    tm.register('roundedRect', roundedRectTool)
    tm.register('sketch', sketchTool)
    tm.register('edgeTagger', edgeTagger)
    tm.register('pointTagger', pointTagger)

    moveTool.toolMgr = tm

    tm.setActive('select')

    gridRenderer.render()

    // Auto-assign p0 as trim origin
    paramStore.onChange(() => {
      setParameterCount(paramStore.getParameters().length)
      const allExprs = paramStore.getAllPointExpressions()
      setPointsAssigned(Object.keys(allExprs).length)
    })

    enginesRef.current = {
      sceneManager: scene, threeScene: scene.scene,
      store, paramStore, coord, history, snap, constraint,
      meshMap, previewLayer, annotationLayer, gridRenderer,
      tm, selectTool, offsetTool, arcTool,
      edgeTagger, pointTagger, pathConnectivity,
      exportService: new ExportService(store, paramStore),
    }

    syncNextShapeMetadata()

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

      console.log(`[geometryChanged] ${store.getEdgeCount()} edges in store`)

      // ── Smart auto-connect: progressive weld + almost-closed heal + closing edge ──
      const connectResult = pathConnectivity.smartAutoConnect(20.0)
      if (connectResult.totalWelds > 0) {
        console.log(`[geometryChanged] Smart auto-connect: ${connectResult.totalWelds} fix(es), insertedEdge=${connectResult.insertedEdge}`)
        refreshMeshes(store, meshMap)

        // If a new edge was inserted, create its mesh
        if (connectResult.insertedEdge) {
          const allEdges = store.getEdges()
          for (const edge of allEdges) {
            if (!meshMap.has(edge.id)) {
              if (edge.type === 'line') {
                const pts = [
                  new THREE.Vector3(edge.start.x, edge.start.y, 0),
                  new THREE.Vector3(edge.end.x, edge.end.y, 0),
                ]
                const geo = new THREE.BufferGeometry().setFromPoints(pts)
                const mat = new THREE.LineBasicMaterial({ color: 0xffffff })
                const line = new THREE.Line(geo, mat)
                line.userData.edgeId = edge.id
                scene.scene.add(line)
                meshMap.set(edge.id, line)
              } else if (edge.type === 'arc') {
                const curve = new THREE.EllipseCurve(
                  edge.center.x, edge.center.y,
                  edge.radius, edge.radius,
                  edge.startAngle, edge.endAngle,
                  edge.clockwise, 0
                )
                const arcPts = curve.getPoints(64)
                const geo = new THREE.BufferGeometry().setFromPoints(arcPts)
                const mat = new THREE.LineBasicMaterial({ color: 0xffffff })
                const line = new THREE.Line(geo, mat)
                line.userData.edgeId = edge.id
                scene.scene.add(line)
                meshMap.set(edge.id, line)
              }
            }
          }
        }
      }

      checkShapeClosed(store, pathConnectivity)
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

    unsubs.push(bus.on('edgeTagger:openPopup', (data) => {
      setEdgePopup(data)
    }))

    unsubs.push(bus.on('pointTagger:selectPoint', (data) => {
      setPointExpressionPopup(data)
      const expr = paramStore.getPointExpression(data.pointId)
      setPointExprInputX(expr?.x ?? '')
      setPointExprInputY(expr?.y ?? '')
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

    /**
     * Rebuild meshes for all edges after auto-healing mutated their geometry.
     */
    function refreshMeshes(geoStore, mMap) {
      for (const [id, mesh] of mMap) {
        const edge = geoStore.getEdgeById(id)
        if (!edge) continue
        if (edge.type === 'line') {
          const pts = [
            new THREE.Vector3(edge.start.x, edge.start.y, 0),
            new THREE.Vector3(edge.end.x, edge.end.y, 0)
          ]
          mesh.geometry.dispose()
          mesh.geometry = new THREE.BufferGeometry().setFromPoints(pts)
        } else if (edge.type === 'arc') {
          const curve = new THREE.EllipseCurve(
            edge.center.x, edge.center.y,
            edge.radius, edge.radius,
            edge.startAngle, edge.endAngle,
            edge.clockwise, 0
          )
          const arcPts = curve.getPoints(64)
          mesh.geometry.dispose()
          mesh.geometry = new THREE.BufferGeometry().setFromPoints(arcPts)
        }
      }
    }

    function checkShapeClosed(geoStore, pc) {
      const edges = geoStore.getEdges()
      console.log(`[checkShapeClosed] ${edges.length} edges`)
      if (edges.length < 2) {
        setCanSwitchToParam(false)
        setSwitchError('Draw a closed shape first (rectangle, circle, or connected lines)')
        return
      }

      let result = pc.validate(edges)
      console.log(`[checkShapeClosed] closed=${result.closed}, almostClosed=${result.almostClosed}, diagnostics: ${result.diagnostics}`)

      // ── Auto-fix "almost closed" shapes (small gap between 2 open ends) ──
      if (!result.closed && result.almostClosed && result.gap < 10) {
        console.log(`[checkShapeClosed] Attempting to auto-close gap of ${result.gap.toFixed(4)} mm…`)
        const healed = pc.healAlmostClosed(10.0)
        if (healed) {
          refreshMeshes(geoStore, meshMap)
          // Re-validate after healing
          result = pc.validate(geoStore.getEdges())
          console.log(`[checkShapeClosed] After heal: closed=${result.closed}`)
        }
      }

      if (!result.closed && result.openVertices) {
        result.openVertices.forEach(v => {
          console.log(`  open vertex: (${v.x.toFixed(4)}, ${v.y.toFixed(4)}) degree=${v.degree}`)
        })
      }
      setCanSwitchToParam(result.closed)
      if (result.closed) {
        setSwitchError('')
      } else if (result.almostClosed) {
        setSwitchError(`Almost closed! Gap of ${result.gap.toFixed(2)} — close the last edge to the starting point.`)
      } else {
        setSwitchError(result.diagnostics)
      }

      const builder = new ExpressionBuilder()
      const pts = builder.extractShapePoints(geoStore)
      setTotalPoints(pts.length)
    }

    return () => {
      unsubs.forEach(fn => fn())
      resizeObs.disconnect()
      tm.dispose()
      constraint.dispose()
      coord.dispose()
      scene.dispose()
    }
  }, [syncNextShapeMetadata])

  // --- Mode switching ---
  const handleModeSwitch = useCallback((mode) => {
    const eng = enginesRef.current
    if (!eng) return

    if (mode === 'parameter' && editorMode === 'draw') {
      if (!canSwitchToParam) return

      eng.tm.cancel()
      eng.tm.setActive('pointTagger')

      // Run geometry analysis to detect dimensions automatically
      const analyzer = new GeometryAnalyzer()
      const analysis = analyzer.analyze(eng.store)

      // Show detected dimensions panel if no parameters exist yet
      const existingParams = eng.paramStore.getParameters()
      if (existingParams.length === 0 && analysis.suggestedParams.length > 0) {
        setDetectedAnalysis(analysis)
        setShowDetectedDims(true)
      } else {
        // Auto-fill any missing points with existing parameters
        const autoSvc = new AutoAssignService()
        autoSvc.autoAssignMissing(eng.paramStore, eng.store)
        if (eng.pointTagger) eng.pointTagger.refreshIndicators()
      }

      setEditorMode('parameter')
      setMeasureResult(null)
      setSelectedEdges([])
    } else if (mode === 'draw') {
      if (eng.edgeTagger) eng.edgeTagger.deactivate()
      if (eng.pointTagger) eng.pointTagger.deactivate()
      eng.tm.setActive('select')
      setEditorMode('draw')
      setEdgePopup(null)
      setPointExpressionPopup(null)
    }
  }, [editorMode, canSwitchToParam])

  const switchTool = useCallback((name) => {
    if (enginesRef.current) {
      enginesRef.current.tm.setActive(name)
    }
  }, [])

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
        eng.paramStore.clear()
        syncNextShapeMetadata()
        eng.history.clear()
        eng.meshMap.forEach((m) => { eng.threeScene.remove(m); m.geometry?.dispose(); m.material?.dispose() })
        eng.meshMap.clear()
        eng.annotationLayer.clear()
        setEdgeCount(0)
        setSelectedEdges([])
        setEditorMode('draw')
        bus.emit('geometryChanged')
        break
      case 'export':
        handleExportFlowRef.current?.()
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
  }, [syncNextShapeMetadata])

  // --- Handle edge service popup ---
  const handleEdgeServiceSelect = useCallback((edgeId, service) => {
    const eng = enginesRef.current
    if (!eng) return
    eng.edgeTagger.tagEdge(edgeId, service)
    setEdgePopup(null)
    forceRerender(n => n + 1)
  }, [])

  // --- Handle point expression popup save ---
  const handlePointExpressionSave = useCallback(() => {
    const eng = enginesRef.current
    if (!eng || !pointExpressionPopup) return
    eng.paramStore.setPointExpression(pointExpressionPopup.pointId, pointExprInputX, pointExprInputY)
    if (eng.pointTagger) eng.pointTagger.refreshIndicators()
    setPointExpressionPopup(null)
    forceRerender(n => n + 1)
  }, [pointExpressionPopup, pointExprInputX, pointExprInputY])

  // --- Unified Export Flow: save to DB → toast → ask download ---
  const handleExportFlow = useCallback(async () => {
    const eng = enginesRef.current
    if (!eng) return

    const meta = {
      name     : eng.paramStore.getShapeMetadata().className || 'shape',
      thickness: 5,
    }

    let payload
    try {
      payload = eng.exportService.getExportPayload(meta)
    } catch (err) {
      toast.error('Export failed: ' + err.message)
      return
    }

    if (!payload || !payload.edges || payload.edges.length === 0) {
      toast.error('Nothing to export — draw some edges first.')
      return
    }

    toast.loading('Saving to database…')

    try {
      await saveShape(payload.name, payload)
      toast.success(`"${payload.name}" saved to database!`)
      setSaveModal({ payload, fileName: payload.name })
    } catch (err) {
      if ((err.message || '').toLowerCase().includes('shape number')) {
        toast.error(err.message)
      } else {
        toast.error(`Could not reach database: ${err.message}`)
      }
      // Still let user download even when DB is unavailable
      setSaveModal({ payload, fileName: payload.name, dbError: true })
    }
  }, []) // eslint-disable-line

  // Use a ref so menuAction (empty-dep useCallback) can always call the latest version
  const handleExportFlowRef = useRef(null)
  handleExportFlowRef.current = handleExportFlow

  // --- Handle Generate (Parameter Mode button) ---
  const handleGenerate = useCallback(() => {
    handleExportFlowRef.current?.()
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

  const isParamMode = editorMode === 'parameter'
  const SERVICE_LABELS = ['E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7', 'E8']

  return (
    <div style={rootStyle}>
      {/* Top bar: balanced layout, menus visible */}
      <header className="app-header">
        <span className="app-header-brand">GSAP Editor</span>

        <Toolbar
          editorMode={editorMode}
          onModeSwitch={handleModeSwitch}
          canSwitchToParam={canSwitchToParam}
          switchError={switchError}
        />

        <nav className="app-header-nav">
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
            <div className="app-header-dropdown-divider" />
            <MenuItem label="Toggle Arc Mode" shortcut="—" onClick={() => menuAction('toggleArcMode')} />
          </MenuBtn>
        </nav>
      </header>

      {/* Main area */}
      <div style={mainAreaStyle}>
        {/* Toolbox */}
        <aside style={toolboxStyle}>
          {!isParamMode ? (
            ['draw', 'edit', 'info'].map(group => (
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
            ))
          ) : (
            <>
              <div style={toolGroupLabel}>TAG</div>
              {PARAM_TOOL_DEFS.map(t => (
                <ToolBtn
                  key={t.key}
                  icon={t.icon}
                  label={t.label}
                  shortcut={t.shortcut}
                  active={activeTool === t.key}
                  onClick={() => switchTool(t.key)}
                />
              ))}
            </>
          )}
        </aside>

        {/* Canvas */}
        <div ref={canvasAreaRef} style={canvasAreaStyle}>
          <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />

          {/* Point expression popup — appears near clicked point */}
          {pointExpressionPopup && isParamMode && (
            <div
              style={{
                position: 'absolute',
                left: (() => {
                  const rect = canvasAreaRef.current?.getBoundingClientRect()
                  if (!rect) return 20
                  const offset = 16
                  let left = pointExpressionPopup.screenX - rect.left + offset
                  const popupWidth = 220
                  if (left + popupWidth > rect.width) left = pointExpressionPopup.screenX - rect.left - popupWidth - 8
                  if (left < 8) left = 8
                  return left
                })(),
                top: (() => {
                  const rect = canvasAreaRef.current?.getBoundingClientRect()
                  if (!rect) return 20
                  const offset = 16
                  let top = pointExpressionPopup.screenY - rect.top + offset
                  const popupHeight = 140
                  if (top + popupHeight > rect.height) top = pointExpressionPopup.screenY - rect.top - popupHeight - 8
                  if (top < 8) top = 8
                  return top
                })(),
                zIndex: 350,
              }}
            >
              <div
                style={pointExpressionPopupStyle}
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') { e.preventDefault(); setPointExpressionPopup(null) }
                  if (e.key === 'Enter' && pointExpressionPopup.pointId !== 'p0') { e.preventDefault(); handlePointExpressionSave() }
                }}
              >
                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <div>
                    <span style={{ fontSize: 14, fontWeight: 700, color: '#7fffd4' }}>
                      {pointExpressionPopup.pointId}
                    </span>
                    <span style={{ color: '#555', fontSize: 11, fontWeight: 400, marginLeft: 6 }}>
                      drawn at ({pointExpressionPopup.x.toFixed(2)}, {pointExpressionPopup.y.toFixed(2)})
                    </span>
                  </div>
                  <button
                    onClick={() => setPointExpressionPopup(null)}
                    style={{ background: 'none', border: 'none', color: '#555', fontSize: 16, cursor: 'pointer', padding: '0 2px', lineHeight: 1 }}
                  >✕</button>
                </div>

                {pointExpressionPopup.pointId === 'p0' ? (
                  <div>
                    <div style={{ color: '#7fffd4', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>⚓ Shape Origin (auto-assigned)</div>
                    <div style={{ color: '#999', fontSize: 11, lineHeight: 1.5, marginBottom: 8 }}>
                      This is the bottom-left corner of your shape.<br />
                      X = <code style={{ color: '#ccc' }}>trimLeft</code>, Y = <code style={{ color: '#ccc' }}>trimBottom</code>
                    </div>
                    <button style={pointPopupCancelBtnStyle} onClick={() => setPointExpressionPopup(null)}>Close</button>
                  </div>
                ) : (
                  <>
                    {/* When auto-assigned, show a friendly "already set" message */}
                    {(pointExprInputX.trim() || pointExprInputY.trim()) && (
                      <div style={{ padding: '5px 8px', background: '#0e1a12', borderRadius: 4, border: '1px solid #1e4028', marginBottom: 8, fontSize: 11, color: '#88cc99' }}>
                        ✓ Auto-assigned — edit below or close to keep
                      </div>
                    )}

                    <div style={{ marginBottom: 6 }}>
                      <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 2 }}>
                        X (horizontal) — drawn at <b style={{ color: '#aaa' }}>{pointExpressionPopup.x.toFixed(2)}</b>
                      </label>
                      <input
                        type="text"
                        value={pointExprInputX}
                        onChange={e => setPointExprInputX(e.target.value)}
                        placeholder={`${pointExpressionPopup.x.toFixed(2)}  (or: p0.x + 150)`}
                        style={pointExprInputStyle}
                        autoFocus
                      />
                    </div>
                    <div style={{ marginBottom: 8 }}>
                      <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 2 }}>
                        Y (vertical) — drawn at <b style={{ color: '#aaa' }}>{pointExpressionPopup.y.toFixed(2)}</b>
                      </label>
                      <input
                        type="text"
                        value={pointExprInputY}
                        onChange={e => setPointExprInputY(e.target.value)}
                        placeholder={`${pointExpressionPopup.y.toFixed(2)}  (or: p0.y + 80)`}
                        style={pointExprInputStyle}
                      />
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button style={pointPopupSaveBtnStyle} onClick={handlePointExpressionSave}>✓ Save</button>
                      <button style={pointPopupCancelBtnStyle} onClick={() => setPointExpressionPopup(null)}>Cancel</button>
                    </div>
                    <div style={{ marginTop: 6, color: '#444', fontSize: 10 }}>
                      Tip: use the parameter panel on the right for smart suggestions
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Edge service popup */}
          {edgePopup && (
            <div style={{
              position: 'absolute',
              left: edgePopup.screenX - (canvasAreaRef.current?.getBoundingClientRect().left ?? 0),
              top: edgePopup.screenY - (canvasAreaRef.current?.getBoundingClientRect().top ?? 0),
              zIndex: 300,
            }}>
              <div style={edgePopupStyle}>
                <div style={{ fontSize: 11, color: '#7fffd4', fontWeight: 700, marginBottom: 6 }}>
                  Assign Service: {edgePopup.edgeId}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                  <button
                    style={serviceOptionStyle('#666', false)}
                    onClick={() => handleEdgeServiceSelect(edgePopup.edgeId, null)}
                  >None</button>
                  {SERVICE_LABELS.map(label => {
                    const current = enginesRef.current?.paramStore?.getEdgeService(edgePopup.edgeId)
                    const isActive = current === label
                    const colors = { E1: '#4488ff', E2: '#44cc66', E3: '#cccc44', E4: '#ff8844', E5: '#cc44ff', E6: '#44cccc', E7: '#ff4488', E8: '#88ff44' }
                    return (
                      <button
                        key={label}
                        style={serviceOptionStyle(colors[label], isActive)}
                        onClick={() => handleEdgeServiceSelect(edgePopup.edgeId, label)}
                      >{label}</button>
                    )
                  })}
                </div>
                <button
                  style={{ ...serviceOptionStyle('#666', false), width: '100%', marginTop: 4 }}
                  onClick={() => setEdgePopup(null)}
                >Cancel</button>
              </div>
            </div>
          )}
        </div>

        {/* Right Panel */}
        <aside style={propertyPanelStyle}>
          {isParamMode ? (
            <div style={paramSideLayoutStyle}>
              <div style={{ color: '#ff8844', fontWeight: 700, fontSize: 16, marginBottom: 12, letterSpacing: 0.5 }}>
                PARAMETERS
              </div>

              {/* Detected dimensions panel — shows on first switch to param mode */}
              {showDetectedDims && detectedAnalysis && enginesRef.current && (
                <DetectedDimensionsPanel
                  analysis={detectedAnalysis}
                  paramStore={enginesRef.current.paramStore}
                  geometryStore={enginesRef.current.store}
                  autoAssignService={autoAssignRef.current}
                  pointTagger={enginesRef.current.pointTagger}
                  onCreated={() => {
                    setShowDetectedDims(false)
                    forceRerender(n => n + 1)
                  }}
                  onDismiss={() => setShowDetectedDims(false)}
                />
              )}

              {enginesRef.current && (
                <div style={paramPanelWrapStyle}>
                  <ParameterPanel
                    paramStore={enginesRef.current.paramStore}
                    geometryStore={enginesRef.current.store}
                    pointTagger={enginesRef.current.pointTagger}
                    edgeTagger={enginesRef.current.edgeTagger}
                    onGenerate={handleGenerate}
                  />
                </div>
              )}
            </div>
          ) : (
            <>
              <div style={{ color: '#7fffd4', fontWeight: 700, fontSize: 16, marginBottom: 12, letterSpacing: 0.5 }}>PROPERTIES</div>
              {renderPropertyPanel()}
            </>
          )}
        </aside>
      </div>

      {/* Command Input */}
      <div style={commandInputStyle}>
        <span style={{ color: '#7fffd4', fontWeight: 600, marginRight: 12, fontSize: 15, userSelect: 'none' }}>CMD:</span>
        <input
          ref={commandRef}
          type="text"
          style={cmdInputFieldStyle}
          placeholder={isParamMode
            ? 'Parameter mode active — use the panel to define parameters...'
            : 'Type coordinates (100,80) or constraints (L150, A45, R75)...'
          }
          onKeyDown={handleCommand}
          disabled={isParamMode}
        />
        {constraintStatus && (
          <span style={{ marginLeft: 12, color: '#ff8844', fontSize: 12, fontWeight: 600 }}>{constraintStatus}</span>
        )}
      </div>

      {/* Status Bar */}
      <StatusBar
        coordStatus={coordStatus}
        snapStatus={snapStatus}
        activeTool={activeTool}
        edgeCount={edgeCount}
        toolStatus={toolStatus}
        editorMode={editorMode}
        parameterCount={parameterCount}
        pointsAssigned={pointsAssigned}
        totalPoints={totalPoints}
      />

      {/* Click-away for menus */}
      {menuOpen && <div style={menuBackdropStyle} onClick={() => setMenuOpen(null)} />}

      {/* ── Toast notification stack (bottom-right) ── */}
      <Toaster />

      {/* ── Save → Download confirm modal ── */}
      {saveModal && (
        <SaveConfirmModal
          shapeName={
            saveModal.dbError
              ? `${saveModal.fileName} (saved locally — DB unavailable)`
              : saveModal.fileName
          }
          onDownload={() => {
            enginesRef.current?.exportService.downloadPayload(saveModal.payload)
            setSaveModal(null)
          }}
          onClose={() => setSaveModal(null)}
        />
      )}
    </div>
  )
}

// --- Sub-components ---

function ToolBtn({ icon, label, shortcut, active, onClick }) {
  return (
    <button
      onClick={onClick}
      title={`${label} (${shortcut})`}
      type="button"
      style={{
        width: 44,
        height: 44,
        margin: '3px 0',
        borderRadius: 8,
        border: active ? '2px solid #7fffd4' : '2px solid transparent',
        background: active ? 'rgba(0, 255, 212, 0.1)' : 'transparent',
        color: active ? '#7fffd4' : '#9ca3af',
        fontSize: 20,
        fontWeight: 700,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
        cursor: 'pointer',
        transition: 'all 0.15s',
      }}
    >
      {icon}
      <span style={{
        position: 'absolute',
        bottom: 2,
        right: 4,
        fontSize: 9,
        color: '#6b7280',
        fontWeight: 500,
      }}>{shortcut}</span>
    </button>
  )
}

function MenuBtn({ label, open, onClick, children }) {
  const triggerRef = useRef(null)
  const [dropdownPosition, setDropdownPosition] = useState(null)

  useEffect(() => {
    if (!open) {
      setDropdownPosition(null)
      return
    }
    const el = triggerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    setDropdownPosition({
      top: rect.bottom + 4,
      left: Math.min(rect.left, window.innerWidth - 240),
    })
  }, [open])

  const dropdownEl = open && dropdownPosition ? (
    <div
      className="app-header-dropdown"
      style={{
        top: dropdownPosition.top,
        left: dropdownPosition.left,
      }}
    >
      {children}
    </div>
  ) : null

  return (
    <div style={{ position: 'relative' }}>
      <button
        ref={triggerRef}
        type="button"
        className={`app-header-menu-trigger ${open ? 'is-open' : ''}`}
        onClick={onClick}
      >
        {label}
      </button>
      {dropdownEl && ReactDOM.createPortal(dropdownEl, document.body)}
    </div>
  )
}

function MenuItem({ label, shortcut, onClick, disabled }) {
  return (
    <div
      role="menuitem"
      className={`app-header-dropdown-item ${disabled ? 'is-disabled' : ''}`}
      onClick={disabled ? undefined : onClick}
    >
      <span>{label}</span>
      <span className="app-header-dropdown-item-shortcut">{shortcut}</span>
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

const mainAreaStyle = {
  flex: 1, display: 'flex', flexDirection: 'row',
  minHeight: 0, minWidth: 0,
}

const toolboxStyle = {
  width: 56,
  background: '#1e2124',
  borderRight: '1px solid #2a2d30',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  paddingTop: 8,
  zIndex: 10,
  overflowY: 'auto',
  flexShrink: 0,
}

const toolGroupLabel = {
  fontSize: 11,
  color: '#6b7280',
  fontWeight: 700,
  letterSpacing: 0.5,
  marginTop: 10,
  marginBottom: 4,
  userSelect: 'none',
}

const propertyPanelStyle = {
  width: 420, background: '#1e2124',
  borderLeft: '1px solid #2a2d30',
  display: 'flex', flexDirection: 'column',
  padding: '12px 14px', zIndex: 10, overflow: 'hidden', flexShrink: 0,
}

const paramSideLayoutStyle = {
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
  height: '100%',
  overflow: 'hidden',
}

const paramPanelWrapStyle = {
  flex: 1,
  minHeight: 0,
  overflow: 'hidden',
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

const commandInputStyle = {
  height: 36,
  background: '#1a1c1e',
  borderTop: '1px solid #2a2d30',
  display: 'flex',
  alignItems: 'center',
  padding: '0 16px',
  zIndex: 20,
  flexShrink: 0,
}

const cmdInputFieldStyle = {
  flex: 1,
  background: 'transparent',
  border: 'none',
  color: '#e5e7eb',
  fontSize: 15,
  outline: 'none',
  fontFamily: 'monospace',
}

const menuBackdropStyle = {
  position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
  zIndex: 50,
}

const edgePopupStyle = {
  background: '#252830',
  border: '1px solid #3a3d42',
  borderRadius: 8,
  padding: '10px 12px',
  boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
  minWidth: 160,
}

const pointExpressionPopupStyle = {
  background: '#252830',
  border: '1px solid #7fffd4',
  borderRadius: 8,
  padding: '12px 14px',
  boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
  minWidth: 220,
}

const pointExprInputStyle = {
  width: '100%',
  padding: '5px 8px',
  background: '#1a1c1e',
  border: '1px solid #3a3d42',
  borderRadius: 4,
  color: '#e0e3e6',
  fontSize: 12,
  fontFamily: 'monospace',
  outline: 'none',
  boxSizing: 'border-box',
}

const pointPopupSaveBtnStyle = {
  flex: 1,
  padding: '6px 12px',
  background: '#1a3328',
  border: '1px solid #44cc66',
  borderRadius: 4,
  color: '#44cc66',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
}

const pointPopupCancelBtnStyle = {
  flex: 1,
  padding: '6px 12px',
  background: '#2e1a1a',
  border: '1px solid #ff4444',
  borderRadius: 4,
  color: '#ff4444',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
}

const serviceOptionStyle = (color, isActive) => ({
  padding: '4px 10px',
  background: isActive ? `${color}22` : 'transparent',
  border: `1px solid ${isActive ? color : '#3a3d42'}`,
  borderRadius: 4,
  color: color,
  fontSize: 11,
  fontWeight: isActive ? 700 : 500,
  cursor: 'pointer',
  transition: 'all 0.1s',
})
