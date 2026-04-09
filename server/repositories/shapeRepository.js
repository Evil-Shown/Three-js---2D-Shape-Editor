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

  async delete(id, organizationId) {
    const [result] = await this.pool.query(
      `DELETE FROM shapes WHERE id = ? AND organization_id = ?`,
      [id, organizationId]
    )
    return result.affectedRows > 0
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
