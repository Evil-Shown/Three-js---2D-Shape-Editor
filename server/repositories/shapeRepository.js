const RENUMBER_START = 100

const TRANSFORMER_NAME = /^ShapeTransformer_\d+$/i

/**
 * Parse stored json_data into a plain object (handles mysql2 JSON column = object).
 */
function parseShapeJson(jsonInput) {
  if (jsonInput == null) return {}
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(jsonInput)) {
    return JSON.parse(jsonInput.toString('utf8'))
  }
  if (typeof jsonInput === 'object' && !Array.isArray(jsonInput)) {
    return JSON.parse(JSON.stringify(jsonInput))
  }
  return JSON.parse(String(jsonInput))
}

/**
 * Apply new catalog number: shape_number column is set separately; this updates
 * json so previews/editor match, and returns the DB shape_name to store.
 * Display names that follow the ShapeTransformer_N pattern (or match the old
 * class name) are moved to the new name so the gallery stays consistent.
 *
 * @param {string|Buffer|object} jsonInput
 * @param {string} newShapeNumber
 * @param {string|null|undefined} shapeNameDb current shapes.shape_name
 * @returns {{ jsonString: string, shape_name: string }}
 */
function patchShapeJsonForRenumber(jsonInput, newShapeNumber, shapeNameDb) {
  const newClass = `ShapeTransformer_${newShapeNumber}`
  if (jsonInput == null) {
    return {
      jsonString: JSON.stringify({
        name: newClass,
        shapeMetadata: {
          shapeNumber: newShapeNumber,
          className: newClass,
        },
      }),
      shape_name: newClass,
    }
  }
  try {
    const obj = parseShapeJson(jsonInput)
    if (!obj || typeof obj !== 'object') throw new Error('invalid')
    if (!obj.shapeMetadata) obj.shapeMetadata = {}

    const oldClass = obj.shapeMetadata.className != null ? String(obj.shapeMetadata.className).trim() : ''
    const oldName = obj.name != null ? String(obj.name).trim() : ''
    const dbName = shapeNameDb != null ? String(shapeNameDb).trim() : ''

    obj.shapeMetadata.shapeNumber = newShapeNumber
    obj.shapeMetadata.className = newClass

    const dbMatchesCatalog = TRANSFORMER_NAME.test(dbName)
    const jsonMatchesCatalog = TRANSFORMER_NAME.test(oldName)
    const jsonMatchedOldClass = Boolean(oldClass && oldName === oldClass)
    const dbMatchedOldClass = Boolean(oldClass && dbName === oldClass)

    let nextDbName = dbName || newClass
    if (dbMatchesCatalog || dbMatchedOldClass) {
      nextDbName = newClass
    }

    if (jsonMatchesCatalog || jsonMatchedOldClass) {
      obj.name = newClass
    } else if (dbMatchesCatalog || dbMatchedOldClass) {
      obj.name = newClass
    }

    return { jsonString: JSON.stringify(obj), shape_name: nextDbName }
  } catch {
    const fallback =
      typeof jsonInput === 'string' ? jsonInput : JSON.stringify(jsonInput)
    return { jsonString: fallback, shape_name: shapeNameDb != null ? String(shapeNameDb) : newClass }
  }
}

class ShapeRepository {
  constructor(pool) {
    this.pool = pool
  }

  normalizeShapeNumber(value) {
    if (value === undefined || value === null) return null
    const normalized = String(value).trim()
    return normalized.length > 0 ? normalized : null
  }

  extractShapeNumber(shapeName, jsonData) {
    const fromMeta = this.normalizeShapeNumber(jsonData?.shapeMetadata?.shapeNumber)
    if (fromMeta) return fromMeta
    const fallbackName = String(shapeName || jsonData?.name || '').trim()
    const match = fallbackName.match(/(\d+)$/)
    return match ? this.normalizeShapeNumber(match[1]) : null
  }

  async findDuplicateShapeNumber(organizationId, shapeNumber, excludeShapeId = null) {
    if (!shapeNumber) return null
    let sql = `SELECT id, shape_name FROM shapes
       WHERE organization_id = ? AND shape_number = ?`
    const params = [organizationId, shapeNumber]
    if (excludeShapeId != null && excludeShapeId !== '') {
      const ex = Number.parseInt(String(excludeShapeId), 10)
      if (Number.isFinite(ex)) {
        sql += ` AND id <> ?`
        params.push(ex)
      }
    }
    sql += ` LIMIT 1`
    const [rows] = await this.pool.query(sql, params)
    return rows.length ? rows[0] : null
  }

