const request = require('supertest')
const { createApp } = require('../app')

describe('GET /api/health', () => {
  it('returns ok', async () => {
    const fakePool = { query: jest.fn(), end: jest.fn() }
    const app = createApp(fakePool)
    const res = await request(app).get('/api/health')
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('ok')
  })
})
