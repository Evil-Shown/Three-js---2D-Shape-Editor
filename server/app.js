const express = require('express')
const cors = require('cors')
const config = require('./config')
const { AppError } = require('./middleware/AppError')
const { errorHandler } = require('./middleware/errorHandler')
const healthRoutes = require('./routes/healthRoutes')
const { createShapeRouter } = require('./routes/shapeRoutes')

function createApp(pool) {
  const app = express()

  // Opti-Shapes calls us with custom `x-organization-id` / `x-user-id` headers,
  // which the browser treats as non-simple → it sends a CORS preflight first.
  // Without allowedHeaders declared explicitly, those preflights fail with
  // "Failed to fetch" in the Opti UI when deleting a custom shape.
  const corsOptions = {
    origin: config.corsOrigins.length ? config.corsOrigins : true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'x-organization-id',
      'x-user-id',
    ],
  }
  app.use(cors(corsOptions))
  // Explicit preflight short-circuit so OPTIONS requests never fall through to
  // the 404 handler below (the `cors` middleware alone already handles them,
  // but this makes the intent obvious and robust to future middleware changes).
  app.options('*', cors(corsOptions))
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
