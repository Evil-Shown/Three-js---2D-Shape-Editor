const express = require('express')
const cors = require('cors')
const config = require('./config')
const { AppError } = require('./middleware/AppError')
const { errorHandler } = require('./middleware/errorHandler')
const healthRoutes = require('./routes/healthRoutes')
const { createShapeRouter } = require('./routes/shapeRoutes')

function createApp(pool) {
  const app = express()

  app.use(
    cors({
      origin: config.corsOrigins.length ? config.corsOrigins : true,
      credentials: true,
    })
  )
  app.use(express.json({ limit: '10mb' }))

  app.use('/api', healthRoutes)
  app.use('/api', createShapeRouter(pool))

  app.use((_req, _res, next) => {
    next(new AppError('Not Found', 404, 'NOT_FOUND'))
  })

  app.use(errorHandler)

  return app
}

module.exports = { createApp }
