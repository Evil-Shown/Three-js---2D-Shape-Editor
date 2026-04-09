const mysql = require('mysql2/promise')
const mysql2 = require('mysql2')
const config = require('../config')

/**
 * Ensures the configured database exists (development only).
 * Production DBs are usually provisioned separately; CREATE DATABASE may be denied.
 */
async function ensureDatabaseExists() {
  const conn = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
  })
  try {
    const id = mysql2.escapeId(config.db.database)
    await conn.query(
      `CREATE DATABASE IF NOT EXISTS ${id} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    )
  } finally {
    await conn.end()
  }
}

module.exports = { ensureDatabaseExists }
