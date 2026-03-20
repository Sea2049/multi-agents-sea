/**
 * electron/server-host.js
 * 在 Electron main process 中管理本地 Fastify 服务的生命周期。
 *
 * 导出:
 *   startLocalServer(dbPath) - 启动服务，返回 Promise<number | null> (端口号或 null)
 *   stopLocalServer()        - 优雅停止服务
 *   getServerPort()          - 同步获取当前端口，未启动则返回 null
 */

'use strict'

const path = require('path')
const fs = require('fs')
const { spawn } = require('node:child_process')
const { pathToFileURL } = require('node:url')

let _serverPort = null
/** @type {(() => Promise<void>) | null} */
let _stopFn = null
/** @type {import('node:child_process').ChildProcessWithoutNullStreams | null} */
let _serverProcess = null
let _starting = false

const STARTUP_TIMEOUT_MS = 30_000

function firstExistingPath(candidates) {
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate
    }
  }

  return candidates[0]
}

function getNodeExecutable() {
  if (typeof process.env['NODE_BINARY'] === 'string' && process.env['NODE_BINARY'].trim() !== '') {
    return process.env['NODE_BINARY']
  }

  return process.platform === 'win32' ? 'node.exe' : 'node'
}

async function stopExternalServerProcess() {
  if (!_serverProcess) {
    _serverPort = null
    return
  }

  const child = _serverProcess
  _serverProcess = null

  if (child.exitCode !== null) {
    _serverPort = null
    return
  }

  await new Promise((resolve) => {
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

  _serverPort = null
}

async function startExternalLocalServer(entryPath, dbPath) {
  const nodeExecutable = getNodeExecutable()

  return new Promise((resolve, reject) => {
    const child = spawn(nodeExecutable, [entryPath], {
      cwd: path.join(__dirname, '..', 'server'),
      env: {
        ...process.env,
        APP_DB_PATH: dbPath || process.env['APP_DB_PATH'],
        APP_PORT: '0',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    _serverProcess = child

    let settled = false
    let stdout = ''
    let stderr = ''

    const cleanupAndReject = (error) => {
      if (settled) return
      settled = true
      _serverProcess = null
      _serverPort = null
      reject(error)
    }

    const timer = setTimeout(() => {
      cleanupAndReject(
        new Error(
          `[server-host] External server did not start within ${STARTUP_TIMEOUT_MS}ms.\nstdout:\n${stdout}\nstderr:\n${stderr}`
        )
      )
    }, STARTUP_TIMEOUT_MS)

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString()
      stdout += text

      const match = stdout.match(/Fastify listening on http:\/\/127\.0\.0\.1:(\d+)/)
      if (!match) return

      const port = Number(match[1])
      if (!Number.isFinite(port) || port <= 0 || settled) return

      settled = true
      clearTimeout(timer)
      _serverPort = port
      _stopFn = stopExternalServerProcess
      resolve(port)
    })

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })

    child.on('error', (error) => {
      clearTimeout(timer)
      cleanupAndReject(error)
    })

    child.on('exit', (code) => {
      clearTimeout(timer)

      if (settled) {
        return
      }

      cleanupAndReject(
        new Error(
          `[server-host] External server exited before startup completed (code: ${code}).\nstdout:\n${stdout}\nstderr:\n${stderr}`
        )
      )
    })
  })
}

/**
 * 解析 server 编译产物入口路径（ESM dist）。
 *
 * 开发态：<projectRoot>/server/dist/index.js
 * 生产态（asar）：__dirname 已在 asar 内，向上一级是 asar 根
 * 生产态（非 asar）：同上路径结构
 */
function resolveServerEntry() {
  const { app } = require('electron')

  if (!app.isPackaged) {
    // __dirname = <project>/electron/
    return firstExistingPath([
      path.join(__dirname, '..', 'server', 'dist', 'server', 'src', 'index.js'),
      path.join(__dirname, '..', 'server', 'dist', 'index.js'),
    ])
  }

  // 打包后 __dirname = <resources>/app.asar/electron/
  return firstExistingPath([
    path.join(__dirname, '..', 'server', 'dist', 'server', 'src', 'index.js'),
    path.join(__dirname, '..', 'server', 'dist', 'index.js'),
    path.join(
      process.resourcesPath,
      'app.asar.unpacked',
      'server',
      'dist',
      'server',
      'src',
      'index.js'
    ),
    path.join(
      process.resourcesPath,
      'app.asar.unpacked',
      'server',
      'dist',
      'index.js'
    ),
    path.join(process.resourcesPath, 'server', 'dist', 'server', 'src', 'index.js'),
    path.join(process.resourcesPath, 'server', 'dist', 'index.js'),
  ])
}

/**
 * 启动本地 Fastify 服务。
 * dbPath 通过环境变量 APP_DB_PATH 传入，避免改变 server 的函数签名。
 *
 * @param {string} [dbPath] - SQLite 数据库文件路径
 * @returns {Promise<number | null>} 实际监听端口，失败返回 null
 */
async function startLocalServer(dbPath) {
  if (_serverPort !== null) {
    return _serverPort
  }

  if (_starting) {
    const deadline = Date.now() + STARTUP_TIMEOUT_MS
    while (_starting && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    return _serverPort
  }

  _starting = true

  const entryPath = resolveServerEntry()
  const { app } = require('electron')
  const useExternalServer =
    process.env['ELECTRON_EXTERNAL_SERVER'] === '1' || !app.isPackaged

  if (!fs.existsSync(entryPath)) {
    console.warn(`[server-host] entry not found: ${entryPath}`)
    console.warn(
      '[server-host] Degraded mode — run "npm run build" inside server/ first.'
    )
    _starting = false
    return null
  }

  // 通过环境变量把 dbPath 传给 server（避免修改 startServer 签名）
  if (dbPath) {
    process.env['APP_DB_PATH'] = dbPath
  }

  try {
    if (useExternalServer) {
      _serverPort = await startExternalLocalServer(entryPath, dbPath)
      console.log(`[server-host] External local server started on port ${_serverPort}`)
      return _serverPort
    }

    // server/dist 是 ESM，使用动态 import() 在 CJS 主进程中异步加载
    const loadPromise = import(pathToFileURL(entryPath).href).then(async (mod) => {
      if (typeof mod.startServer !== 'function') {
        throw new Error(
          `[server-host] startServer is not exported from ${entryPath}`
        )
      }
      const { port } = await mod.startServer(0)

      // server 把 stop 函数存在模块内部，通过独立的 stopServer 导出
      const stopServer = mod.stopServer
      if (typeof stopServer === 'function') {
        _stopFn = stopServer
      }

      return port
    })

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(
              `[server-host] Server did not start within ${STARTUP_TIMEOUT_MS}ms`
            )
          ),
        STARTUP_TIMEOUT_MS
      )
    )

    _serverPort = await Promise.race([loadPromise, timeoutPromise])
    console.log(`[server-host] Local server started on port ${_serverPort}`)
  } catch (err) {
    console.error('[server-host] Failed to start local server:', err)
    console.warn('[server-host] Application will run in degraded mode.')
    _serverPort = null
    _stopFn = null
  } finally {
    _starting = false
  }

  return _serverPort
}

/**
 * 优雅停止本地服务。
 */
async function stopLocalServer() {
  if (_stopFn) {
    try {
      await _stopFn()
      console.log('[server-host] Local server stopped.')
    } catch (err) {
      console.error('[server-host] Error while stopping local server:', err)
    } finally {
      _stopFn = null
      _serverPort = null
    }
  }
}

/**
 * 同步获取当前监听端口。
 * @returns {number | null}
 */
function getServerPort() {
  return _serverPort
}

module.exports = { startLocalServer, stopLocalServer, getServerPort }
