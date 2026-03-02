// server/index.js
// Express + MySQL backend for GSAP Shape Editor
// Provides REST API to save shape JSON exports to the database.

require('dotenv').config()
const express = require('express')
const cors    = require('cors')
const mysql   = require('mysql2/promise')

const app  = express()
const PORT = process.env.PORT || 3001

function normalizeShapeNumber(value) {
  if (value === undefined || value === null) return null
  const normalized = String(value).trim()
  return normalized.length > 0 ? normalized : null
}

function extractShapeNumber(shapeName, jsonData) {
  const fromMeta = normalizeShapeNumber(jsonData?.shapeMetadata?.shapeNumber)
  if (fromMeta) return fromMeta

  const fallbackName = String(shapeName || jsonData?.name || '').trim()
  const match = fallbackName.match(/(\d+)$/)
  return match ? match[1] : null
}

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors({ origin: 'http://localhost:5173' })) // Vite dev server
app.use(express.json({ limit: '10mb' }))

// ─── DB Connection Pool ───────────────────────────────────────────────────────
const pool = mysql.createPool({
  host    : process.env.DB_HOST     || 'localhost',
  port    : parseInt(process.env.DB_PORT || '3306'),
  user    : process.env.DB_USER     || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME     || 'gsap_editor',
  waitForConnections: true,
  connectionLimit   : 10,
})

// ─── Auto-create table if it doesn't exist ────────────────────────────────────
async function initDB() {
  const conn = await pool.getConnection()
  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS shapes (
        id           INT AUTO_INCREMENT PRIMARY KEY,
        shape_name   VARCHAR(255)  NOT NULL DEFAULT 'shape',
        shape_number VARCHAR(64)   NULL,
        json_data    LONGTEXT      NOT NULL,
        created_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_shapes_shape_number (shape_number)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `)

    const [shapeNumberCol] = await conn.query("SHOW COLUMNS FROM shapes LIKE 'shape_number'")
    if (shapeNumberCol.length === 0) {
      await conn.query('ALTER TABLE shapes ADD COLUMN shape_number VARCHAR(64) NULL AFTER shape_name')
    }

    await conn.query(`
      UPDATE shapes
      SET shape_number = NULLIF(JSON_UNQUOTE(JSON_EXTRACT(json_data, '$.shapeMetadata.shapeNumber')), '')
      WHERE (shape_number IS NULL OR shape_number = '')
        AND JSON_VALID(json_data)
    `)

    const [shapeNumberIndex] = await conn.query("SHOW INDEX FROM shapes WHERE Key_name = 'uq_shapes_shape_number'")
    if (shapeNumberIndex.length === 0) {
      try {
        await conn.query('CREATE UNIQUE INDEX uq_shapes_shape_number ON shapes (shape_number)')
      } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
          console.warn('⚠ Could not create unique shape_number index due to existing duplicate values.')
        } else {
          throw err
        }
      }
    }

    console.log('✅ Database table "shapes" ready.')
  } finally {
    conn.release()
  }
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// GET /api/shapes  — list all saved shapes (id, shape_name, created_at)
app.get('/api/shapes', async (_req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, shape_name, shape_number, created_at FROM shapes ORDER BY created_at DESC'
    )
    res.json({ success: true, shapes: rows })
  } catch (err) {
    console.error('GET /api/shapes error:', err)
    res.status(500).json({ success: false, error: err.message })
  }
})

// GET /api/shapes/next-number  — suggest the next available numeric shape number
app.get('/api/shapes/next-number', async (_req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT shape_number
      FROM shapes
      WHERE shape_number REGEXP '^[0-9]+$'
      ORDER BY CAST(shape_number AS UNSIGNED) DESC
      LIMIT 1
    `)

    const lastNumber = rows.length > 0 ? parseInt(rows[0].shape_number, 10) : 99
    const nextShapeNumber = String(Number.isFinite(lastNumber) ? lastNumber + 1 : 100)

    res.json({
      success: true,
      nextShapeNumber,
      suggestedClassName: `ShapeTransformer_${nextShapeNumber}`,
    })
  } catch (err) {
    console.error('GET /api/shapes/next-number error:', err)
    res.status(500).json({ success: false, error: err.message })
  }
})

// GET /api/shapes/:id  — get full JSON of a specific shape
app.get('/api/shapes/:id', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM shapes WHERE id = ?',
      [req.params.id]
    )
    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Shape not found' })
    }
    const shape = rows[0]
    shape.json_data = JSON.parse(shape.json_data)
    res.json({ success: true, shape })
  } catch (err) {
    console.error('GET /api/shapes/:id error:', err)
    res.status(500).json({ success: false, error: err.message })
  }
})

// POST /api/shapes  — save a new shape
// Body: { shape_name: string, json_data: object }
app.post('/api/shapes', async (req, res) => {
  const { shape_name, json_data } = req.body

  if (!json_data) {
    return res.status(400).json({ success: false, error: 'json_data is required' })
  }

  const name       = shape_name || json_data?.name || 'shape'
  const shapeNumber = extractShapeNumber(name, json_data)
  const jsonString = typeof json_data === 'string' ? json_data : JSON.stringify(json_data, null, 2)

  try {
    if (shapeNumber) {
      const [dupes] = await pool.query(
        'SELECT id, shape_name FROM shapes WHERE shape_number = ? LIMIT 1',
        [shapeNumber]
      )

      if (dupes.length > 0) {
        return res.status(409).json({
          success: false,
          error: `Shape number ${shapeNumber} already exists (shape \"${dupes[0].shape_name}\"). Change Shape Number and try again.`,
          code: 'DUPLICATE_SHAPE_NUMBER',
          shape_number: shapeNumber,
          existing_shape_id: dupes[0].id,
        })
      }
    }

    const [result] = await pool.query(
      'INSERT INTO shapes (shape_name, shape_number, json_data) VALUES (?, ?, ?)',
      [name, shapeNumber, jsonString]
    )
    res.status(201).json({
      success   : true,
      message   : `Shape "${name}" saved successfully.`,
      shape_id  : result.insertId,
      shape_name: name,
      shape_number: shapeNumber,
    })
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({
        success: false,
        error: 'Shape number already exists. Change Shape Number and try again.',
        code: 'DUPLICATE_SHAPE_NUMBER',
      })
    }
    console.error('POST /api/shapes error:', err)
    res.status(500).json({ success: false, error: err.message })
  }
})

// DELETE /api/shapes/:id  — delete a shape
app.delete('/api/shapes/:id', async (req, res) => {
  try {
    const [result] = await pool.query('DELETE FROM shapes WHERE id = ?', [req.params.id])
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, error: 'Shape not found' })
    }
    res.json({ success: true, message: 'Shape deleted.' })
  } catch (err) {
    console.error('DELETE /api/shapes/:id error:', err)
    res.status(500).json({ success: false, error: err.message })
  }
})

// ─── Start ────────────────────────────────────────────────────────────────────
initDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`🚀 GSAP Editor API running at http://localhost:${PORT}`)
    })
  })
  .catch(err => {
    console.error('❌ Failed to initialize DB:', err.message)
    console.error('   Make sure MySQL is running and .env credentials are correct.')
    process.exit(1)
  })
