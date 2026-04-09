const { asyncHandler } = require('../middleware/asyncHandler')
const { ShapeService } = require('../services/shapeService')

function createShapeController(pool) {
  const service = new ShapeService(pool)

  return {
    create: asyncHandler(async (req, res) => {
      const result = await service.createShape(req.body, req.user)
      const body = {
        success: true,
        message: `Shape "${result.shape_name}" saved successfully.`,
        ...result,
      }
      if (result.queue_failed) {
        body.warning =
          'Shape persisted but background queue is unavailable; retry enqueue or run worker reconciliation.'
      }
      res.status(201).json(body)
    }),

    list: asyncHandler(async (req, res) => {
      const data = await service.listShapes(req.user, req.query)
      res.json({ success: true, ...data })
    }),

    getById: asyncHandler(async (req, res) => {
      const shape = await service.getShape(req.params.id, req.user)
      res.json({ success: true, shape })
    }),

    getStatus: asyncHandler(async (req, res) => {
      const status = await service.getStatus(req.params.id, req.user)
      res.json({ success: true, ...status })
    }),

    remove: asyncHandler(async (req, res) => {
      await service.deleteShape(req.params.id, req.user)
      res.json({ success: true, message: 'Shape deleted.' })
    }),

    update: asyncHandler(async (req, res) => {
      const result = await service.updateShape(req.params.id, req.body, req.user)
      const body = {
        success: true,
        message: `Shape "${result.shape_name}" updated successfully.`,
        ...result,
      }
      if (result.queue_failed) {
        body.warning =
          'Shape persisted but background queue is unavailable; retry enqueue or run worker reconciliation.'
      }
      res.json(body)
    }),

    nextNumber: asyncHandler(async (req, res) => {
      const data = await service.nextNumber(req.user)
      res.json({ success: true, ...data })
    }),
  }
}

module.exports = { createShapeController }
