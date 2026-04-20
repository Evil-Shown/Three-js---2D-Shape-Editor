const { AppError } = require('../middleware/AppError')
const { ShapeRepository } = require('../repositories/shapeRepository')
const { ShapeLogRepository } = require('../repositories/shapeLogRepository')
const { enqueueShapeProcessing } = require('./queueService')
const config = require('../config')

class ShapeService {
  constructor(pool) {
    this.pool = pool
    this.shapes = new ShapeRepository(pool)
    this.logs = new ShapeLogRepository(pool)
  }

  async createShape({ shape_name, json_data }, user) {
    const name = shape_name || json_data?.name || 'shape'
    const shapeNumber = this.shapes.extractShapeNumber(name, json_data)
    const jsonString = typeof json_data === 'string' ? json_data : JSON.stringify(json_data, null, 2)

    const dup = await this.shapes.findDuplicateShapeNumber(user.organizationId, shapeNumber)
    if (dup) {
      throw new AppError(
        `Shape number ${shapeNumber} already exists ("${dup.shape_name}").`,
        409,
        'DUPLICATE_SHAPE_NUMBER',
        { shape_number: shapeNumber, existing_shape_id: dup.id }
      )
    }

    const conn = await this.pool.getConnection()
    let shapeId
    try {
      await conn.beginTransaction()
      shapeId = await this.shapes.insertShape(conn, {
        shape_name: name,
        shape_number: shapeNumber,
        user_id: user.userId,
        organization_id: user.organizationId,
        project_id: user.projectId,
        json_data: jsonString,
      })
      await this.shapes.insertVersion(conn, shapeId, 1, jsonString, user.userId)
      await conn.commit()
    } catch (err) {
      await conn.rollback()
      if (err.code === 'ER_DUP_ENTRY') {
        throw new AppError('Shape number already exists for this organization.', 409, 'DUPLICATE_SHAPE_NUMBER')
      }
      throw err
    } finally {
      conn.release()
    }

    await this.logs.append(shapeId, 'info', 'Shape saved; queued for processing', {
      userId: user.userId,
    })

    let queue_failed = false
    try {
      await enqueueShapeProcessing(shapeId)
    } catch (err) {
      console.error('[shapeService] enqueue failed', err)
      await this.logs.append(shapeId, 'error', 'Failed to enqueue processing job', { error: String(err) })
      queue_failed = true
    }

    return {
      shape_id: shapeId,
      shape_name: name,
      shape_number: shapeNumber,
      status: 'pending',
      queue_failed,
    }
  }

