const fs = require('fs')
const path = require('path')
const mysql = require('mysql2/promise')
const config = require('../config')

/**
 * Applies ordered .sql files from server/migrations once each.
 * Uses multipleStatements for whole-file execution.
 */
async function runMigrations(pool) {
  const dir = path.join(__dirname, '..', 'migrations')
  if (!fs.existsSync(dir)) return

  const conn = await pool.getConnection()
  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        filename VARCHAR(255) NOT NULL UNIQUE,
        applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `)

    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .sort()

    for (const file of files) {
      const [done] = await conn.query('SELECT 1 FROM schema_migrations WHERE filename = ? LIMIT 1', [file])
      if (done.length > 0) continue

      const sql = fs.readFileSync(path.join(dir, file), 'utf8')
      const migrationConn = await mysql.createConnection({
        host: config.db.host,
        port: config.db.port,
        user: config.db.user,
        password: config.db.password,
        database: config.db.database,
        multipleStatements: true,
      })
      try {
        await migrationConn.query(sql)
      } finally {
        await migrationConn.end()
      }

      await conn.query('INSERT INTO schema_migrations (filename) VALUES (?)', [file])
      console.log(`[migrations] applied: ${file}`)
    }
  } finally {
    conn.release()
  }
}

module.exports = { runMigrations }
