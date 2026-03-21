import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { ensureProjectEnvLoaded } from '../config/env.js'
import { startServer, stopServer } from '../index.js'
import { MINIMAX_DEFAULT_MODEL_ID } from '../providers/minimax.js'
import { closeDb } from '../storage/db.js'

ensureProjectEnvLoaded()

const DASHSCOPE_API_KEY = process.env['PROVIDER_DASHSCOPE_KEY']
const SKIP = !DASHSCOPE_API_KEY || DASHSCOPE_API_KEY.length < 10
const ORIGINAL_MINIMAX_KEY = process.env['PROVIDER_MINIMAX_KEY']
const ORIGINAL_APP_DB_PATH = process.env['APP_DB_PATH']
const CHAT_AGENT_ID = 'engineering-ai-engineer'

let tempDbDir: string | null = null

async function loadApiClient(): Promise<any> {
  const modulePath = '../../../src/lib/api-client.ts'
  const mod = await import(modulePath)
  return mod.apiClient
}

function setMockWindow(baseUrl: string): void {
  Object.defineProperty(globalThis, 'window', {
    value: {
      api: {
        getServerBaseUrl: async () => baseUrl,
      },
    },
    configurable: true,
  })
}

function clearMockWindow(): void {
  Reflect.deleteProperty(globalThis, 'window')
}

describe.skipIf(SKIP)('DashScope runtime fallback', () => {
  beforeEach(async () => {
    await stopServer()
    closeDb()
    clearMockWindow()

    tempDbDir = mkdtempSync(join(tmpdir(), 'agent-sea-dashscope-fallback-'))
    process.env['APP_DB_PATH'] = join(tempDbDir, 'agent-sea.db')
    process.env['PROVIDER_MINIMAX_KEY'] = 'force-invalid-primary-key'
  })

  afterAll(async () => {
    await stopServer()
    closeDb()
    clearMockWindow()

    if (tempDbDir) {
      rmSync(tempDbDir, { recursive: true, force: true })
      tempDbDir = null
    }

    if (ORIGINAL_MINIMAX_KEY) {
      process.env['PROVIDER_MINIMAX_KEY'] = ORIGINAL_MINIMAX_KEY
    } else {
      delete process.env['PROVIDER_MINIMAX_KEY']
    }

    if (ORIGINAL_APP_DB_PATH) {
      process.env['APP_DB_PATH'] = ORIGINAL_APP_DB_PATH
    } else {
      delete process.env['APP_DB_PATH']
    }
  })

  it('falls back to DashScope when the primary MiniMax provider fails before streaming', async () => {
    const { address } = await startServer(0)
    setMockWindow(address)
    const apiClient = await loadApiClient()

    const session = await apiClient.createSession(
      CHAT_AGENT_ID,
      'minimax',
      MINIMAX_DEFAULT_MODEL_ID,
    )

    let text = ''
    let streamError: string | undefined

    for await (const chunk of apiClient.chatStream(
      session.id,
      'Please reply with exactly FALLBACK_OK and nothing else.',
    )) {
      if (chunk.error) {
        streamError = chunk.error
        break
      }

      text += chunk.delta
      if (chunk.done) {
        break
      }
    }

    expect(streamError).toBeUndefined()
    expect(text).toMatch(/FALLBACK_OK/i)
  }, 180_000)
})
