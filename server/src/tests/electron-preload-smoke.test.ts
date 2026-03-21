import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

const PROJECT_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const SERVER_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const FRONTEND_PORT = 4400 + Math.floor(Math.random() * 200)

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
  const command =
    process.platform === 'win32'
      ? `npm run dev -- --host 127.0.0.1 --port ${FRONTEND_PORT} --strictPort`
      : `npm run dev -- --host 127.0.0.1 --port ${FRONTEND_PORT} --strictPort`

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

describe('Electron Preload Smoke', () => {
  beforeEach(async () => {
    await stopViteDevServer()

    if (tempAppDataDir) {
      rmSync(tempAppDataDir, { recursive: true, force: true })
      tempAppDataDir = null
    }

    tempAppDataDir = mkdtempSync(join(tmpdir(), 'agent-sea-electron-'))
  })

  afterAll(async () => {
    await stopViteDevServer()

    if (tempAppDataDir) {
      rmSync(tempAppDataDir, { recursive: true, force: true })
      tempAppDataDir = null
    }
  })

  it('应通过真实 Electron 主进程暴露 preload API，并从 renderer 拿到本地 server 地址', async () => {
    await runNpmCommand('npm run build', SERVER_ROOT)

    viteProcess = startViteDevServer()
    await waitForHttpReady(`http://127.0.0.1:${FRONTEND_PORT}`)

    const electronApp = await electron.launch({
      executablePath: electronBinary,
      args: ['.'],
      cwd: PROJECT_ROOT,
      env: {
        ...process.env,
        VITE_DEV_SERVER_URL: `http://127.0.0.1:${FRONTEND_PORT}`,
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
      const mainProcessState = await electronApp.evaluate(async ({ app }: { app: { getPath(name: string): string } }) => {
        return {
          userData: app.getPath('userData'),
        }
      })

      const page = await waitForRendererWindow(electronApp, `http://127.0.0.1:${FRONTEND_PORT}`)
      page.setDefaultTimeout(120_000)

      await page.waitForLoadState('domcontentloaded')
      await page.getByText('多节点 Agent 集群总览').waitFor()

      const state = await page.evaluate(async () => {
        const desktop = (window as unknown as {
          desktop?: { isElectron?: boolean; platform?: string }
          api?: { getServerBaseUrl?: () => Promise<string | null> }
        }).desktop
        const api = (window as unknown as {
          api?: { getServerBaseUrl?: () => Promise<string | null> }
        }).api

        const baseUrl = await api?.getServerBaseUrl?.()
        const health = baseUrl
          ? await fetch(`${baseUrl}/health`).then(async (response) => ({
              ok: response.ok,
              status: response.status,
              body: await response.json(),
            }))
          : null

        const providers = baseUrl
          ? await fetch(`${baseUrl}/api/settings/providers`).then(async (response) => ({
              ok: response.ok,
              status: response.status,
              body: await response.json(),
            }))
          : null

        return {
          isElectron: desktop?.isElectron ?? false,
          platform: desktop?.platform ?? null,
          hasGetServerBaseUrl: typeof api?.getServerBaseUrl === 'function',
          baseUrl,
          health,
          providers,
        }
      })

      expect(state.isElectron).toBe(true)
      expect(state.hasGetServerBaseUrl).toBe(true)
      expect(state.platform).toBeTruthy()
      expect(mainProcessState.userData.startsWith(tempAppDataDir ?? '')).toBe(true)
      expect(state.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
      expect(state.health?.ok).toBe(true)
      expect(state.health?.status).toBe(200)
      expect(state.health?.body?.status).toBe('ok')
      expect(state.providers?.ok).toBe(true)
      expect(state.providers?.status).toBe(200)
      expect(state.providers?.body?.providers?.some((item: { name: string }) => item.name === 'minimax')).toBe(true)
    } finally {
      await electronApp.close()
    }
  }, 240_000)
})
