import { describe, it, expect, afterAll } from 'vitest'
import { startServer, stopServer } from '../index.js'

describe('Server Startup', () => {
  let port: number

  afterAll(async () => {
    await stopServer()
  })

  it('should start on a dynamic port', async () => {
    const result = await startServer(0)
    port = result.port
    expect(result.port).toBeGreaterThan(0)
    expect(result.address).toContain('127.0.0.1')
  })

  it('should respond to GET /health', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/health`)
    expect(res.status).toBe(200)
    const body = await res.json() as { status: string; version: string; uptime: number }
    expect(body.status).toBe('ok')
    expect(body.version).toBe('1.0.0')
    expect(body.uptime).toBeGreaterThan(0)
  })

  it('should return 404 for unknown routes', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/nonexistent`)
    expect(res.status).toBe(404)
  })
})
