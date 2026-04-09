const config = require('./config')
const { createPool } = require('./db/pool')
const { runMigrations } = require('./db/runMigrations')
const { createApp } = require('./app')
const { startAckWorkerIfEnabled, shutdownQueue } = require('./services/queueService')

const pool = createPool()

async function bootstrap() {
  await runMigrations(pool)
  startAckWorkerIfEnabled()

  const app = createApp(pool)
  const server = app.listen(config.port, () => {
    console.log(`GSAP Editor API listening on port ${config.port} (${config.nodeEnv})`)
  })

  const shutdown = async (signal) => {
    console.log(`\n${signal} received, shutting down...`)
    server.close(async () => {
      try {
        await shutdownQueue()
        await pool.end()
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
