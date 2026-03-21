import { buildApp } from './app.js'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { initDb } from './storage/db.js'

let stopFn: (() => Promise<void>) | null = null

export async function startServer(port = 0): Promise<{ port: number; address: string }> {
  const dbPath = process.env['APP_DB_PATH']?.trim() || join(process.cwd(), 'agent-sea.db')
  initDb(dbPath)
  const app = await buildApp()

  await app.listen({ port, host: '127.0.0.1' })

  const addr = app.server.address()
  const actualPort = addr && typeof addr === 'object' ? addr.port : port
  const address = `http://127.0.0.1:${actualPort}`

  console.log(`[server] Fastify listening on ${address}`)

  stopFn = async () => {
    await app.close()
    stopFn = null
    console.log('[server] Fastify stopped')
  }

  return { port: actualPort, address }
}

export async function stopServer(): Promise<void> {
  if (stopFn) {
    await stopFn()
  }
}

// 直接运行入口（tsx watch src/index.ts）
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const parsedPort = Number.parseInt(process.env['APP_PORT'] ?? '3701', 10)
  const port = Number.isNaN(parsedPort) ? 3701 : parsedPort
  startServer(port).catch((err) => {
    console.error('[server] Failed to start:', err)
    process.exit(1)
  })
}
