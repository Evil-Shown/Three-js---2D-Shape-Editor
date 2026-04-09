import * as THREE from 'three'

/**
 * Build a compact SVG preview path from export payload edges (CAD-style stroke).
 * @param {object} payload
 * @param {{ width?: number, height?: number, pad?: number }} opts
 * @returns {{ svg: string, viewBox: string } | null}
 */
export function shapePayloadToSvg(payload, opts = {}) {
  const w = opts.width ?? 280
  const h = opts.height ?? 200
  const pad = opts.pad ?? 14
  const edges = payload && Array.isArray(payload.edges) ? payload.edges : []
  if (edges.length === 0) return null

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  const bump = (x, y) => {
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }

  for (const e of edges) {
    const t = String(e.type || '').toLowerCase()
    if (t === 'line' && e.start && e.end) {
      bump(e.start.x, e.start.y)
      bump(e.end.x, e.end.y)
    } else if (t === 'arc' && e.center && e.radius != null) {
      const cx = e.center.x
      const cy = e.center.y
      const r = Math.abs(e.radius)
      bump(cx - r, cy - r)
      bump(cx + r, cy + r)
    }
  }

  if (!Number.isFinite(minX) || minX === Infinity) return null

  const bw = Math.max(maxX - minX, 1e-6)
  const bh = Math.max(maxY - minY, 1e-6)
  const sx = (w - 2 * pad) / bw
  const sy = (h - 2 * pad) / bh
  const sc = Math.min(sx, sy)
  const ox = pad + (w - 2 * pad - bw * sc) / 2
  const oy = pad + (h - 2 * pad - bh * sc) / 2

  const tx = (x) => ox + (x - minX) * sc
  const ty = (y) => oy + (maxY - y) * sc

  const parts = []
  for (const e of edges) {
    const t = String(e.type || '').toLowerCase()
    if (t === 'line' && e.start && e.end) {
      parts.push(
        `M ${tx(e.start.x).toFixed(2)} ${ty(e.start.y).toFixed(2)} L ${tx(e.end.x).toFixed(2)} ${ty(e.end.y).toFixed(2)}`
      )
    } else if (t === 'arc' && e.center && e.radius != null) {
      const curve = new THREE.EllipseCurve(
        e.center.x,
        e.center.y,
        Math.abs(e.radius),
        Math.abs(e.radius),
        e.startAngle,
        e.endAngle,
        e.clockwise,
        0
      )
      const arcPts = curve.getPoints(48)
      if (arcPts.length > 0) {
        const p0 = arcPts[0]
        parts.push(`M ${tx(p0.x).toFixed(2)} ${ty(p0.y).toFixed(2)}`)
        for (let i = 1; i < arcPts.length; i++) {
          const p = arcPts[i]
          parts.push(`L ${tx(p.x).toFixed(2)} ${ty(p.y).toFixed(2)}`)
        }
      }
    }
  }

  if (parts.length === 0) return null

  const d = parts.join(' ')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true"><rect width="100%" height="100%" fill="transparent"/><path d="${d}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`

  return { svg, viewBox: `0 0 ${w} ${h}` }
}
