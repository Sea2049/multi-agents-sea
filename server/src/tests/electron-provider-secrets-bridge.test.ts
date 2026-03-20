import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { MINIMAX_DEFAULT_MODEL_ID } from '../providers/minimax.js'

const API_KEY = process.env['PROVIDER_MINIMAX_KEY']
const SKIP = !API_KEY || API_KEY.length < 10
const PROJECT_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const SERVER_ROOT = fileURLToPath(new URL('../..', import.meta.url))
let frontendPort = 4800 + Math.floor(Math.random() * 200)
const MINIMAX_BASE_URL = 'https://api.minimaxi.com/anthropic'

const requireFromClawtest = createRequire('D:/clawtest/package.json')
const requireFromRoot = createRequire(join(PROJECT_ROOT, 'package.json'))
const { _electron: electron } = requireFromClawtest('playwright') as { _electron: any }
const electronBinary = requireFromRoot('electron') as string

let viteProcess: ChildProcessWithoutNullStreams | null = null
let tempAppDataDir: string | null = null

function getNpmSpawnConfig(command: string): { executable: string; args: string[] } {
  if (process.platform === 'win32') {
    return {
      executable: 'cmd.exe',
      args: ['/d', '/s', '/c', command],
    }
  }

  return {
    executable: 'npm',
    args: command.split(' ').slice(1),
  }
}

async function runNpmCommand(command: string, workingDirectory: string): Promise<void> {
  const { executable, args } = getNpmSpawnConfig(command)

  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: workingDirectory,
      env: { ...process.env },
      stdio: 'pipe',
    })

    let stderr = ''
    child.stdout.on('data', chunk => process.stdout.write(chunk))
    child.stderr.on('data', chunk => {
      stderr += chunk.toString()
      process.stderr.write(chunk)
    })
    child.on('error', reject)
    child.on('exit', code => {
      if (code === 0) {
        resolve()
        return
      }

      reject(new Error(`Command failed (${command}) with exit code ${code}: ${stderr}`))
    })
  })
}

function startViteDevServer(): ChildProcessWithoutNullStreams {
  const command = `npm run dev -- --host 127.0.0.1 --port ${frontendPort} --strictPort`
  const { executable, args } = getNpmSpawnConfig(command)

  const child = spawn(executable, args, {
    cwd: PROJECT_ROOT,
    env: { ...process.env },
    stdio: 'pipe',
  })

  child.stdout.on('data', chunk => process.stdout.write(chunk))
  child.stderr.on('data', chunk => process.stderr.write(chunk))

  return child
}

async function waitForHttpReady(url: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.ok) {
        return
      }
    } catch {
      // keep polling
    }

    await new Promise(resolve => setTimeout(resolve, 1_000))
  }

  throw new Error(`Timed out waiting for ${url}`)
}

async function stopViteDevServer(): Promise<void> {
  if (!viteProcess) return

  const child = viteProcess
  viteProcess = null

  if (child.exitCode !== null) return

  await new Promise<void>(resolve => {
    const done = () => resolve()
    child.once('exit', done)
    child.kill()
    setTimeout(() => {
      if (child.exitCode === null) {
        child.kill('SIGKILL')
      }
      resolve()
    }, 5_000)
  })
}

async function waitForRendererWindow(electronApp: any, expectedPrefix: string, timeoutMs = 30_000): Promise<any> {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const windows = electronApp.windows()
    for (const page of windows) {
      const url = page.url()
      if (url.startsWith(expectedPrefix)) {
        return page
      }
    }

    await new Promise(resolve => setTimeout(resolve, 250))
  }

  throw new Error(`Timed out waiting for Electron renderer window at ${expectedPrefix}`)
}

