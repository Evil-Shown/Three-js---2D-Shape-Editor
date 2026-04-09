const Joi = require('joi')

const pointSchema = Joi.object({
  x: Joi.number().required(),
  y: Joi.number().required(),
}).unknown(true)

const edgeSchema = Joi.object({
  id: Joi.string().allow('', null),
  type: Joi.string().valid('line', 'arc', 'LINE', 'ARC').required(),
  start: pointSchema.optional(),
  end: pointSchema.optional(),
  center: pointSchema.optional(),
  radius: Joi.number().optional(),
  startAngle: Joi.number().optional(),
  endAngle: Joi.number().optional(),
  clockwise: Joi.boolean().optional(),
}).unknown(true)

/** Validates exported editor JSON before persistence (v1 + v2 friendly). */
const shapeJsonSchema = Joi.object({
  name: Joi.string().allow('').optional(),
  version: Joi.alternatives().try(Joi.string(), Joi.number()).optional(),
  unit: Joi.string().optional(),
  thickness: Joi.number().optional(),
  edges: Joi.array().items(edgeSchema).optional(),
  parametricEdges: Joi.array().items(Joi.object().unknown(true)).optional(),
  pointExpressions: Joi.object().unknown(true).optional(),
  shapeMetadata: Joi.object().unknown(true).optional(),
  parameters: Joi.array().optional(),
  resize2: Joi.object().unknown(true).optional(),
  areaFormula: Joi.string().allow('').optional(),
})
  .or('edges', 'parametricEdges')
  .messages({
    'object.missing': 'json_data must include either edges (v1) or parametricEdges (v2)',
  })
  .unknown(true)
  .custom((value, helpers) => {
    const e = Array.isArray(value.edges) ? value.edges.length : 0
    const p = Array.isArray(value.parametricEdges) ? value.parametricEdges.length : 0
    if (e === 0 && p === 0) {
      return helpers.error('custom.nonEmptyGeometry')
    }
    return value
  })
  .messages({
    'custom.nonEmptyGeometry': 'edges or parametricEdges must contain at least one entry',
  })

const createShapeBodySchema = Joi.object({
  shape_name: Joi.string().max(255).allow('', null),
  json_data: shapeJsonSchema.required(),
})

const listShapesQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(200).default(20),
  project_id: Joi.string().max(128).allow('', null),
  status: Joi.string().valid('pending', 'processing', 'completed', 'failed').optional(),
  include_json: Joi.alternatives().try(Joi.boolean(), Joi.string().valid('1', '0', 'true', 'false')).default(false),
})

const updateShapeBodySchema = Joi.object({
  shape_name: Joi.string().max(255).allow('', null),
  json_data: shapeJsonSchema.required(),
})

const idParamSchema = Joi.object({
  id: Joi.number().integer().positive().required(),
})

module.exports = {
  shapeJsonSchema,
  createShapeBodySchema,
  updateShapeBodySchema,
  listShapesQuerySchema,
  idParamSchema,
}
