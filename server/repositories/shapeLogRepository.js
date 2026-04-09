class ShapeLogRepository {
  constructor(pool) {
    this.pool = pool
  }

  async append(shapeId, level, message, metadata = null) {
    await this.pool.query(
      `INSERT INTO shape_processing_logs (shape_id, level, message, metadata)
       VALUES (?, ?, ?, ?)`,
      [shapeId, level, message, metadata ? JSON.stringify(metadata) : null]
    )
  }
}

module.exports = { ShapeLogRepository }
