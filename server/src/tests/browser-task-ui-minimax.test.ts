import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { startServer, stopServer } from '../index.js'
import { MINIMAX_DEFAULT_MODEL_ID } from '../providers/minimax.js'
import { closeDb } from '../storage/db.js'
import { setWorkspaceRoot } from '../tools/file-read.js'

const requireFromClawtest = createRequire('D:/clawtest/package.json')
const { chromium } = requireFromClawtest('playwright') as { chromium: any }

const API_KEY = process.env['PROVIDER_MINIMAX_KEY']
const SKIP = !API_KEY || API_KEY.length < 10
const PROJECT_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const SERVER_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const FRONTEND_PORT = 4200 + Math.floor(Math.random() * 200)

let viteProcess: ChildProcessWithoutNullStreams | null = null
let tempDbDir: string | null = null

function getViteCommand(): string {
  return process.platform === 'win32' ? 'cmd.exe' : 'npm'
}

function startViteDevServer(): ChildProcessWithoutNullStreams {
  const command = getViteCommand()
  const args = process.platform === 'win32'
    ? ['/d', '/s', '/c', `npm run dev -- --host 127.0.0.1 --port ${FRONTEND_PORT} --strictPort`]
    : ['run', 'dev', '--', '--host', '127.0.0.1', '--port', String(FRONTEND_PORT), '--strictPort']

  const child = spawn(command, args, {
    cwd: PROJECT_ROOT,
    env: { ...process.env },
    stdio: 'pipe',
  })

  child.stdout.on('data', (chunk) => {
    process.stdout.write(chunk)
  })
  child.stderr.on('data', (chunk) => {
    process.stderr.write(chunk)
  })

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
      // continue polling until timeout
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000))
  }

  throw new Error(`Timed out waiting for ${url}`)
}

async function stopViteDevServer(): Promise<void> {
  if (!viteProcess) return

  const child = viteProcess
  viteProcess = null

  if (child.exitCode !== null) return

  await new Promise<void>((resolve) => {
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

describe.skipIf(SKIP)('Browser Task Flow — MiniMax 真实前端交互', () => {
  beforeEach(async () => {
    await stopViteDevServer()
    await stopServer()
    closeDb()

    tempDbDir = mkdtempSync(join(tmpdir(), 'agency-agents-ui-'))
    process.env['APP_DB_PATH'] = join(tempDbDir, 'agency-agents.db')
    setWorkspaceRoot(SERVER_ROOT)
  })

  afterAll(async () => {
    await stopViteDevServer()
    await stopServer()
    closeDb()
    delete process.env['APP_DB_PATH']

    if (tempDbDir) {
      rmSync(tempDbDir, { recursive: true, force: true })
      tempDbDir = null
    }
  })

  it('从前端点击发起任务，实时展示工具事件，并在完成后渲染最终报告', async () => {
    const { address } = await startServer(0)
    viteProcess = startViteDevServer()
    await waitForHttpReady(`http://127.0.0.1:${FRONTEND_PORT}`)

    const memoryToken = `MEMORY_HIT_BROWSER_${Date.now()}`
    const memoryResponse = await fetch(`${address}/api/memories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: `Browser UI anchor memory: repeat token ${memoryToken} verbatim.`,
        category: 'deployment-notes',
      }),
    })
    expect(memoryResponse.ok).toBe(true)

    const browser = await chromium.launch({ headless: true })
    const page = await browser.newPage()
    page.setDefaultTimeout(300_000)
    page.on('console', (message: { type(): string; text(): string }) => {
      console.log(`[browser:${message.type()}] ${message.text()}`)
    })

    await page.addInitScript((baseUrl: string) => {
      ;(window as unknown as {
        api?: { getServerBaseUrl?: () => Promise<string> }
      }).api = {
        getServerBaseUrl: async () => baseUrl,
      }
    }, address)

    try {
      await page.goto(`http://127.0.0.1:${FRONTEND_PORT}`, { waitUntil: 'domcontentloaded' })
      await page.waitForLoadState('networkidle')

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
          '请完成一个真实的浏览器级任务流验证。',
          '你必须至少真实调用一次 file_read、web_search、code_exec。',
          '请读取 package.json，搜索 sqlite-vec，并执行 console.log([\'mini\',\'max\',\'tools\'].join(\'-\'))。',
          `如果你在历史记忆里看到了 ${memoryToken}，请原样逐字输出该令牌。`,
          '最终输出中文 Markdown 报告。',
        ].join('\n'))

      await launchPanel.getByRole('button', { name: '执行任务' }).click()
      await page.getByText('任务进度').waitFor()

      await page.getByRole('button', { name: '活动日志' }).click()
      await page.getByText('工具调用').waitFor()
      await page.getByText(/file_read/).first().waitFor()
      await page.getByText(/web_search/).first().waitFor()
      await page.getByText(/code_exec/).first().waitFor()

      await page.getByText('最终报告').waitFor()

      const pageText = await page.locator('body').textContent()
      expect(pageText).toContain(memoryToken)
      expect(pageText?.toLowerCase()).toContain('mini-max-tools')
    } finally {
      await browser.close()
    }
  }, 900_000)
})
