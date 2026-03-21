import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { startServer, stopServer } from '../index.js'
import { closeDb } from '../storage/db.js'

const ORIGINAL_DASHSCOPE_KEY = process.env['PROVIDER_DASHSCOPE_KEY']
const ORIGINAL_DASHSCOPE_URL = process.env['PROVIDER_DASHSCOPE_URL']
const ORIGINAL_APP_DB_PATH = process.env['APP_DB_PATH']

let tempDbDir: string | null = null

describe('DashScope Provider Settings', () => {
  beforeEach(async () => {
    await stopServer()
    closeDb()

    tempDbDir = mkdtempSync(join(tmpdir(), 'agency-agents-dashscope-settings-'))
    process.env['APP_DB_PATH'] = join(tempDbDir, 'agency-agents.db')
    process.env['PROVIDER_DASHSCOPE_KEY'] = 'dashscope-test-key'
    delete process.env['PROVIDER_DASHSCOPE_URL']
  })

  afterAll(async () => {
    await stopServer()
    closeDb()

    if (tempDbDir) {
      rmSync(tempDbDir, { recursive: true, force: true })
      tempDbDir = null
    }

    if (ORIGINAL_DASHSCOPE_KEY) {
      process.env['PROVIDER_DASHSCOPE_KEY'] = ORIGINAL_DASHSCOPE_KEY
    } else {
      delete process.env['PROVIDER_DASHSCOPE_KEY']
    }

    if (ORIGINAL_DASHSCOPE_URL) {
      process.env['PROVIDER_DASHSCOPE_URL'] = ORIGINAL_DASHSCOPE_URL
    } else {
      delete process.env['PROVIDER_DASHSCOPE_URL']
    }

    if (ORIGINAL_APP_DB_PATH) {
      process.env['APP_DB_PATH'] = ORIGINAL_APP_DB_PATH
    } else {
      delete process.env['APP_DB_PATH']
    }
  })

  it('exposes DashScope in settings and returns its model catalog', async () => {
    const { address } = await startServer(0)

    const providersResponse = await fetch(`${address}/api/settings/providers`)
    expect(providersResponse.status).toBe(200)
    const providersBody = await providersResponse.json() as {
      providers: Array<{
        name: string
        label: string
        configured: boolean
        priority: number
        preferredForTasks: boolean
        settingsSchema: Array<{ key: string; currentValue?: string | null }>
      }>
    }

    const dashscope = providersBody.providers.find((provider) => provider.name === 'dashscope')
    expect(dashscope).toBeDefined()
    expect(dashscope?.label).toBe('DashScope')
    expect(dashscope?.configured).toBe(true)
    expect(dashscope?.priority).toBe(0)
    expect(dashscope?.preferredForTasks).toBe(false)
    expect(
      dashscope?.settingsSchema.find((field) => field.key === 'baseUrl')?.currentValue,
    ).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1')

    const modelsResponse = await fetch(`${address}/api/settings/providers/dashscope/models`)
    expect(modelsResponse.status).toBe(200)
    const modelsBody = await modelsResponse.json() as {
      provider: string
      models: Array<{ id: string }>
    }

    expect(modelsBody.provider).toBe('dashscope')
    expect(modelsBody.models.some((model) => model.id === 'qwen-max')).toBe(true)
    expect(modelsBody.models.some((model) => model.id === 'qwen-plus')).toBe(true)

    const preferResponse = await fetch(`${address}/api/settings/providers/dashscope/prefer`, {
      method: 'POST',
    })
    expect(preferResponse.status).toBe(200)

    const providersAfterPrefer = await fetch(`${address}/api/settings/providers`).then(async (response) => {
      expect(response.status).toBe(200)
      return response.json() as Promise<{
        providers: Array<{ name: string; priority: number; preferredForTasks: boolean }>
      }>
    })
    const dashscopeAfterPrefer = providersAfterPrefer.providers.find((provider) => provider.name === 'dashscope')
    expect(dashscopeAfterPrefer?.priority).toBeGreaterThan(0)
    expect(dashscopeAfterPrefer?.preferredForTasks).toBe(true)
  })
})
