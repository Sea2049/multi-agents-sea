import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

const PROJECT_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const SERVER_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const FRONTEND_PORT = 4700 + Math.floor(Math.random() * 200)

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

async function isTextVisible(page: any, text: string, timeoutMs = 5_000): Promise<boolean> {
  try {
    await page.getByText(text).first().waitFor({ state: 'visible', timeout: timeoutMs })
    return true
  } catch {
    return false
  }
}

async function clickFirstAvailableButton(page: any, labels: string[]): Promise<void> {
  for (const label of labels) {
    const locator = page.getByRole('button', { name: label }).first()
    if (await locator.count()) {
      await locator.click()
      return
    }
  }
  throw new Error(`No matching button found. Tried: ${labels.join(', ')}`)
}

describe('Electron Provider Onboarding', () => {
  beforeEach(async () => {
    await stopViteDevServer()

    if (tempAppDataDir) {
      rmSync(tempAppDataDir, { recursive: true, force: true })
      tempAppDataDir = null
    }

    tempAppDataDir = mkdtempSync(join(tmpdir(), 'agent-sea-electron-onboarding-'))
  })

  afterAll(async () => {
    await stopViteDevServer()

    if (tempAppDataDir) {
      rmSync(tempAppDataDir, { recursive: true, force: true })
      tempAppDataDir = null
    }
  })

  it('应在首次启动且未配置云 Provider 时，给出首页提醒和任务流设置入口', async () => {
    await runNpmCommand('npm run build', SERVER_ROOT)

    viteProcess = startViteDevServer()
    await waitForHttpReady(`http://127.0.0.1:${FRONTEND_PORT}`)

    const clearedProviderEnv = Object.fromEntries(
      Object.keys(process.env)
        .filter((key) => key.startsWith('PROVIDER_'))
        .map((key) => [key, '']),
    )

    const electronApp = await electron.launch({
      executablePath: electronBinary,
      args: ['.'],
      cwd: PROJECT_ROOT,
      env: {
        ...process.env,
        ...clearedProviderEnv,
        VITE_DEV_SERVER_URL: `http://127.0.0.1:${FRONTEND_PORT}`,
        PROVIDER_OPENAI_KEY: '',
        PROVIDER_ANTHROPIC_KEY: '',
        PROVIDER_MINIMAX_KEY: '',
        PROVIDER_MINIMAX_URL: '',
        PROVIDER_DASHSCOPE_KEY: '',
        PROVIDER_DASHSCOPE_URL: '',
        APPDATA: tempAppDataDir ?? process.env['APPDATA'],
        LOCALAPPDATA: tempAppDataDir ?? process.env['LOCALAPPDATA'],
        TEMP: tempAppDataDir ?? process.env['TEMP'],
        TMP: tempAppDataDir ?? process.env['TMP'],
        ELECTRON_USER_DATA_DIR: tempAppDataDir ?? process.env['ELECTRON_USER_DATA_DIR'],
        ELECTRON_DISABLE_DEVTOOLS: '1',
        ELECTRON_DISABLE_SINGLE_INSTANCE_LOCK: '1',
        ELECTRON_EXTERNAL_SERVER: '1',
        ENABLE_PROVIDER_PLUGINS: '0',
        SEA_DISABLE_PROJECT_ENV: '1',
      },
    })

    try {
      const page = await waitForRendererWindow(electronApp, `http://127.0.0.1:${FRONTEND_PORT}`)
      page.setDefaultTimeout(180_000)

      await page.waitForLoadState('domcontentloaded')
      await page.getByText('多节点 Agent 集群总览').waitFor()
      const sidebarHintVisible = await isTextVisible(page, '首次启动建议先配置 Provider')

      await page.getByRole('button', { name: '加入团队' }).nth(0).click()
      await page.getByRole('button', { name: '加入团队' }).nth(1).click()
      await page.getByRole('button', { name: '进入 Team Builder' }).click()
      await page.getByRole('button', { name: '执行任务' }).click()

      await page.getByText('发起任务').waitFor()
      const taskHintVisible = await isTextVisible(page, '首次启动建议先配置 Provider')
      expect(sidebarHintVisible || taskHintVisible).toBe(true)

      await clickFirstAvailableButton(page, ['前往 Provider 设置', '打开 Provider 设置', 'Provider 设置'])
      await page.getByText('AI Provider 配置').waitFor()
    } finally {
      await electronApp.close()
    }
  }, 240_000)
})
