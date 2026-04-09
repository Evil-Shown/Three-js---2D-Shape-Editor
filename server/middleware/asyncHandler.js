/** Wraps async route handlers so rejections reach the global error middleware. */
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)
}

module.exports = { asyncHandler }
