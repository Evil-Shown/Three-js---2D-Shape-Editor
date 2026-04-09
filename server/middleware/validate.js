const { AppError } = require('./AppError')

/**
 * @param {import('joi').ObjectSchema} schema
 * @param {'body'|'query'|'params'} source
 */
function validate(schema, source = 'body') {
  return (req, _res, next) => {
    const { error, value } = schema.validate(req[source], {
      abortEarly: false,
      stripUnknown: true,
      convert: true,
    })
    if (error) {
      const details = error.details.map((d) => d.message)
      return next(new AppError('Validation failed', 400, 'VALIDATION_ERROR', details))
    }
    req[source] = value
    next()
  }
}

module.exports = { validate }
