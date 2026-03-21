import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createRequire } from 'node:module'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { startServer, stopServer } from '../index.js'
import { closeDb } from '../storage/db.js'
import { setWorkspaceRoot } from '../tools/file-read.js'

const requireFromClawtest = createRequire('D:/clawtest/package.json')
const { chromium } = requireFromClawtest('playwright') as { chromium: any }

const PROJECT_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const SERVER_ROOT = fileURLToPath(new URL('../..', import.meta.url))
let frontendPort = 4300 + Math.floor(Math.random() * 200)

let viteProcess: ChildProcessWithoutNullStreams | null = null

function getViteCommand(): string {
  return process.platform === 'win32' ? 'cmd.exe' : 'npm'
}

function startViteDevServer(): ChildProcessWithoutNullStreams {
  const command = getViteCommand()
  const args = process.platform === 'win32'
    ? ['/d', '/s', '/c', `npm run dev -- --host 127.0.0.1 --port ${frontendPort} --strictPort`]
    : ['run', 'dev', '--', '--host', '127.0.0.1', '--port', String(frontendPort), '--strictPort']

  const child = spawn(command, args, {
    cwd: PROJECT_ROOT,
    env: { ...process.env },
    stdio: 'pipe',
  })

  child.stdout.on('data', (chunk) => process.stdout.write(chunk))
  child.stderr.on('data', (chunk) => process.stderr.write(chunk))

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

describe('Skill Market UI - 429 preview behavior', () => {
  beforeEach(async () => {
    await stopViteDevServer()
    await stopServer()
    closeDb()
    frontendPort = 4300 + Math.floor(Math.random() * 200)
    setWorkspaceRoot(SERVER_ROOT)
  })

  afterAll(async () => {
    await stopViteDevServer()
    await stopServer()
    closeDb()
  })

  it('shows retryable 429 hint and keeps install button gated after preview failure', async () => {
    const { address } = await startServer(0)
    viteProcess = startViteDevServer()
    await waitForHttpReady(`http://127.0.0.1:${frontendPort}`)

    const browser = await chromium.launch({ headless: true })
    const context = await browser.newContext()
    const page = await context.newPage()

    await page.addInitScript((baseUrl: string) => {
      ;(window as unknown as {
        api?: { getServerBaseUrl?: () => Promise<string> }
      }).api = {
        getServerBaseUrl: async () => baseUrl,
      }
    }, address)

    await context.route(`${address}/api/skills`, async (route: any, request: any) => {
      if (request.method() !== 'GET') {
        await route.continue()
        return
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          version: 1,
          skills: [],
        }),
      })
    })

    await context.route(`${address}/api/skills/index*`, async (route: any) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: 'clawhub.test#capcut-mate-skill',
            provider: 'clawhub',
            providerSkillId: 'capcut-mate-skill',
            name: 'Capcut Mate Skill',
            description: 'Automate CapCut editing',
            author: 'Excalibur9527',
            url: 'https://clawhub.test/skills/capcut-mate-skill',
            tags: ['clawhub'],
            version: '1.0.1',
            moderation: { verdict: 'unknown' },
          },
        ]),
      })
    })

    await context.route(`${address}/api/skills/market/preview`, async (route: any) => {
      await route.fulfill({
        status: 429,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'Market preview failed: Failed to download bundle: HTTP 429',
          code: 'UPSTREAM_RATE_LIMIT',
          retryable: true,
        }),
      })
    })

    try {
      await page.goto(`http://127.0.0.1:${frontendPort}`, { waitUntil: 'domcontentloaded' })
      await page.waitForLoadState('networkidle')

      await page.getByText('技能库').first().click()
      await page.getByRole('button', { name: '发现市场' }).click()
      await page.getByRole('heading', { name: 'Skill 市场' }).waitFor()

      const card = page.locator('section', { hasText: 'Capcut Mate Skill' }).first()
      const previewButton = card.getByRole('button', { name: '预检' })
      const installButton = card.getByRole('button', { name: '安装' })

      await previewButton.click()

      await card.getByText('Market preview failed: Failed to download bundle: HTTP 429').waitFor()
      await card.getByText('安装按钮会在预检通过后自动可用').waitFor()
      expect(await installButton.isDisabled()).toBe(true)
    } finally {
      await context.close()
      await browser.close()
    }
  }, 300_000)

  it('enables install button after preview succeeds with installable status', async () => {
    const { address } = await startServer(0)
    viteProcess = startViteDevServer()
    await waitForHttpReady(`http://127.0.0.1:${frontendPort}`)

    const browser = await chromium.launch({ headless: true })
    const context = await browser.newContext()
    const page = await context.newPage()

    await page.addInitScript((baseUrl: string) => {
      ;(window as unknown as {
        api?: { getServerBaseUrl?: () => Promise<string> }
      }).api = {
        getServerBaseUrl: async () => baseUrl,
      }
    }, address)

    await context.route(`${address}/api/skills`, async (route: any, request: any) => {
      if (request.method() !== 'GET') {
        await route.continue()
        return
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          version: 1,
          skills: [],
        }),
      })
    })

    await context.route(`${address}/api/skills/index*`, async (route: any) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: 'clawhub.test#capcut-mate-ok',
            provider: 'clawhub',
            providerSkillId: 'capcut-mate-ok',
            name: 'Capcut Mate Skill',
            description: 'Automate CapCut editing',
            author: 'Excalibur9527',
            url: 'https://clawhub.test/skills/capcut-mate-ok',
            tags: ['clawhub'],
            version: '1.0.1',
            moderation: { verdict: 'unknown' },
          },
        ]),
      })
    })

    await context.route(`${address}/api/skills/market/preview`, async (route: any) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          provider: 'clawhub',
          providerSkillId: 'capcut-mate-ok',
          compatibility: 'compatible',
          installability: 'installable',
          reasons: [],
          warnings: [],
          localPreview: {
            skillId: 'capcut-mate-ok',
            name: 'Capcut Mate Skill',
            description: 'Automate CapCut editing',
            mode: 'prompt-only',
            files: ['SKILL.md'],
            handlers: [],
            conflict: {
              hasConflict: false,
              willOverride: false,
            },
          },
        }),
      })
    })

    try {
      await page.goto(`http://127.0.0.1:${frontendPort}`, { waitUntil: 'domcontentloaded' })
      await page.waitForLoadState('networkidle')

      await page.getByText('技能库').first().click()
      await page.getByRole('button', { name: '发现市场' }).click()
      await page.getByRole('heading', { name: 'Skill 市场' }).waitFor()

      const card = page.locator('section', { hasText: 'Capcut Mate Skill' }).first()
      const previewButton = card.getByRole('button', { name: '预检' })
      const installButton = card.getByRole('button', { name: '安装' })

      expect(await installButton.isDisabled()).toBe(true)
      await previewButton.click()

      await card.getByText('安装状态: installable').waitFor()
      expect(await installButton.isDisabled()).toBe(false)
    } finally {
      await context.close()
      await browser.close()
    }
  }, 300_000)
})
