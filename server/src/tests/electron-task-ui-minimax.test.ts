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
const FRONTEND_PORT = 4600 + Math.floor(Math.random() * 200)

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
  const command = `npm run dev -- --host 127.0.0.1 --port ${FRONTEND_PORT} --strictPort`
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

async function waitForMinimaxConfigured(page: any, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const state = await page.evaluate(async (modelId: string) => {
      const api = (window as unknown as {
        api?: { getServerBaseUrl?: () => Promise<string | null> }
      }).api

      const baseUrl = (await api?.getServerBaseUrl?.()) ?? null
      if (!baseUrl) {
        return { configured: false, hasModel: false }
      }

      const providersResponse = await fetch(`${baseUrl}/api/settings/providers`)
      const providersBody = await providersResponse.json() as {
        providers: Array<{ name: string; configured: boolean }>
      }
      const minimax = providersBody.providers.find(item => item.name === 'minimax')

      let hasModel = false
      if (minimax?.configured) {
        const modelsResponse = await fetch(`${baseUrl}/api/settings/providers/minimax/models`)
        if (modelsResponse.ok) {
          const modelsBody = await modelsResponse.json() as {
            models: Array<{ id: string }>
          }
          hasModel = modelsBody.models.some(model => model.id === modelId)
        }
      }

      return {
        configured: minimax?.configured ?? false,
        hasModel,
      }
    }, MINIMAX_DEFAULT_MODEL_ID)

    if (state.configured && state.hasModel) {
      return
    }

    await new Promise(resolve => setTimeout(resolve, 1_000))
  }

  throw new Error('Timed out waiting for MiniMax provider to become configured in Electron')
}

describe.skipIf(SKIP)('Electron Task Flow — MiniMax 真实前端交互', () => {
  beforeEach(async () => {
    await stopViteDevServer()

    if (tempAppDataDir) {
      rmSync(tempAppDataDir, { recursive: true, force: true })
      tempAppDataDir = null
    }

    tempAppDataDir = mkdtempSync(join(tmpdir(), 'agent-sea-electron-ui-'))
  })

  afterAll(async () => {
    await stopViteDevServer()

    if (tempAppDataDir) {
      rmSync(tempAppDataDir, { recursive: true, force: true })
      tempAppDataDir = null
    }
  })

  it('应在 Electron 中完成团队编组、任务发起、SSE 工具事件展示与最终报告渲染', async () => {
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
      const page = await waitForRendererWindow(electronApp, `http://127.0.0.1:${FRONTEND_PORT}`)
      page.setDefaultTimeout(300_000)

      await page.waitForLoadState('domcontentloaded')
      await page.getByText('多节点 Agent 集群总览').waitFor()

      await waitForElectronServerBaseUrl(page)
      const memoryToken = `MEMORY_HIT_ELECTRON_${Date.now()}`

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
        { apiKey: API_KEY, baseUrlValue: 'https://api.minimaxi.com/anthropic' },
      )
      await waitForMinimaxConfigured(page)
      const refreshedBaseUrl = await waitForElectronServerBaseUrl(page)

      const memoryResponse = await fetch(`${refreshedBaseUrl}/api/memories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: `Electron UI anchor memory: repeat token ${memoryToken} verbatim.`,
          category: 'deployment-notes',
        }),
      })
      expect(memoryResponse.ok).toBe(true)

      await page.getByRole('button', { name: '加入团队' }).nth(0).click()
      await page.getByRole('button', { name: '加入团队' }).nth(1).click()
      await page.getByRole('button', { name: '进入 Team Builder' }).click()
      await page.getByRole('button', { name: '执行任务' }).click()

      await page.getByText('发起任务').waitFor()
      const launchPanel = page.locator('aside')

      const providerSelect = launchPanel.locator('select').nth(0)
      await providerSelect.selectOption('minimax')
      await launchPanel.locator('select').nth(1).selectOption(MINIMAX_DEFAULT_MODEL_ID)

      await launchPanel
        .getByPlaceholder('描述你想完成的任务…')
        .fill([
          '请完成一个真实的 Electron 任务流验证。',
          '你必须至少真实调用一次 file_read、web_search、code_exec。',
          '请读取 package.json，搜索 sqlite-vec，并执行 console.log([\'electron\',\'mini\',\'max\',\'tools\'].join(\'-\'))。',
          `如果你在历史记忆里看到了 ${memoryToken}，请原样逐字输出该令牌。`,
          '最终输出中文 Markdown 报告。',
        ].join('\n'))

      await launchPanel.getByRole('button', { name: '执行任务' }).click()
      await page.getByText('任务进度').waitFor()

      await page.getByRole('button', { name: '活动日志' }).click()
      await page.getByText('工具调用').first().waitFor()
      await page.getByText(/file_read/).first().waitFor()
      await page.getByText(/web_search/).first().waitFor()
      await page.getByText(/code_exec/).first().waitFor()

      // 最终报告可能因任务成功/失败而文本不同，使用正则匹配更稳健
      // 同时给更长的超时，因为 Electron 环境的全链路比纯 HTTP 更慢
      await page.getByText(/最终报告/).first().waitFor({ timeout: 600_000 })

      const pageText = await page.locator('body').textContent()
      expect(pageText).toContain(memoryToken)
      expect(pageText?.toLowerCase()).toContain('electron-mini-max-tools')
    } finally {
      await electronApp.close()
    }
  }, 900_000)
})
