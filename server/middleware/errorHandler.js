const config = require('../config')
const { AppError } = require('./AppError')

function errorHandler(err, req, res, _next) {
  if (res.headersSent) return

  const status = err instanceof AppError ? err.statusCode : err.statusCode || 500
  const code = err instanceof AppError ? err.code : undefined
  const details = err instanceof AppError ? err.details : undefined

  if (status >= 500) {
    console.error('[api]', req.method, req.path, err)
  }

  const body = {
    success: false,
    error: err.message || 'Internal Server Error',
  }
  if (code) body.code = code
  if (details !== undefined) body.details = details
  if (!config.isProd && status >= 500 && err.stack) {
    body.stack = err.stack
  }

  res.status(status).json(body)
}

module.exports = { errorHandler }
