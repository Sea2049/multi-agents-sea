import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

const PROJECT_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const SERVER_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const FRONTEND_PORT = 4800 + Math.floor(Math.random() * 200)

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
      if (page.url().startsWith(expectedPrefix)) {
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

async function waitForTextCount(page: any, text: string, expectedCount: number, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const count = await page.getByText(text).count()
    if (count === expectedCount) {
      return
    }
    await new Promise(resolve => setTimeout(resolve, 250))
  }

  throw new Error(`Timed out waiting for text "${text}" to reach count ${expectedCount}`)
}

describe('Electron Memory Library', () => {
  beforeEach(async () => {
    await stopViteDevServer()

    if (tempAppDataDir) {
      rmSync(tempAppDataDir, { recursive: true, force: true })
      tempAppDataDir = null
    }

    tempAppDataDir = mkdtempSync(join(tmpdir(), 'agent-sea-electron-memory-'))
  })

  afterAll(async () => {
    await stopViteDevServer()

    if (tempAppDataDir) {
      rmSync(tempAppDataDir, { recursive: true, force: true })
      tempAppDataDir = null
    }
  })

  it('应支持在 Electron 记忆库中按任务、Agent、分类筛选并删除记忆', async () => {
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
        PROVIDER_OPENAI_KEY: '',
        PROVIDER_ANTHROPIC_KEY: '',
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
      page.setDefaultTimeout(180_000)

      await page.waitForLoadState('domcontentloaded')
      await page.getByText('多节点 Agent 集群总览').waitFor()

      const baseUrl = await waitForElectronServerBaseUrl(page)
      const factContent = `FACT_TOKEN_${Date.now()}`
      const decisionContent = `DECISION_TOKEN_${Date.now()}`
      const outputContent = `OUTPUT_TOKEN_${Date.now()}`

      for (const payload of [
        {
          content: factContent,
          category: 'fact',
          taskId: 'task-memory-alpha',
          agentId: 'engineering-ai-engineer',
        },
        {
          content: decisionContent,
          category: 'decision',
          taskId: 'task-memory-alpha',
          agentId: 'engineering-backend-architect',
        },
        {
          content: outputContent,
          category: 'output',
          taskId: 'task-memory-beta',
          agentId: 'engineering-ai-engineer',
        },
      ]) {
        const response = await fetch(`${baseUrl}/api/memories`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        expect(response.ok).toBe(true)
      }

      await page.getByRole('button', { name: '记忆库' }).click()
      await page.getByText('跨任务长期记忆库').waitFor()
      await page.getByText(factContent).waitFor()
      await page.getByText(decisionContent).waitFor()
      await page.getByText(outputContent).waitFor()

      // Filter by category
      const categorySelect = page.locator('select').filter({ hasText: '全部分类' })
      await categorySelect.selectOption('fact')
      await page.getByText(factContent).waitFor()
      await waitForTextCount(page, decisionContent, 0)

      await categorySelect.selectOption('')
      // Filter by taskId
      const taskSelect = page.locator('select').filter({ hasText: '全部任务' })
      await taskSelect.selectOption('task-memory-beta')
      await page.getByText(outputContent).waitFor()
      await waitForTextCount(page, factContent, 0)

      await taskSelect.selectOption('')
      // Filter by agentId
      const agentSelect = page.locator('select').filter({ hasText: '全部 Agent' })
      await agentSelect.selectOption('engineering-backend-architect')
      await page.getByText(decisionContent).waitFor()
      await waitForTextCount(page, outputContent, 0)

      await agentSelect.selectOption('')

      // Search by keyword
      const searchBox = page.getByPlaceholder('搜索记忆内容…')
      await searchBox.fill(factContent)
      await page.getByText(factContent).waitFor()
      await waitForTextCount(page, outputContent, 0)
      await searchBox.fill('')

      // Delete one memory
      page.once('dialog', (dialog: { accept: () => Promise<void> }) => dialog.accept())
      const outputCard = page.locator('[data-memory-id]').filter({ hasText: outputContent }).first()
      await outputCard.getByRole('button', { name: /删除记忆/ }).click()

      await waitForTextCount(page, outputContent, 0)
    } finally {
      await electronApp.close()
    }
  }, 300_000)
})
