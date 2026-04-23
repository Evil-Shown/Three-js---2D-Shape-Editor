#!/usr/bin/env node
import fs from 'node:fs/promises'
import path from 'node:path'
import mysql from 'mysql2/promise'

const EPS = 1.5
const argv = new Set(process.argv.slice(2))
const apply = argv.has('--apply')

const dbConfig = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'shapes',
}

const tableName = process.env.CUSTOM_SHAPES_TABLE || 'custom_shapes'
const idCol = process.env.CUSTOM_SHAPES_ID_COL || 'shape_no'
const jsonCol = process.env.CUSTOM_SHAPES_JSON_COL || 'json_definition'

function isLiteralExpr(expr) {
  return typeof expr === 'string' && !/[a-zA-Z]/.test(expr) && !Number.isNaN(Number(expr))
}

function formatNumberLiteral(value) {
  const rounded = Math.round(value * 10000) / 10000
  return Number(rounded).toString()
}

function readParams(root) {
  const node = root?.parameters
  if (!node) return []
  if (Array.isArray(node)) {
    return node
      .map(p => ({ name: p?.name, defaultValue: Number(p?.defaultValue ?? p?.value) }))
      .filter(p => p.name && Number.isFinite(p.defaultValue))
  }
  if (typeof node === 'object') {
    return Object.entries(node)
      .map(([name, v]) => ({ name, defaultValue: Number(v) }))
      .filter(p => Number.isFinite(p.defaultValue))
  }
  return []
}

function collectPointCoords(root) {
  const pointX = new Map()
  const pointY = new Map()
  const edges = Array.isArray(root?.edges) ? root.edges : []
  const parametricEdges = Array.isArray(root?.parametricEdges) ? root.parametricEdges : []

  const frozenById = new Map(edges.map(e => [e?.id, e]))
  for (const pe of parametricEdges) {
    const frozen = frozenById.get(pe?.edgeId)
    if (!frozen || !pe?.startPoint || !pe?.endPoint) continue
    const sx = Number(frozen?.start?.x)
    const sy = Number(frozen?.start?.y)
    const ex = Number(frozen?.end?.x)
    const ey = Number(frozen?.end?.y)
    if (![sx, sy, ex, ey].every(Number.isFinite)) continue
    if (!pointX.has(pe.startPoint)) pointX.set(pe.startPoint, sx)
    if (!pointY.has(pe.startPoint)) pointY.set(pe.startPoint, sy)
    if (!pointX.has(pe.endPoint)) pointX.set(pe.endPoint, ex)
    if (!pointY.has(pe.endPoint)) pointY.set(pe.endPoint, ey)
  }
  return { pointX, pointY }
}

function matchDeltaToExpression(delta, axis, params) {
  const dimParam = axis === 'x'
    ? params.find(p => p.name === 'L')
    : params.find(p => p.name === 'H')
  const otherDimParam = axis === 'x'
    ? params.find(p => p.name === 'H')
    : params.find(p => p.name === 'L')
  const dim = dimParam ? dimParam.defaultValue : null
  const dimName = dimParam ? dimParam.name : null
  const otherDim = otherDimParam ? otherDimParam.defaultValue : null
  const otherDimName = otherDimParam ? otherDimParam.name : null

  const candidates = [{ value: 0, expr: `p0.${axis}` }]

  for (const p of params) {
    const v = p.defaultValue
    if (v === 0) continue
    candidates.push(
      { value: v, expr: `p0.${axis} + ${p.name}` },
      { value: -v, expr: `p0.${axis} - ${p.name}` },
    )
  }

  if (dim != null) {
    candidates.push(
      { value: dim, expr: `p0.${axis} + ${dimName}` },
      { value: -dim, expr: `p0.${axis} - ${dimName}` },
    )
    for (const p of params) {
      if (p.name === dimName || p.defaultValue === 0) continue
      candidates.push(
        { value: dim - p.defaultValue, expr: `p0.${axis} + ${dimName} - ${p.name}` },
        { value: dim + p.defaultValue, expr: `p0.${axis} + ${dimName} + ${p.name}` },
        { value: -(dim - p.defaultValue), expr: `p0.${axis} - ${dimName} + ${p.name}` },
        { value: dim - 2 * p.defaultValue, expr: `p0.${axis} + ${dimName} - 2 * ${p.name}` },
      )
    }
  }

  if (otherDim != null && dimName && Math.abs(dim - otherDim) > EPS) {
    candidates.push(
      { value: otherDim, expr: `p0.${axis} + ${otherDimName}` },
      { value: -otherDim, expr: `p0.${axis} - ${otherDimName}` },
    )
    for (const p of params) {
      if (p.name === otherDimName || p.defaultValue === 0) continue
      candidates.push(
        { value: otherDim - p.defaultValue, expr: `p0.${axis} + ${otherDimName} - ${p.name}` },
        { value: otherDim + p.defaultValue, expr: `p0.${axis} + ${otherDimName} + ${p.name}` },
      )
    }
  }

  if (dim != null) {
    candidates.push({ value: dim / 2, expr: `p0.${axis} + ${dimName} / 2` })
    for (const p of params) {
      if (p.name === dimName || p.defaultValue === 0) continue
      candidates.push(
        { value: dim / 2 + p.defaultValue, expr: `p0.${axis} + ${dimName} / 2 + ${p.name}` },
        { value: dim / 2 - p.defaultValue, expr: `p0.${axis} + ${dimName} / 2 - ${p.name}` },
      )
    }
  }

  for (let i = 0; i < params.length; i++) {
    for (let j = i + 1; j < params.length; j++) {
      const a = params[i]
      const b = params[j]
      if (a.defaultValue === 0 || b.defaultValue === 0) continue
      candidates.push(
        { value: a.defaultValue + b.defaultValue, expr: `p0.${axis} + ${a.name} + ${b.name}` },
        { value: a.defaultValue - b.defaultValue, expr: `p0.${axis} + ${a.name} - ${b.name}` },
        { value: -(a.defaultValue - b.defaultValue), expr: `p0.${axis} - ${a.name} + ${b.name}` },
        { value: -(a.defaultValue + b.defaultValue), expr: `p0.${axis} - ${a.name} - ${b.name}` },
      )
    }
  }

  let best = null
  let bestErr = Infinity
  for (const c of candidates) {
    const err = Math.abs(delta - c.value)
    if (err < EPS && err < bestErr) {
      bestErr = err
      best = c
    }
  }
  return best ? best.expr : null
}

