const { createShapeBodySchema } = require('../validators/shapeSchemas')

describe('shape JSON validation', () => {
  it('rejects empty geometry', () => {
    const { error } = createShapeBodySchema.validate({
      json_data: { name: 'x', edges: [], parametricEdges: [] },
    })
    expect(error).toBeDefined()
  })

  it('accepts v1 edges', () => {
    const { error } = createShapeBodySchema.validate({
      json_data: {
        name: 's',
        edges: [
          {
            id: 'e1',
            type: 'line',
            start: { x: 0, y: 0 },
            end: { x: 1, y: 0 },
          },
        ],
      },
    })
    expect(error).toBeUndefined()
  })

  it('accepts v2 parametricEdges', () => {
    const { error } = createShapeBodySchema.validate({
      json_data: {
        name: 's',
        parametricEdges: [{ id: 'p1' }],
      },
    })
    expect(error).toBeUndefined()
  })
})