  async listShapes(user, query) {
    const includeJson =
      query.include_json === true ||
      query.include_json === 'true' ||
      query.include_json === '1' ||
      query.include_json === 1
    const { rows, total } = await this.shapes.listForOrg({
      organizationId: user.organizationId,
      projectId: query.project_id || null,
      status: query.status || null,
      page: query.page,
      limit: query.limit,
      includeJson,
    })
    const shapes = includeJson
      ? rows.map((r) => {
          let parsed = null
          try {
            parsed = typeof r.json_data === 'string' ? JSON.parse(r.json_data) : r.json_data
          } catch {
            parsed = null
          }
          const { json_data: _j, ...rest } = r
          return { ...rest, json_data: parsed }
        })
      : rows
    return {
      shapes,
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit) || 1,
    }
  }

  async getShape(id, user) {
    const row = await this.shapes.findById(id, user.organizationId)
    if (!row) {
      throw new AppError('Shape not found', 404, 'NOT_FOUND')
    }
    try {
      row.json_data = JSON.parse(row.json_data)
    } catch {
      throw new AppError('Stored shape JSON is corrupted', 500, 'INVALID_JSON')
    }
    return row
  }

  async getStatus(id, user) {
    const row = await this.shapes.findById(id, user.organizationId)
    if (!row) {
      throw new AppError('Shape not found', 404, 'NOT_FOUND')
    }
    return {
      id: row.id,
      status: row.status,
      status_message: row.status_message,
      updated_at: row.updated_at,
      current_version: row.current_version,
    }
  }

  async deleteShape(id, user) {
    const numericId = Number.parseInt(String(id), 10)
    if (!Number.isFinite(numericId)) {
      throw new AppError('Invalid shape id', 400, 'INVALID_ID')
    }

    const existing = await this.shapes.findById(numericId, user.organizationId)
    if (!existing) {
      throw new AppError('Shape not found', 404, 'NOT_FOUND')
    }

    // Keep editor and Opti library in sync: remove the published custom-shape row first.
    // If remote sync fails we abort local delete to avoid diverging catalogs.
    await this.deletePublishedCustomShape(existing, user)

    const conn = await this.pool.getConnection()
    let renumbered = 0
    try {
      await conn.beginTransaction()
      const ok = await this.shapes.delete(numericId, user.organizationId, conn)
      if (!ok) {
        throw new AppError('Shape not found', 404, 'NOT_FOUND')
      }
      const { renumbered: n } = await this.shapes.renumberOrganizationShapes(conn, user.organizationId)
      renumbered = n
      await conn.commit()
    } catch (err) {
      try {
        await conn.rollback()
      } catch {
        /* ignore */
      }
      throw err
    } finally {
      conn.release()
    }

    return { deleted: true, renumbered }
  }

  async deletePublishedCustomShape(existingShapeRow, user) {
    let jsonObj = null
    try {
      jsonObj =
        typeof existingShapeRow.json_data === 'string'
          ? JSON.parse(existingShapeRow.json_data)
          : existingShapeRow.json_data
    } catch {
      jsonObj = null
    }

    const className =
      (jsonObj &&
        jsonObj.shapeMetadata &&
        typeof jsonObj.shapeMetadata.className === 'string' &&
        jsonObj.shapeMetadata.className.trim()) ||
      null

    // The editor numbers shapes in the designer range (100+) while shapes-service
    // stores publications in the runtime range (44..99). So editor shape_number
    // will almost never match shapes-service shape_no — className is the real
    // join key. Send both and let the server OR them.
    // organizationId is optional: in local/dev runs we publish with `null` scope,
    // so pass null through instead of silently skipping the remote delete.
    const orgRaw = user?.organizationId
    const orgStr = orgRaw == null ? '' : String(orgRaw).trim()
    const orgNum = orgStr === '' ? null : Number(orgStr)

    const payload = {
      organizationId: Number.isFinite(orgNum) ? orgNum : null,
      editorShapeNo: existingShapeRow.shape_number ? String(existingShapeRow.shape_number) : null,
      editorClassName: className,
    }

    let res
    try {
      res = await fetch(
        `${config.shapesServiceBaseUrl}/v1/library/custom-shapes/sync-delete`,
        {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      )
    } catch (err) {
      // Network errors shouldn't strand the user with a broken local delete.
      // Surface the failure but don't throw — local delete still proceeds so the
      // editor gallery reflects the user's intent. A retry button in Opti can
      // reconcile later.
      console.warn('[shapeService] shapes-service sync-delete unreachable:', err?.message || err)
      return { synced: false, reason: 'unreachable' }
    }

    let body = null
    try {
      body = await res.json()
    } catch {
      body = null
    }

    if (!res.ok) {
      const msg =
        (body && (body.error || body.message)) ||
        `Shapes-service sync delete failed (${res.status})`
      throw new AppError(msg, 502, 'SHAPES_SERVICE_SYNC_DELETE_FAILED')
    }

    return { synced: true, remoteDeleted: Boolean(body && body.deleted) }
  }

  async nextNumber(user) {
    return this.shapes.getNextShapeNumber(user.organizationId)
  }

  async updateShape(id, { shape_name, json_data }, user) {
    const numericId = Number.parseInt(String(id), 10)
    if (!Number.isFinite(numericId)) {
      throw new AppError('Invalid shape id', 400, 'INVALID_ID')
    }

    const existing = await this.shapes.findById(numericId, user.organizationId)
    if (!existing) {
      throw new AppError('Shape not found', 404, 'NOT_FOUND')
    }

    const name = shape_name || json_data?.name || existing.shape_name || 'shape'
    // For updates, preserve current shape_number by default.
    // Only change it when metadata explicitly provides a new value.
    const explicitShapeNumber = this.shapes.normalizeShapeNumber(json_data?.shapeMetadata?.shapeNumber)
    const shapeNumber =
      explicitShapeNumber ??
      this.shapes.normalizeShapeNumber(existing.shape_number) ??
      this.shapes.extractShapeNumber(name, json_data)
    const jsonString = typeof json_data === 'string' ? json_data : JSON.stringify(json_data, null, 2)

    const newNum = this.shapes.normalizeShapeNumber(shapeNumber)
    const existingNum = this.shapes.normalizeShapeNumber(existing.shape_number)
    // Only check cross-row conflicts when the logical shape number actually changes.
    // Same number → same row update (avoids false "already exists" if id/exclude coercion failed).
    if (newNum && newNum !== existingNum) {
      const dup = await this.shapes.findDuplicateShapeNumber(user.organizationId, newNum, numericId)
      if (dup) {
        throw new AppError(
          `Shape number ${newNum} already exists ("${dup.shape_name}").`,
          409,
          'DUPLICATE_SHAPE_NUMBER',
          { shape_number: newNum, existing_shape_id: dup.id }
        )
      }
    }

    const nextVersion = (existing.current_version || 1) + 1

    const conn = await this.pool.getConnection()
    try {
      await conn.beginTransaction()
      const ok = await this.shapes.updateShapeRow(conn, {
        id: numericId,
        organizationId: user.organizationId,
        shape_name: name,
        shape_number: shapeNumber,
        json_data: jsonString,
        nextVersion,
        user_id: user.userId,
      })
      if (!ok) {
        throw new AppError('Shape not found', 404, 'NOT_FOUND')
      }
      await this.shapes.insertVersion(conn, numericId, nextVersion, jsonString, user.userId)
      await conn.commit()
    } catch (err) {
      await conn.rollback()
      if (err.code === 'ER_DUP_ENTRY') {
        throw new AppError('Shape number already exists for this organization.', 409, 'DUPLICATE_SHAPE_NUMBER')
      }
      throw err
    } finally {
      conn.release()
    }

    await this.logs.append(numericId, 'info', 'Shape updated; queued for processing', {
      userId: user.userId,
    })

    let queue_failed = false
    try {
      await enqueueShapeProcessing(numericId)
    } catch (err) {
      console.error('[shapeService] enqueue failed (update)', err)
      await this.logs.append(numericId, 'error', 'Failed to enqueue processing job', { error: String(err) })
      queue_failed = true
    }

    return {
      shape_id: numericId,
      shape_name: name,
      shape_number: shapeNumber,
      status: 'pending',
      queue_failed,
    }
  }
}

module.exports = { ShapeService }
