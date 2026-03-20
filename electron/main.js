const { app, BrowserWindow, shell, ipcMain, safeStorage } = require('electron')
const path = require('path')
const fs = require('fs')
const { startLocalServer, stopLocalServer, getServerPort } = require('./server-host')

const APP_TITLE = 'Agency Agents Desktop'
const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL || 'http://127.0.0.1:5173'
const PROD_INDEX_PATH = path.join(__dirname, '../dist/index.html')
const SAFE_EXTERNAL_PROTOCOLS = new Set(['https:', 'mailto:'])
const SHOULD_OPEN_DEVTOOLS =
  !app.isPackaged && process.env.ELECTRON_DISABLE_DEVTOOLS !== '1'
const SECRET_ENV_MAPPINGS = {
  openai: 'PROVIDER_OPENAI_KEY',
  anthropic: 'PROVIDER_ANTHROPIC_KEY',
  minimax: 'PROVIDER_MINIMAX_KEY',
  'minimax:baseUrl': 'PROVIDER_MINIMAX_URL',
  'ollama:baseUrl': 'PROVIDER_OLLAMA_URL',
}
let mainWindow = null

function isAllowedNavigation(targetUrl) {
  try {
    const parsedUrl = new URL(targetUrl)

    if (!app.isPackaged) {
      return parsedUrl.origin === new URL(DEV_SERVER_URL).origin
    }

    return parsedUrl.protocol === 'file:'
  } catch {
    return false
  }
}

function canOpenExternally(targetUrl) {
  try {
    const parsedUrl = new URL(targetUrl)
    return SAFE_EXTERNAL_PROTOCOLS.has(parsedUrl.protocol)
  } catch {
    return false
  }
}

// ─── Secrets helpers ─────────────────────────────────────────────────────────

function getSecretsDir() {
  return path.join(app.getPath('userData'), 'secrets')
}

function encodeSecretName(secretName) {
  return encodeURIComponent(secretName)
}

function getSecretFilePath(secretName) {
  return path.join(getSecretsDir(), `${encodeSecretName(secretName)}.enc`)
}

function getLegacySecretFilePath(secretName) {
  return path.join(getSecretsDir(), `${secretName}.enc`)
}

function getSecretFileCandidates(secretName) {
  const encodedPath = getSecretFilePath(secretName)
  const legacyPath = getLegacySecretFilePath(secretName)
  return encodedPath === legacyPath ? [encodedPath] : [encodedPath, legacyPath]
}