async function waitForElectronServerBaseUrl(page: any, timeoutMs = 30_000): Promise<string> {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const baseUrl = await page.evaluate(async () => {
      const api = (window as unknown as {
        api?: { getServerBaseUrl?: () => Promise<string | null> }
      }).api

      return (await api?.getServerBaseUrl?.()) ?? null
    })

    if (typeof baseUrl === 'string' && /^http:\/\/127\.0\.0\.1:\d+$/.test(baseUrl)) {
      return baseUrl
    }

    await new Promise(resolve => setTimeout(resolve, 500))
  }

  throw new Error('Timed out waiting for Electron local server base URL')
}

async function waitForMinimaxConfigured(page: any, timeoutMs = 60_000): Promise<any> {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const state = await page.evaluate(async () => {
      const api = (window as unknown as {
        api?: { getServerBaseUrl?: () => Promise<string | null> }
      }).api

      const baseUrl = (await api?.getServerBaseUrl?.()) ?? null
      if (!baseUrl) {
        return { configured: false, models: [] as Array<{ id: string }> }
      }

      const providersResponse = await fetch(`${baseUrl}/api/settings/providers`)
      const providersBody = await providersResponse.json() as {
        providers: Array<{ name: string; configured: boolean }>
      }

      const minimax = providersBody.providers.find(item => item.name === 'minimax')

      let models: Array<{ id: string }> = []
      if (minimax?.configured) {
        const modelsResponse = await fetch(`${baseUrl}/api/settings/providers/minimax/models`)
        if (modelsResponse.ok) {
          const modelsBody = await modelsResponse.json() as {
            models: Array<{ id: string }>
          }
          models = modelsBody.models
        }
      }

      return {
        configured: minimax?.configured ?? false,
        models,
      }
    })

    if (state.configured && state.models.some((model: { id: string }) => model.id === MINIMAX_DEFAULT_MODEL_ID)) {
      return state
    }

    await new Promise(resolve => setTimeout(resolve, 1_000))
  }

  throw new Error('Timed out waiting for MiniMax secret bridge to update backend provider state')
}

