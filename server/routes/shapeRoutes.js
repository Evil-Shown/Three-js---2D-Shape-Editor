const express = require('express')
const { createShapeController } = require('../controllers/shapeController')
const { authMiddleware } = require('../middleware/auth')
const { validate } = require('../middleware/validate')
const {
  createShapeBodySchema,
  updateShapeBodySchema,
  listShapesQuerySchema,
  idParamSchema,
} = require('../validators/shapeSchemas')

function createShapeRouter(pool) {
  const router = express.Router()
  const c = createShapeController(pool)

  router.use(authMiddleware)

  router.get('/shapes/next-number', c.nextNumber)
  router.get('/shapes', validate(listShapesQuerySchema, 'query'), c.list)
  router.post('/shapes', validate(createShapeBodySchema), c.create)
  router.get('/shapes/:id', validate(idParamSchema, 'params'), c.getById)
  router.get('/shapes/:id/status', validate(idParamSchema, 'params'), c.getStatus)
  router.put('/shapes/:id', validate(idParamSchema, 'params'), validate(updateShapeBodySchema), c.update)
  router.delete('/shapes/:id', validate(idParamSchema, 'params'), c.remove)

  return router
}

module.exports = { createShapeRouter }
