const jwt = require('jsonwebtoken')
const config = require('../config')
const { AppError } = require('./AppError')

/**
 * Verifies Bearer JWT and attaches ERP context to req.user.
 * Set AUTH_DISABLED=true for local editor use without an IdP.
 */
function authMiddleware(req, _res, next) {
  if (config.jwt.authDisabled) {
    req.user = {
      userId: req.header('x-user-id') || 'local-dev',
      organizationId: req.header('x-organization-id') || '',
      projectId: req.header('x-project-id') || null,
    }
    return next()
  }

  const header = req.headers.authorization || ''
  const [type, token] = header.split(' ')
  if (type !== 'Bearer' || !token) {
    return next(new AppError('Unauthorized', 401, 'UNAUTHORIZED'))
  }

  try {
    const payload = jwt.verify(token, config.jwt.secret)
    const c = config.jwt.claims
    req.user = {
      userId: String(payload[c.userId] ?? payload.sub ?? ''),
      organizationId: String(payload[c.organizationId] ?? ''),
      projectId: payload[c.projectId] != null ? String(payload[c.projectId]) : null,
    }
    if (!req.user.organizationId) {
      return next(new AppError('Token missing organization_id', 403, 'FORBIDDEN'))
    }
    next()
  } catch (e) {
    next(new AppError('Invalid or expired token', 401, 'UNAUTHORIZED'))
  }
}

module.exports = { authMiddleware }