  async insertShape(conn, row) {
    const [result] = await conn.query(
      `INSERT INTO shapes (
        shape_name, shape_number, user_id, organization_id, project_id,
        json_data, status, current_version
      ) VALUES (?, ?, ?, ?, ?, ?, 'pending', 1)`,
      [
        row.shape_name,
        row.shape_number,
        row.user_id,
        row.organization_id,
        row.project_id,
        row.json_data,
      ]
    )
    return result.insertId
  }

  async insertVersion(conn, shapeId, version, jsonString, userId) {
    await conn.query(
      `INSERT INTO shape_versions (shape_id, version, json_data, user_id)
       VALUES (?, ?, ?, ?)`,
      [shapeId, version, jsonString, userId]
    )
  }

  async findById(id, organizationId = null) {
    let sql = `SELECT * FROM shapes WHERE id = ?`
    const params = [id]
    if (organizationId != null && organizationId !== '') {
      sql += ` AND organization_id = ?`
      params.push(organizationId)
    }
    const [rows] = await this.pool.query(sql, params)
    return rows[0] || null
  }

  async listForOrg({ organizationId, projectId, status, page, limit, includeJson }) {
    const offset = (page - 1) * limit
    const where = ['organization_id = ?']
    const params = [organizationId]
    if (projectId) {
      where.push('project_id = ?')
      params.push(projectId)
    }
    if (status) {
      where.push('status = ?')
      params.push(status)
    }
    const whereSql = where.join(' AND ')
    const jsonCol = includeJson ? ', json_data' : ''
    const [rows] = await this.pool.query(
      `SELECT id, shape_name, shape_number, status, project_id, user_id,
              created_at, updated_at, current_version${jsonCol}
       FROM shapes WHERE ${whereSql}
       ORDER BY updated_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    )
    const [[{ total }]] = await this.pool.query(
      `SELECT COUNT(*) AS total FROM shapes WHERE ${whereSql}`,
      params
    )
    return { rows, total }
  }

  async delete(id, organizationId, conn = null) {
    const executor = conn || this.pool
    const [result] = await executor.query(
      `DELETE FROM shapes WHERE id = ? AND organization_id = ?`,
      [id, organizationId]
    )
    return result.affectedRows > 0
  }

  /**
   * After a delete, assign contiguous shape numbers (100, 101, …) by id order
   * and sync json_data.shapeMetadata for each row. Uses a two-phase update to
   * satisfy UNIQUE(organization_id, shape_number).
   */
  async renumberOrganizationShapes(conn, organizationId) {
    const [rows] = await conn.query(
      `SELECT id, shape_name, json_data FROM shapes WHERE organization_id = ? ORDER BY id ASC`,
      [organizationId]
    )
    if (!rows.length) return { renumbered: 0 }

    for (const r of rows) {
      await conn.query(
        `UPDATE shapes SET shape_number = ? WHERE id = ? AND organization_id = ?`,
        [`__tmp_${r.id}`, r.id, organizationId]
      )
    }

    for (let i = 0; i < rows.length; i++) {
      const newNum = String(RENUMBER_START + i)
      const { jsonString, shape_name } = patchShapeJsonForRenumber(
        rows[i].json_data,
        newNum,
        rows[i].shape_name
      )
      await conn.query(
        `UPDATE shapes SET shape_number = ?, shape_name = ?, json_data = ? WHERE id = ? AND organization_id = ?`,
        [newNum, shape_name, jsonString, rows[i].id, organizationId]
      )
    }
    return { renumbered: rows.length }
  }

  async updateShapeRow(conn, { id, organizationId, shape_name, shape_number, json_data, nextVersion, user_id }) {
    const [result] = await conn.query(
      `UPDATE shapes SET
        shape_name = ?,
        shape_number = ?,
        json_data = ?,
        current_version = ?,
        status = 'pending',
        status_message = NULL,
        user_id = COALESCE(?, user_id),
        updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND organization_id = ?`,
      [shape_name, shape_number, json_data, nextVersion, user_id, id, organizationId]
    )
    return result.affectedRows > 0
  }

  async getNextShapeNumber(organizationId) {
    const [rows] = await this.pool.query(
      `SELECT shape_number FROM shapes
       WHERE organization_id = ? AND shape_number REGEXP '^[0-9]+$'
       ORDER BY CAST(shape_number AS UNSIGNED) DESC
       LIMIT 1`,
      [organizationId]
    )
    const lastNumber = rows.length > 0 ? parseInt(rows[0].shape_number, 10) : 99
    const nextShapeNumber = String(Number.isFinite(lastNumber) ? lastNumber + 1 : 100)
    return {
      nextShapeNumber,
      suggestedClassName: `ShapeTransformer_${nextShapeNumber}`,
    }
  }
}

module.exports = { ShapeRepository }