function ensureSecretsDir() {
  const dir = getSecretsDir()
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

function readSecret(secretName) {
  const filePath = getSecretFileCandidates(secretName).find((candidate) => fs.existsSync(candidate))
  if (!filePath) {
    return null
  }

  if (!safeStorage.isEncryptionAvailable()) {
    return null
  }

  const encrypted = fs.readFileSync(filePath)
  return safeStorage.decryptString(encrypted)
}

function writeSecret(secretName, value) {
  ensureSecretsDir()
  const encrypted = safeStorage.encryptString(value)
  fs.writeFileSync(getSecretFilePath(secretName), encrypted)
}

function removeSecret(secretName) {
  for (const candidate of getSecretFileCandidates(secretName)) {
    if (fs.existsSync(candidate)) {
      fs.rmSync(candidate)
    }
  }
}

function applyStoredSecretsToEnv() {
  for (const [secretName, envName] of Object.entries(SECRET_ENV_MAPPINGS)) {
    const value = readSecret(secretName)
    if (typeof value === 'string' && value.trim() !== '') {
      process.env[envName] = value.trim()
    } else {
      delete process.env[envName]
    }
  }
}

function getLocalDbPath() {
  return path.join(app.getPath('userData'), 'agency-agents.db')
}

async function reloadLocalServer() {
  applyStoredSecretsToEnv()
  await stopLocalServer()
  await startLocalServer(getLocalDbPath())
}

// ─── IPC handlers ────────────────────────────────────────────────────────────

function registerIpcHandlers() {
  ipcMain.handle('get-server-base-url', () => {
    const port = getServerPort()
    if (port === null) return null
    return `http://127.0.0.1:${port}`
  })

  ipcMain.handle('secrets:save', async (_event, provider, key) => {
    if (typeof provider !== 'string' || provider.trim() === '') {
      throw new Error('[secrets:save] provider must be a non-empty string')
    }
    if (typeof key !== 'string' || key.trim() === '') {
      throw new Error('[secrets:save] key must be a non-empty string')
    }
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('[secrets:save] safeStorage encryption is not available')
    }

    writeSecret(provider, key)
    await reloadLocalServer()
    return true
  })

  ipcMain.handle('secrets:save-many', async (_event, entries) => {
    if (!Array.isArray(entries)) {
      throw new Error('[secrets:save-many] entries must be an array')
    }
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('[secrets:save-many] safeStorage encryption is not available')
    }

    for (const entry of entries) {
      if (!entry || typeof entry !== 'object') {
        throw new Error('[secrets:save-many] each entry must be an object')
      }
      const { provider, value } = entry
      if (typeof provider !== 'string' || provider.trim() === '') {
        throw new Error('[secrets:save-many] provider must be a non-empty string')
      }
      if (typeof value !== 'string' || value.trim() === '') {
        throw new Error('[secrets:save-many] value must be a non-empty string')
      }
      writeSecret(provider, value)
    }

    await reloadLocalServer()
    return true
  })

  ipcMain.handle('secrets:has-key', (_event, provider) => {
    if (typeof provider !== 'string' || provider.trim() === '') {
      throw new Error('[secrets:has-key] provider must be a non-empty string')
    }
    return readSecret(provider) !== null
  })

  ipcMain.handle('secrets:remove', async (_event, provider) => {
    if (typeof provider !== 'string' || provider.trim() === '') {
      throw new Error('[secrets:remove] provider must be a non-empty string')
    }
    removeSecret(provider)
    await reloadLocalServer()
    return true
  })

  ipcMain.handle('secrets:remove-many', async (_event, providers) => {
    if (!Array.isArray(providers)) {
      throw new Error('[secrets:remove-many] providers must be an array')
    }
    for (const provider of providers) {
      if (typeof provider !== 'string' || provider.trim() === '') {
        throw new Error('[secrets:remove-many] provider must be a non-empty string')
      }
      removeSecret(provider)
    }
    await reloadLocalServer()
    return true
  })

  ipcMain.handle('secrets:test', (_event, provider) => {
    if (typeof provider !== 'string' || provider.trim() === '') {
      throw new Error('[secrets:test] provider must be a non-empty string')
    }
    // Week 2 实现：暂时返回 false
    return false
  })
}

// ─── Window ───────────────────────────────────────────────────────────────────

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1200,
    minHeight: 760,
    title: APP_TITLE,
    autoHideMenuBar: true,
    backgroundColor: '#0b1120',
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  })

  win.once('ready-to-show', () => {
    win.show()
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedNavigation(url)) {
      return { action: 'allow' }
    }

    if (canOpenExternally(url)) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  win.webContents.on('will-navigate', (event, url) => {
    if (isAllowedNavigation(url)) {
      return
    }

    event.preventDefault()
    if (canOpenExternally(url)) {
      void shell.openExternal(url)
    }
  })

  if (app.isPackaged) {
    win.loadFile(PROD_INDEX_PATH)
  } else {
    win.loadURL(DEV_SERVER_URL)
    if (SHOULD_OPEN_DEVTOOLS) {
      win.webContents.openDevTools({ mode: 'detach' })
    }
  }

  win.on('closed', () => {
    if (mainWindow === win) {
      mainWindow = null
    }
  })

  mainWindow = win
  return win
}

// ─── App lifecycle ────────────────────────────────────────────────────────────

const gotSingleInstanceLock =
  process.env.ELECTRON_DISABLE_SINGLE_INSTANCE_LOCK === '1'
    ? true
    : app.requestSingleInstanceLock()

if (!gotSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const [existingWindow] = BrowserWindow.getAllWindows()

    if (!existingWindow) {
      return
    }

    if (existingWindow.isMinimized()) {
      existingWindow.restore()
    }

    existingWindow.focus()
  })

  app.whenReady().then(async () => {
    if (process.platform === 'win32') {
      app.setAppUserModelId('com.agencyagents.desktop')
    }

    const userDataOverride = process.env.ELECTRON_USER_DATA_DIR
    if (typeof userDataOverride === 'string' && userDataOverride.trim() !== '') {
      fs.mkdirSync(userDataOverride, { recursive: true })
      app.setPath('userData', userDataOverride)
    }

    applyStoredSecretsToEnv()
    registerIpcHandlers()

    await startLocalServer(getLocalDbPath())

    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('before-quit', async (event) => {
    event.preventDefault()
    await stopLocalServer()
    app.exit(0)
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