describe.skipIf(SKIP)('Electron Provider Secrets Bridge', () => {
  beforeEach(async () => {
    await stopViteDevServer()

    if (tempAppDataDir) {
      rmSync(tempAppDataDir, { recursive: true, force: true })
      tempAppDataDir = null
    }

    tempAppDataDir = mkdtempSync(join(tmpdir(), 'agency-agents-electron-secrets-'))
  frontendPort = 4800 + Math.floor(Math.random() * 200)
  })

  afterAll(async () => {
    await stopViteDevServer()

    if (tempAppDataDir) {
      rmSync(tempAppDataDir, { recursive: true, force: true })
      tempAppDataDir = null
    }
  })

  it('应在 Electron 中保存 minimax key 后，让运行中的 backend 立即识别为已配置', async () => {
    await runNpmCommand('npm run build', SERVER_ROOT)

    viteProcess = startViteDevServer()
    await waitForHttpReady(`http://127.0.0.1:${frontendPort}`)

    const electronApp = await electron.launch({
      executablePath: electronBinary,
      args: ['.'],
      cwd: PROJECT_ROOT,
      env: {
        ...process.env,
        VITE_DEV_SERVER_URL: `http://127.0.0.1:${frontendPort}`,
        PROVIDER_MINIMAX_KEY: '',
        PROVIDER_MINIMAX_URL: '',
        APPDATA: tempAppDataDir ?? process.env['APPDATA'],
        LOCALAPPDATA: tempAppDataDir ?? process.env['LOCALAPPDATA'],
        TEMP: tempAppDataDir ?? process.env['TEMP'],
        TMP: tempAppDataDir ?? process.env['TMP'],
        ELECTRON_USER_DATA_DIR: tempAppDataDir ?? process.env['ELECTRON_USER_DATA_DIR'],
        ELECTRON_DISABLE_DEVTOOLS: '1',
        ELECTRON_DISABLE_SINGLE_INSTANCE_LOCK: '1',
        ELECTRON_EXTERNAL_SERVER: '1',
      },
    })

    try {
      const page = await waitForRendererWindow(electronApp, `http://127.0.0.1:${frontendPort}`)
      page.setDefaultTimeout(180_000)

      await page.waitForLoadState('domcontentloaded')
      await page.getByText('多节点 Agent 集群总览').waitFor()

      const baseUrl = await waitForElectronServerBaseUrl(page)
      const initialProviders = await fetch(`${baseUrl}/api/settings/providers`).then(async response => {
        return response.json() as Promise<{
          providers: Array<{ name: string; configured: boolean }>
        }>
      })

      const initialMinimax = initialProviders.providers.find(item => item.name === 'minimax')
      expect(initialMinimax?.configured).toBe(false)

      await page.evaluate(
        async ({ apiKey, baseUrlValue }: { apiKey: string; baseUrlValue: string }) => {
          const api = (window as unknown as {
            api?: {
              secrets: {
                save(provider: string, key: string): Promise<void>
              }
            }
          }).api

          await api?.secrets.save('minimax', apiKey)
          await api?.secrets.save('minimax:baseUrl', baseUrlValue)
        },
        { apiKey: API_KEY, baseUrlValue: MINIMAX_BASE_URL },
      )

      const bridgedState = await waitForMinimaxConfigured(page)
      expect(bridgedState.configured).toBe(true)
      expect(bridgedState.models.some((model: { id: string }) => model.id === MINIMAX_DEFAULT_MODEL_ID)).toBe(true)
    } finally {
      await electronApp.close()
    }
  }, 240_000)

  it('应在 Provider 设置中测试 MiniMax 连接时不再触发空 JSON body 400', async () => {
    await runNpmCommand('npm run build', SERVER_ROOT)

    viteProcess = startViteDevServer()
    await waitForHttpReady(`http://127.0.0.1:${frontendPort}`)

    const electronApp = await electron.launch({
      executablePath: electronBinary,
      args: ['.'],
      cwd: PROJECT_ROOT,
      env: {
        ...process.env,
        VITE_DEV_SERVER_URL: `http://127.0.0.1:${frontendPort}`,
        PROVIDER_MINIMAX_KEY: '',
        PROVIDER_MINIMAX_URL: '',
        APPDATA: tempAppDataDir ?? process.env['APPDATA'],
        LOCALAPPDATA: tempAppDataDir ?? process.env['LOCALAPPDATA'],
        TEMP: tempAppDataDir ?? process.env['TEMP'],
        TMP: tempAppDataDir ?? process.env['TMP'],
        ELECTRON_USER_DATA_DIR: tempAppDataDir ?? process.env['ELECTRON_USER_DATA_DIR'],
        ELECTRON_DISABLE_DEVTOOLS: '1',
        ELECTRON_DISABLE_SINGLE_INSTANCE_LOCK: '1',
        ELECTRON_EXTERNAL_SERVER: '1',
      },
    })

    try {
      const page = await waitForRendererWindow(electronApp, `http://127.0.0.1:${frontendPort}`)
      page.setDefaultTimeout(180_000)

      await page.waitForLoadState('domcontentloaded')
      await page.getByText('多节点 Agent 集群总览').waitFor()

      await page.evaluate(
        async ({ apiKey, baseUrlValue }: { apiKey: string; baseUrlValue: string }) => {
          const api = (window as unknown as {
            api?: {
              secrets: {
                save(provider: string, key: string): Promise<void>
              }
            }
          }).api

          await api?.secrets.save('minimax', apiKey)
          await api?.secrets.save('minimax:baseUrl', baseUrlValue)
        },
        { apiKey: API_KEY, baseUrlValue: MINIMAX_BASE_URL },
      )

      await waitForMinimaxConfigured(page)

      await page.getByRole('button', { name: '打开 Provider 设置' }).click()
      await page.getByText('AI Provider 配置').waitFor()

      const minimaxSection = page
        .locator('section')
        .filter({ has: page.getByText('MiniMax') })
        .first()

      await minimaxSection.getByRole('button', { name: '测试连接' }).click()
      await minimaxSection.getByText('已连接').waitFor()
    } finally {
      await electronApp.close()
    }
  }, 240_000)
})