function synthesizePointExpressions(jsonObj) {
  const pointExprs = jsonObj?.pointExpressions
  if (!pointExprs || typeof pointExprs !== 'object') {
    return { changed: false, converted: [], remainingLiteral: [] }
  }

  const { pointX, pointY } = collectPointCoords(jsonObj)
  const p0x = pointX.get('p0')
  const p0y = pointY.get('p0')
  const params = readParams(jsonObj)

  if (!Number.isFinite(p0x) || !Number.isFinite(p0y) || params.length === 0) {
    const remaining = Object.entries(pointExprs)
      .filter(([, expr]) => isLiteralExpr(expr?.x) || isLiteralExpr(expr?.y))
      .map(([pointId]) => pointId)
    return { changed: false, converted: [], remainingLiteral: [...new Set(remaining)] }
  }

  const converted = new Set()
  let changed = false

  for (const [pointId, expr] of Object.entries(pointExprs)) {
    if (pointId === 'p0' || !expr || typeof expr !== 'object') continue
    const currentX = expr.x
    const currentY = expr.y

    if (isLiteralExpr(currentX) && pointX.has(pointId)) {
      const delta = Number(currentX) - p0x
      const derived = matchDeltaToExpression(delta, 'x', params)
      if (derived) {
        expr.x = derived
        changed = true
        converted.add(pointId)
      }
    }

    if (isLiteralExpr(currentY) && pointY.has(pointId)) {
      const delta = Number(currentY) - p0y
      const derived = matchDeltaToExpression(delta, 'y', params)
      if (derived) {
        expr.y = derived
        changed = true
        converted.add(pointId)
      }
    }
  }

  const remainingLiteral = []
  for (const [pointId, expr] of Object.entries(pointExprs)) {
    if (!expr || typeof expr !== 'object') continue
    if (isLiteralExpr(expr.x) || isLiteralExpr(expr.y)) remainingLiteral.push(pointId)
  }

  const completeness = (jsonObj.parametricCompleteness && typeof jsonObj.parametricCompleteness === 'object')
    ? jsonObj.parametricCompleteness
    : (jsonObj.parametricCompleteness = {})
  completeness.allPointsParametric = remainingLiteral.length === 0
  const allArcsParametric = completeness.allArcsParametric !== false
  completeness.fullyParametric = completeness.allPointsParametric && allArcsParametric
  completeness.literalPoints = [...new Set(remainingLiteral)]
  if (!Array.isArray(completeness.unmatchedArcs)) completeness.unmatchedArcs = []

  return { changed, converted: [...converted], remainingLiteral: [...new Set(remainingLiteral)] }
}

async function main() {
  const conn = await mysql.createConnection(dbConfig)
  try {
    const [rows] = await conn.query(
      `SELECT ${idCol} AS shapeNo, ${jsonCol} AS jsonDefinition FROM ${tableName} WHERE ${jsonCol} IS NOT NULL`
    )

    const backup = []
    let changedCount = 0

    for (const row of rows) {
      const shapeNo = row.shapeNo
      const src = row.jsonDefinition
      if (!src || typeof src !== 'string') continue

      let parsed
      try {
        parsed = JSON.parse(src)
      } catch {
        console.log(`[MIGRATE] shape_no=${shapeNo} skipped=invalid_json`)
        continue
      }

      const result = synthesizePointExpressions(parsed)
      const next = JSON.stringify(parsed)
      const changed = next !== src

      console.log(
        `[MIGRATE] shape_no=${shapeNo} converted=[${result.converted.join(',')}] remaining=[${result.remainingLiteral.join(',')}] changed=${changed}`
      )

      if (!changed) continue
      changedCount++
      backup.push({
        shape_no: shapeNo,
        before: src,
        after: next,
        converted: result.converted,
        remainingLiteral: result.remainingLiteral,
      })

      if (apply) {
        await conn.execute(
          `UPDATE ${tableName} SET ${jsonCol} = ? WHERE ${idCol} = ? AND ${jsonCol} = ?`,
          [next, shapeNo, src]
        )
      }
    }

    const backupDir = path.resolve(process.cwd(), 'migration-backups')
    await fs.mkdir(backupDir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backupPath = path.join(backupDir, `custom-shape-point-expr-${stamp}.json`)
    await fs.writeFile(backupPath, JSON.stringify({
      timestamp: new Date().toISOString(),
      mode: apply ? 'apply' : 'dry-run',
      totalRows: rows.length,
      changedRows: changedCount,
      db: { ...dbConfig, password: dbConfig.password ? '***' : '' },
      updates: backup,
    }, null, 2))

    console.log(`[MIGRATE] done mode=${apply ? 'APPLY' : 'DRY_RUN'} total=${rows.length} changed=${changedCount}`)
    console.log(`[MIGRATE] backup=${backupPath}`)
  } finally {
    await conn.end()
  }
}

main().catch(err => {
  console.error('[MIGRATE] fatal', err?.message || err)
  process.exit(1)
})

