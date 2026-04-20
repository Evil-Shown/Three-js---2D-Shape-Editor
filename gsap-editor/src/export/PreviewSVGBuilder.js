// src/export/PreviewSVGBuilder.js
//
// Generates preview SVG data for the Java shape library system.
//
// The Java system has two SVG views:
//   1. THUMBNAIL — small icon in the shape library grid (no dimensions)
//   2. PREVIEW   — larger view with dimension lines and parameter labels
//
// This module converts the editor's parametric edge chain into structured
// data that the Java code generator can use to produce SVGBuilder/SVGBuilder2
// code like:
//
//   new SVGBuilder().pathBuilder()
//       .startPath(50, 30)
//       .lineTo(150, 30)
//       .arcTo(40, 40, 190, 70, false, true)
//       ...
//       .endPath(true)
//       .setText(shapeNo)
//       .build()

const THUMBNAIL_SIZE = 220
const PREVIEW_SIZE   = 250
const THUMB_PADDING  = 25
const PREV_PADDING   = 30
const DIM_OFFSET     = 20  // offset for dimension lines from shape boundary

export class PreviewSVGBuilder {

  /**
   * Build complete preview data for the export payload.
   *
   * @param {Array} chainedEdges   — ordered edge chain (raw geometry)
   * @param {Array} parametricEdges — parametric chain (with point refs + param refs)
   * @param {Array} shapePoints    — extracted shape points [{id, x, y}, ...]
   * @param {Array} parameters     — parameter definitions [{name, type, defaultValue}, ...]
   * @param {object} pointExprs    — point expressions {p0: {x,y}, ...}
   * @param {object} topology      — {isClosed, shapeType, ...}
   * @returns {object} previewData
   */
  build(chainedEdges, parametricEdges, shapePoints, parameters, pointExprs, topology) {
    if (!chainedEdges || chainedEdges.length === 0) return null

    // Compute bounding box of the actual shape
    const bb = this._boundingBox(chainedEdges)

    // Build normalized SVG path commands (fit into standard viewbox)
    const thumbnailPath = this._buildSVGPath(chainedEdges, bb, THUMBNAIL_SIZE, THUMB_PADDING)
    const previewPath   = this._buildSVGPath(chainedEdges, bb, PREVIEW_SIZE, PREV_PADDING)

    // Build dimension lines for the preview
    const dimensions = this._buildDimensionLines(
      bb, parameters, shapePoints, parametricEdges, PREVIEW_SIZE, PREV_PADDING
    )

    // Build the SVGBuilder-compatible command sequence (for Java code generation)
    const thumbnailCommands = this._buildSVGBuilderCommands(
      chainedEdges, parametricEdges, bb, THUMBNAIL_SIZE, THUMB_PADDING
    )
    const previewCommands = this._buildSVGBuilderCommands(
      chainedEdges, parametricEdges, bb, PREVIEW_SIZE, PREV_PADDING
    )

    return {
      thumbnail: {
        viewBox: `0 0 ${THUMBNAIL_SIZE} ${THUMBNAIL_SIZE}`,
        svgPath: thumbnailPath.d,
        commands: thumbnailCommands,
        closed: topology.isClosed,
      },
      preview: {
        viewBox: `0 0 ${PREVIEW_SIZE} ${PREVIEW_SIZE}`,
        svgPath: previewPath.d,
        commands: previewCommands,
        closed: topology.isClosed,
        dimensions,
      },
      // Transform info so Java can reproduce the mapping
      transform: {
        originalBBox: {
          minX: bb.minX,
          minY: bb.minY,
          maxX: bb.maxX,
          maxY: bb.maxY,
          width: bb.width,
          height: bb.height,
        },
        thumbnailScale: thumbnailPath.scale,
        thumbnailOffset: thumbnailPath.offset,
        previewScale: previewPath.scale,
        previewOffset: previewPath.offset,
      },
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════════
   *  SVG PATH GENERATION
   * ═══════════════════════════════════════════════════════════════════════════
   * Converts the edge chain into an SVG path `d` attribute string, scaled
   * to fit within the target viewBox with padding.
   */

  _buildSVGPath(chainedEdges, bb, viewSize, padding) {
    const { scale, offset } = this._computeTransform(bb, viewSize, padding)
    const parts = []

    for (let i = 0; i < chainedEdges.length; i++) {
      const edge = chainedEdges[i]
      const ep = this._edgeEndpoints(edge)

      if (i === 0) {
        const sx = this._tx(ep.start.x, bb, scale, offset, 'x')
        const sy = this._ty(ep.start.y, bb, scale, offset, 'y')
        parts.push(`M ${sx.toFixed(1)} ${sy.toFixed(1)}`)
      }

      if (edge.type === 'line') {
        const ex = this._tx(ep.end.x, bb, scale, offset, 'x')
        const ey = this._ty(ep.end.y, bb, scale, offset, 'y')
        parts.push(`L ${ex.toFixed(1)} ${ey.toFixed(1)}`)
      } else if (edge.type === 'arc') {
        const ex = this._tx(ep.end.x, bb, scale, offset, 'x')
        const ey = this._ty(ep.end.y, bb, scale, offset, 'y')
        const rx = edge.radius * scale
        const ry = rx // uniform scale

        const flags = this._computeArcFlags(edge)
        const largeArc = flags.largeArc ? 1 : 0
        const sweepFlag = flags.sweep ? 1 : 0

        parts.push(`A ${rx.toFixed(1)} ${ry.toFixed(1)} 0 ${largeArc} ${sweepFlag} ${ex.toFixed(1)} ${ey.toFixed(1)}`)
      }
    }

    // Close path if the chain is closed
    const first = this._edgeEndpoints(chainedEdges[0])
    const last  = this._edgeEndpoints(chainedEdges[chainedEdges.length - 1])
    if (Math.hypot(last.end.x - first.start.x, last.end.y - first.start.y) < 2.0) {
      parts.push('Z')
    }

    return {
      d: parts.join(' '),
      scale,
      offset,
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════════
   *  SVGBUILDER COMMAND SEQUENCE
   * ═══════════════════════════════════════════════════════════════════════════
   * Produces a structured array of commands that map 1:1 to Java SVGBuilder
   * method calls. The Java code generator iterates this array to produce:
   *
   *   .startPath(x, y)
   *   .lineTo(x, y)
   *   .arcTo(rx, ry, endX, endY, largeArc, sweep)
   *   .endPath(true)
   */

  _buildSVGBuilderCommands(chainedEdges, parametricEdges, bb, viewSize, padding) {
    const { scale, offset } = this._computeTransform(bb, viewSize, padding)
    const commands = []

    for (let i = 0; i < chainedEdges.length; i++) {
      const edge = chainedEdges[i]
      const pe   = parametricEdges[i]
      const ep   = this._edgeEndpoints(edge)

      if (i === 0) {
        const sx = this._tx(ep.start.x, bb, scale, offset, 'x')
        const sy = this._ty(ep.start.y, bb, scale, offset, 'y')
        commands.push({
          method: 'startPath',
          args: [parseFloat(sx.toFixed(1)), parseFloat(sy.toFixed(1))],
          pointRef: pe ? pe.startPoint : null,
          comment: pe ? `start at ${pe.startPoint}` : null,
        })
      }

      if (edge.type === 'line') {
        const ex = this._tx(ep.end.x, bb, scale, offset, 'x')
        const ey = this._ty(ep.end.y, bb, scale, offset, 'y')
        commands.push({
          method: 'lineTo',
          args: [parseFloat(ex.toFixed(1)), parseFloat(ey.toFixed(1))],
          pointRef: pe ? pe.endPoint : null,
          serviceLabel: pe ? pe.serviceLabel : null,
          comment: pe ? `${pe.serviceLabel || 'edge'} → ${pe.endPoint}` : null,
        })
      } else if (edge.type === 'arc') {
        const ex = this._tx(ep.end.x, bb, scale, offset, 'x')
        const ey = this._ty(ep.end.y, bb, scale, offset, 'y')
        const sr = edge.radius * scale
        const flags = this._computeArcFlags(edge)

        commands.push({
          method: 'arcTo',
          args: [
            parseFloat(sr.toFixed(1)),  // rx
            parseFloat(sr.toFixed(1)),  // ry
            parseFloat(ex.toFixed(1)),  // endX
            parseFloat(ey.toFixed(1)),  // endY
            flags.largeArc,             // largeArcFlag
            flags.sweep,                // sweepFlag
          ],
          radiusParam: pe ? pe.radiusParam : null,
          pointRef: pe ? pe.endPoint : null,
          serviceLabel: pe ? pe.serviceLabel : null,
          comment: pe
            ? `${pe.radiusParam || 'R?'} arc → ${pe.endPoint}`
            : null,
        })
      }
    }

    // Close
    commands.push({
      method: 'endPath',
      args: [true],
      comment: 'close path',
    })

    return commands
  }

  /* ═══════════════════════════════════════════════════════════════════════════
   *  DIMENSION LINES
   * ═══════════════════════════════════════════════════════════════════════════
   * Generates dimension line definitions for the preview SVG.
   * Matches the Java pattern:
   *   .pathBuilder().stroke("blue")
   *   .startPath(20, 30)
   *   .lineToWithText(20, 230, "H")
   *   .endPath(true)
   *
   * Strategy:
   *   - L (width): horizontal line below the shape
   *   - H (height): vertical line left of the shape
   *   - R1, R2, ...: short lines at the corresponding arc corners
   *   - Other LINEAR: positioned based on their spatial meaning
   */

  _buildDimensionLines(bb, parameters, shapePoints, parametricEdges, viewSize, padding) {
    const { scale, offset } = this._computeTransform(bb, viewSize, padding)
    const dims = []

    const pL = parameters.find(p => p.name === 'L')
    const pH = parameters.find(p => p.name === 'H')

    // ── Overall width (L) — horizontal line below shape ─────────────────────
    if (pL) {
      const leftX  = this._tx(bb.minX, bb, scale, offset, 'x')
      const rightX = this._tx(bb.maxX, bb, scale, offset, 'x')
      const y      = this._ty(bb.minY, bb, scale, offset, 'y') + DIM_OFFSET

      dims.push({
        paramName: 'L',
        stroke: 'blue',
        commands: [
          { method: 'startPath', args: [parseFloat(leftX.toFixed(1)), parseFloat(y.toFixed(1))] },
          { method: 'lineToWithText', args: [parseFloat(rightX.toFixed(1)), parseFloat(y.toFixed(1)), 'L'] },
          { method: 'endPath', args: [true] },
        ],
      })
    }

    // ── Overall height (H) — vertical line left of shape ────────────────────
    if (pH) {
      const x      = this._tx(bb.minX, bb, scale, offset, 'x') - DIM_OFFSET
      const topY   = this._ty(bb.maxY, bb, scale, offset, 'y')
      const botY   = this._ty(bb.minY, bb, scale, offset, 'y')

      dims.push({
        paramName: 'H',
        stroke: 'blue',
        commands: [
          { method: 'startPath', args: [parseFloat(x.toFixed(1)), parseFloat(topY.toFixed(1))] },
          { method: 'lineToWithText', args: [parseFloat(x.toFixed(1)), parseFloat(botY.toFixed(1)), 'H'] },
          { method: 'endPath', args: [true] },
        ],
      })
    }

    // ── Radius dimensions — short lines at arc corners ──────────────────────
    const radiusParams = parameters.filter(p => p.type === 'RADIUS' || /^R\d+$/.test(p.name))
    const arcEdges = parametricEdges.filter(pe => pe.type === 'arc')

    for (const rp of radiusParams) {
      // Find an arc that uses this radius parameter
      const matchingArc = arcEdges.find(ae => ae.radiusParam === rp.name)
      if (!matchingArc) continue

      // Find the start point of this arc in shape points
      const arcStartPt = shapePoints.find(sp => sp.id === matchingArc.startPoint)
      const arcEndPt   = shapePoints.find(sp => sp.id === matchingArc.endPoint)
      if (!arcStartPt || !arcEndPt) continue

      // Determine which corner this arc is in (based on position relative to bbox center)
      const centerX = (bb.minX + bb.maxX) / 2
      const centerY = (bb.minY + bb.maxY) / 2
      const arcMidX = (arcStartPt.x + arcEndPt.x) / 2
      const arcMidY = (arcStartPt.y + arcEndPt.y) / 2

      // Pick the dimension line direction based on which side the arc is nearer to
      let dimStart, dimEnd
      const isLeft   = arcMidX < centerX
      const isBottom = arcMidY < centerY

      // Use the arc start → end to determine the radius line orientation
      // The radius is shown as a short horizontal or vertical line at the tangent point
      if (Math.abs(arcStartPt.x - arcEndPt.x) > Math.abs(arcStartPt.y - arcEndPt.y)) {
        // Arc spans more horizontally → show vertical radius line
        if (isBottom) {
          // Bottom edge arc: radius line goes from arc endpoint down
          const pt = isLeft ? arcStartPt : arcEndPt
          dimStart = {
            x: parseFloat(this._tx(pt.x, bb, scale, offset, 'x').toFixed(1)),
            y: parseFloat(this._ty(pt.y, bb, scale, offset, 'y').toFixed(1)),
          }
          dimEnd = {
            x: dimStart.x,
            y: parseFloat(this._ty(bb.minY, bb, scale, offset, 'y').toFixed(1)),
          }
        } else {
          // Top edge arc
          const pt = isLeft ? arcStartPt : arcEndPt
          dimStart = {
            x: parseFloat(this._tx(pt.x, bb, scale, offset, 'x').toFixed(1)),
            y: parseFloat(this._ty(pt.y, bb, scale, offset, 'y').toFixed(1)),
          }
          dimEnd = {
            x: dimStart.x,
            y: parseFloat(this._ty(bb.maxY, bb, scale, offset, 'y').toFixed(1)),
          }
        }
      } else {
        // Arc spans more vertically → show horizontal radius line
        if (isLeft) {
          // Left edge arc
          const pt = isBottom ? arcStartPt : arcEndPt
          dimStart = {
            x: parseFloat(this._tx(pt.x, bb, scale, offset, 'x').toFixed(1)),
            y: parseFloat(this._ty(pt.y, bb, scale, offset, 'y').toFixed(1)),
          }
          dimEnd = {
            x: parseFloat(this._tx(bb.minX, bb, scale, offset, 'x').toFixed(1)),
            y: dimStart.y,
          }
        } else {
          // Right edge arc
          const pt = isBottom ? arcEndPt : arcStartPt
          dimStart = {
            x: parseFloat(this._tx(pt.x, bb, scale, offset, 'x').toFixed(1)),
            y: parseFloat(this._ty(pt.y, bb, scale, offset, 'y').toFixed(1)),
          }
          dimEnd = {
            x: parseFloat(this._tx(bb.maxX, bb, scale, offset, 'x').toFixed(1)),
            y: dimStart.y,
          }
        }
      }

      dims.push({
        paramName: rp.name,
        stroke: 'blue',
        commands: [
          { method: 'startPath', args: [dimStart.x, dimStart.y] },
          { method: 'lineToWithText', args: [dimEnd.x, dimEnd.y, rp.name] },
          { method: 'endPath', args: [true] },
        ],
      })
    }

    // ── Sub-dimensions (L2, H2, etc.) — positioned based on the geometry ────
    const subLinear = parameters.filter(p =>
      p.type === 'LINEAR' && p.name !== 'L' && p.name !== 'H'
    )
    for (const sp of subLinear) {
      // Try to find two points whose distance matches this parameter
      const match = this._findDimensionEndpoints(sp, shapePoints, bb, scale, offset)
      if (match) {
        dims.push({
          paramName: sp.name,
          stroke: 'blue',
          commands: [
            { method: 'startPath', args: [match.start.x, match.start.y] },
            { method: 'lineToWithText', args: [match.end.x, match.end.y, sp.name] },
            { method: 'endPath', args: [true] },
          ],
        })
      }
    }

    return dims
  }

  /**
   * Find two shape points whose horizontal or vertical distance matches
   * a parameter's default value, then transform them to preview coords.
   */
  _findDimensionEndpoints(param, shapePoints, bb, scale, offset) {
    const val = param.defaultValue
    const eps = 2.0

    // Try horizontal first
    for (let i = 0; i < shapePoints.length; i++) {
      for (let j = i + 1; j < shapePoints.length; j++) {
        const p1 = shapePoints[i], p2 = shapePoints[j]
        const dx = Math.abs(p1.x - p2.x)
        const dy = Math.abs(p1.y - p2.y)

        if (Math.abs(dx - val) < eps && dy < eps) {
          // Horizontal match
          const y = this._ty(Math.min(p1.y, p2.y), bb, scale, offset, 'y') + DIM_OFFSET
          return {
            start: {
              x: parseFloat(this._tx(Math.min(p1.x, p2.x), bb, scale, offset, 'x').toFixed(1)),
              y: parseFloat(y.toFixed(1)),
            },
            end: {
              x: parseFloat(this._tx(Math.max(p1.x, p2.x), bb, scale, offset, 'x').toFixed(1)),
              y: parseFloat(y.toFixed(1)),
            },
          }
        }

        if (Math.abs(dy - val) < eps && dx < eps) {
          // Vertical match
          const x = this._tx(Math.min(p1.x, p2.x), bb, scale, offset, 'x') - DIM_OFFSET
          return {
            start: {
              x: parseFloat(x.toFixed(1)),
              y: parseFloat(this._ty(Math.min(p1.y, p2.y), bb, scale, offset, 'y').toFixed(1)),
            },
            end: {
              x: parseFloat(x.toFixed(1)),
              y: parseFloat(this._ty(Math.max(p1.y, p2.y), bb, scale, offset, 'y').toFixed(1)),
            },
          }
        }
      }
    }

    return null
  }

  /* ═══════════════════════════════════════════════════════════════════════════
   *  COORDINATE TRANSFORMS
   * ═══════════════════════════════════════════════════════════════════════════
   * Compute a uniform scale + offset that maps the shape's bounding box
   * into the target viewBox (viewSize × viewSize) with padding.
   *
   * The shape editor uses mathematical coordinates (Y up), but SVG uses
   * screen coordinates (Y down). We flip Y during transform.
   */

  _computeTransform(bb, viewSize, padding) {
    const drawArea = viewSize - 2 * padding
    const scaleX = bb.width  > 0 ? drawArea / bb.width  : 1
    const scaleY = bb.height > 0 ? drawArea / bb.height : 1
    const scale = Math.min(scaleX, scaleY)

    // Center the shape in the viewBox
    const scaledW = bb.width * scale
    const scaledH = bb.height * scale
    const offsetX = padding + (drawArea - scaledW) / 2
    const offsetY = padding + (drawArea - scaledH) / 2

    return {
      scale,
      offset: { x: offsetX, y: offsetY },
    }
  }

  /** Transform X from world → SVG */
  _tx(worldX, bb, scale, offset, _axis) {
    return (worldX - bb.minX) * scale + offset.x
  }

  /** Transform Y from world → SVG (Y-flip: editor Y-up → SVG Y-down) */
  _ty(worldY, bb, scale, offset, _axis) {
    // Flip: maxY maps to offset.y, minY maps to offset.y + scaledHeight
    return (bb.maxY - worldY) * scale + offset.y
  }

  /* ═══════════════════════════════════════════════════════════════════════════
   *  ARC FLAGS (same computation as ExportService but kept here for independence)
   * ═══════════════════════════════════════════════════════════════════════════ */

  _computeArcFlags(arc) {
    let sweep
    if (arc.clockwise) {
      sweep = arc.startAngle - arc.endAngle
      if (sweep <= 0) sweep += 2 * Math.PI
    } else {
      sweep = arc.endAngle - arc.startAngle
      if (sweep <= 0) sweep += 2 * Math.PI
    }

    // IMPORTANT: the editor's {x,y,center,radius,startAngle,endAngle} are flipped
    // into SVG (Y-down) coordinates via `_tx/_ty`. Because BOTH the center and the
    // sampled arc points are flipped consistently, the arc's visual rotation sense
    // is preserved — `editor clockwise=true` still appears clockwise on screen in
    // the generated SVG. SVG `sweep-flag=1` means "positive-angle direction", which
    // in Y-down renders as visually clockwise. Hence the flag maps DIRECTLY to the
    // editor's `clockwise` bit; do NOT invert it (previous `!clockwise` rule caused
    // fillets to render as their mirror-image outer arc).
    return {
      largeArc: sweep > Math.PI,
      sweep: !!arc.clockwise,
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════════
   *  BOUNDING BOX
   * ═══════════════════════════════════════════════════════════════════════════ */

  _boundingBox(edges) {
    let minX = Infinity, maxX = -Infinity
    let minY = Infinity, maxY = -Infinity

    for (const e of edges) {
      if (e.type === 'line') {
        minX = Math.min(minX, e.start.x, e.end.x)
        maxX = Math.max(maxX, e.start.x, e.end.x)
        minY = Math.min(minY, e.start.y, e.end.y)
        maxY = Math.max(maxY, e.start.y, e.end.y)
      } else if (e.type === 'arc') {
        // Use actual endpoints, not full center±radius extent,
        // for tighter bounding
        const ep = this._edgeEndpoints(e)
        minX = Math.min(minX, ep.start.x, ep.end.x)
        maxX = Math.max(maxX, ep.start.x, ep.end.x)
        minY = Math.min(minY, ep.start.y, ep.end.y)
        maxY = Math.max(maxY, ep.start.y, ep.end.y)

        // But also check if the arc passes through axis-aligned extremes
        const extremes = this._arcExtremes(e)
        for (const pt of extremes) {
          minX = Math.min(minX, pt.x)
          maxX = Math.max(maxX, pt.x)
          minY = Math.min(minY, pt.y)
          maxY = Math.max(maxY, pt.y)
        }
      }
    }

    return {
      minX, minY, maxX, maxY,
      width:  maxX - minX,
      height: maxY - minY,
    }
  }

  /**
   * Check if an arc sweeps through 0°, 90°, 180°, or 270° and add those 
   * extreme points to the bounding box computation.
   */
  _arcExtremes(arc) {
    const extremes = []
    const { center, radius, startAngle, endAngle, clockwise } = arc

    // Normalize angles to [0, 2π)
    const normalizeAngle = a => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
    const sa = normalizeAngle(startAngle)
    const ea = normalizeAngle(endAngle)

    // Check if angle θ is within the sweep
    const isInSweep = (theta) => {
      const t = normalizeAngle(theta)
      if (clockwise) {
        // CW: from sa going decreasing
        if (sa >= ea) return t <= sa && t >= ea
        else return t <= sa || t >= ea
      } else {
        // CCW: from sa going increasing
        if (ea >= sa) return t >= sa && t <= ea
        else return t >= sa || t <= ea
      }
    }

    // Check cardinal directions
    const cardinals = [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2]
    for (const theta of cardinals) {
      if (isInSweep(theta)) {
        extremes.push({
          x: center.x + radius * Math.cos(theta),
          y: center.y + radius * Math.sin(theta),
        })
      }
    }

    return extremes
  }

  /* ═══════════════════════════════════════════════════════════════════════════
   *  EDGE ENDPOINTS (duplicated from ExportService for independence)
   * ═══════════════════════════════════════════════════════════════════════════ */

  _edgeEndpoints(edge) {
    if (edge.type === 'line') {
      return {
        start: { x: edge.start.x, y: edge.start.y },
        end:   { x: edge.end.x,   y: edge.end.y },
      }
    }
    if (edge.type === 'arc') {
      return {
        start: {
          x: edge.center.x + edge.radius * Math.cos(edge.startAngle),
          y: edge.center.y + edge.radius * Math.sin(edge.startAngle),
        },
        end: {
          x: edge.center.x + edge.radius * Math.cos(edge.endAngle),
          y: edge.center.y + edge.radius * Math.sin(edge.endAngle),
        },
      }
    }
    return { start: { x: 0, y: 0 }, end: { x: 0, y: 0 } }
  }
}
