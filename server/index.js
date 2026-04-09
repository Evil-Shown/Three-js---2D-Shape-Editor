const config = require('./config')
const { createPool } = require('./db/pool')
const { ensureDatabaseExists } = require('./db/ensureDatabase')
const { runMigrations } = require('./db/runMigrations')
const { createApp } = require('./app')
const { startAckWorkerIfEnabled, shutdownQueue } = require('./services/queueService')

/** @type {import('mysql2/promise').Pool | undefined} */
let pool

async function bootstrap() {
  if (!config.isProd) {
    await ensureDatabaseExists()
  }
  pool = createPool()
  await runMigrations(pool)
  startAckWorkerIfEnabled()

  const app = createApp(pool)
  const server = app.listen(config.port, () => {
    console.log(`GSAP Editor API listening on port ${config.port} (${config.nodeEnv})`)
  })

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(
        `[server] Port ${config.port} is already in use. Stop the other process or set PORT in server/.env (e.g. PORT=3002).`
      )
    } else {
      console.error('[server] HTTP server error:', err.message)
    }
    process.exit(1)
  })

  const shutdown = async (signal) => {
    console.log(`\n${signal} received, shutting down...`)
    server.close(async () => {
      try {
        await shutdownQueue()
        if (pool) await pool.end()
      } finally {
        process.exit(0)
      }
    })
  }

  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
}

bootstrap().catch((err) => {
  console.error('Failed to start server:', err.message)
  process.exit(1)
})
