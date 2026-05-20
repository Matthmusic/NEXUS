const { app, BrowserWindow, ipcMain, dialog, shell, screen, Menu, globalShortcut } = require('electron')
const { autoUpdater } = require('electron-updater')
const fs = require('fs')
const path = require('path')
const os = require('os')
const xlsx = require('xlsx')

const LOG_PREFIX = '[NEXUS]'
const isDev = !!process.env.VITE_DEV_SERVER_URL
let mainWindow = null
let splashWindow = null

function createSplash() {
  splashWindow = new BrowserWindow({
    width: 380,
    height: 440,
    frame: false,
    transparent: false,
    resizable: false,
    center: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: '#060913',
    icon: path.join(__dirname, 'nexus.ico'),
  })
  splashWindow.loadFile(path.join(__dirname, 'splash.html'))
  splashWindow.on('closed', () => { splashWindow = null })
}

if (process.platform === 'win32') {
  app.setAppUserModelId('com.matthmusic.nexus')
}

const DEFAULT_DATA_DIR = app.isPackaged
  ? 'Z:\\F - UTILITAIRES\\NEXUS'
  : path.join(process.cwd(), 'data')
const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json')

function logInfo(message, data = {}) {
  console.log(`${LOG_PREFIX} ${message}`, data)
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true })
  }
}

function loadConfig() {
  const defaults = {
    dataDir: DEFAULT_DATA_DIR,
    lockTimeoutMin: 10,
  }
  try {
    if (!fs.existsSync(CONFIG_PATH)) {
      ensureDir(path.dirname(CONFIG_PATH))
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(defaults, null, 2))
      return defaults
    }
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8')
    const parsed = JSON.parse(raw)
    return { ...defaults, ...parsed }
  } catch (error) {
    logInfo('config load failed, using defaults', { error: error.message })
    return defaults
  }
}

function saveConfig(nextConfig) {
  const current = loadConfig()
  const merged = { ...current, ...nextConfig }
  ensureDir(path.dirname(CONFIG_PATH))
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2))
  return merged
}

function getDataDir() {
  const config = loadConfig()
  ensureDir(config.dataDir)
  return config.dataDir
}

function getPricesPath() {
  return path.join(getDataDir(), 'prices.json')
}

function getUsersPath() {
  return path.join(getDataDir(), 'users.json')
}

function getLockPath() {
  return path.join(getDataDir(), 'prices.lock')
}

function getLogPath() {
  return path.join(getDataDir(), 'admin.log')
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2))
}

function ensureDefaultFiles() {
  const dataDir = getDataDir()
  ensureDir(dataDir)

  const pricesPath = getPricesPath()
  if (!fs.existsSync(pricesPath)) {
    const now = new Date().toISOString()
    writeJson(pricesPath, {
      meta: {
        version: 1,
        currency: 'EUR',
        priceType: 'HT',
        updatedAt: now,
        updatedBy: 'system',
      },
      items: [],
    })
  }

  const usersPath = getUsersPath()
  if (!fs.existsSync(usersPath)) {
    writeJson(usersPath, ['Matthieu'])
  }
}

function readJsonSafe(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback
    const raw = fs.readFileSync(filePath, 'utf-8').replace(/^\uFEFF/, '')
    return JSON.parse(raw)
  } catch (error) {
    logInfo('read json failed', { filePath, error: error.message })
    return fallback
  }
}

function readLock() {
  const lockPath = getLockPath()
  if (!fs.existsSync(lockPath)) return null
  return readJsonSafe(lockPath, null)
}

function isLockStale(lock, timeoutMin) {
  if (!lock || !lock.heartbeat) return false
  const heartbeat = new Date(lock.heartbeat).getTime()
  if (Number.isNaN(heartbeat)) return false
  const maxAge = timeoutMin * 60 * 1000
  return Date.now() - heartbeat > maxAge
}

function appendAdminLog(entry) {
  try {
    const logPath = getLogPath()
    const line = `${JSON.stringify(entry)}\n`
    fs.appendFileSync(logPath, line)
  } catch (error) {
    logInfo('append log failed', { error: error.message })
  }
}

function tryAcquireLock(user) {
  ensureDefaultFiles()
  const config = loadConfig()
  const lockPath = getLockPath()
  const now = new Date().toISOString()

  if (!user) {
    return { ok: false, reason: 'missing-user', lock: readLock() }
  }

  const existing = readLock()
  if (existing) {
    if (isLockStale(existing, config.lockTimeoutMin)) {
      appendAdminLog({
        timestamp: now,
        action: 'expired',
        user: existing.user,
        machine: existing.machine,
      })
      try {
        fs.unlinkSync(lockPath)
      } catch (error) {
        return { ok: false, reason: 'cannot-clear-stale', lock: existing }
      }
    } else {
      appendAdminLog({
        timestamp: now,
        action: 'denied',
        user,
        currentAdmin: existing.user,
        machine: os.hostname(),
      })
      return { ok: false, reason: 'locked', lock: existing }
    }
  }

  try {
    const fd = fs.openSync(lockPath, 'wx')
    const lock = {
      user,
      machine: os.hostname(),
      pid: process.pid,
      since: now,
      heartbeat: now,
    }
    fs.writeFileSync(fd, JSON.stringify(lock, null, 2))
    fs.closeSync(fd)
    appendAdminLog({ timestamp: now, action: 'lock', user, machine: lock.machine })
    return { ok: true, lock }
  } catch (error) {
    if (error.code === 'EEXIST') {
      return { ok: false, reason: 'locked', lock: readLock() }
    }
    throw error
  }
}

function heartbeatLock(user) {
  const config = loadConfig()
  const lock = readLock()
  if (!lock) return { ok: false, reason: 'no-lock' }
  if (lock.user !== user) return { ok: false, reason: 'not-owner', lock }
  if (isLockStale(lock, config.lockTimeoutMin)) {
    return { ok: false, reason: 'stale', lock }
  }
  const next = { ...lock, heartbeat: new Date().toISOString() }
  writeJson(getLockPath(), next)
  return { ok: true, lock: next }
}

function releaseLock(user) {
  const lockPath = getLockPath()
  const lock = readLock()
  if (!lock) return { ok: true, released: false }
  if (lock.user !== user) return { ok: false, released: false, reason: 'not-owner', lock }
  try {
    fs.unlinkSync(lockPath)
    appendAdminLog({ timestamp: new Date().toISOString(), action: 'unlock', user, machine: lock.machine })
    return { ok: true, released: true }
  } catch (error) {
    return { ok: false, released: false, reason: 'unlink-failed', lock }
  }
}

function getLockStatus() {
  const config = loadConfig()
  const lock = readLock()
  if (!lock) return { lock: null, stale: false }
  return { lock, stale: isLockStale(lock, config.lockTimeoutMin) }
}

function readPrices() {
  ensureDefaultFiles()
  return readJsonSafe(getPricesPath(), { meta: { version: 1 }, items: [] })
}

function savePrices(payload) {
  ensureDefaultFiles()
  const user = payload?.user || ''
  const db = payload?.db
  if (!db || typeof db !== 'object') {
    throw new Error('Donnees invalides')
  }
  const lock = readLock()
  if (!lock || lock.user !== user) {
    throw new Error('Mode admin requis pour enregistrer')
  }
  const tmpPath = `${getPricesPath()}.tmp`
  fs.writeFileSync(tmpPath, JSON.stringify(db, null, 2))
  fs.renameSync(tmpPath, getPricesPath())
  try { fs.writeFileSync(getPricesVersionPath(), new Date().toISOString()) } catch { /* non-bloquant */ }
  return true
}

function loadUsers() {
  ensureDefaultFiles()
  const users = readJsonSafe(getUsersPath(), [])
  return Array.isArray(users) ? users : []
}

function saveUsers(users) {
  if (!Array.isArray(users)) {
    throw new Error('Liste utilisateurs invalide')
  }
  ensureDefaultFiles()
  writeJson(getUsersPath(), users)
  return users
}

function indexToColumnLabel(index) {
  let value = index + 1
  let label = ''
  while (value > 0) {
    const remainder = (value - 1) % 26
    label = String.fromCharCode(65 + remainder) + label
    value = Math.floor((value - 1) / 26)
  }
  return label
}

function getExcelSheets(filePath) {
  if (!filePath) throw new Error('Chemin fichier manquant')
  if (!fs.existsSync(filePath)) throw new Error('Fichier introuvable')
  const workbook = xlsx.readFile(filePath, { bookSheets: true })
  return workbook.SheetNames
}

function importExcel(filePath, sheetName) {
  if (!filePath) throw new Error('Chemin fichier manquant')
  if (!fs.existsSync(filePath)) throw new Error('Fichier introuvable')
  const workbook = xlsx.readFile(filePath, { cellDates: true })
  const targetSheet = sheetName && workbook.SheetNames.includes(sheetName)
    ? sheetName
    : workbook.SheetNames[0]
  if (!targetSheet) throw new Error('Aucune feuille Excel')
  const worksheet = workbook.Sheets[targetSheet]
  const rows = xlsx.utils.sheet_to_json(worksheet, {
    header: 1,
    defval: '',
    blankrows: false,
    raw: false,
  })
  const maxColumns = rows.reduce((max, row) => Math.max(max, row.length), 0)
  const columns = Array.from({ length: maxColumns }, (_, index) => indexToColumnLabel(index))
  return { sheetName: targetSheet, sheetNames: workbook.SheetNames, rows, columns }
}

async function exportSheet({ rows, filename }) {
  if (!Array.isArray(rows)) throw new Error('Donnees invalides')
  const defaultName = filename || `nexus-export-${new Date().toISOString().slice(0, 10)}.xlsx`
  const res = await dialog.showSaveDialog(mainWindow, {
    title: 'Exporter',
    defaultPath: defaultName,
    filters: [{ name: 'Excel (.xlsx)', extensions: ['xlsx'] }],
  })
  if (res.canceled || !res.filePath) return null
  const ws = xlsx.utils.aoa_to_sheet(rows)
  const wb = xlsx.utils.book_new()
  xlsx.utils.book_append_sheet(wb, ws, 'Export')
  xlsx.writeFile(wb, res.filePath)
  return res.filePath
}

function getPricesVersionPath() {
  return path.join(getDataDir(), 'prices.ver')
}


function getPricesVersion() {
  const verPath = getPricesVersionPath()
  if (!fs.existsSync(verPath)) return null
  try { return fs.readFileSync(verPath, 'utf-8').trim() } catch { return null }
}

function backupPrices() {
  ensureDefaultFiles()
  const src = getPricesPath()
  if (!fs.existsSync(src)) return null
  const backupDir = path.join(getDataDir(), 'backups')
  ensureDir(backupDir)
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const dest = path.join(backupDir, `prices-${timestamp}.json`)
  fs.copyFileSync(src, dest)
  return dest
}

async function exportExcel(items) {
  if (!Array.isArray(items)) throw new Error('Donnees invalides')
  const defaultName = `nexus-export-${new Date().toISOString().slice(0, 10)}.xlsx`
  const res = await dialog.showSaveDialog(mainWindow, {
    title: 'Exporter la base de prix',
    defaultPath: defaultName,
    filters: [
      { name: 'Excel (.xlsx)', extensions: ['xlsx'] },
      { name: 'CSV (.csv)', extensions: ['csv'] },
    ],
  })
  if (res.canceled || !res.filePath) return null
  const data = items.map((item) => ({
    Reference: item.ref,
    Libelle: item.name,
    Unite: item.unit || '',
    'Prix HT': item.price,
    Categorie: item.category || '',
    Fournisseur: item.supplier || '',
    'Mots-cles': (item.keywords || []).join(', '),
    'Mis a jour le': item.updatedAt ? new Date(item.updatedAt).toLocaleString('fr-FR') : '',
    'Mis a jour par': item.updatedBy || '',
  }))
  const ws = xlsx.utils.json_to_sheet(data)
  const wb = xlsx.utils.book_new()
  xlsx.utils.book_append_sheet(wb, ws, 'Prix')
  xlsx.writeFile(wb, res.filePath)
  return res.filePath
}

function sendToMainWindow(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
    mainWindow.webContents.send(channel, payload)
  }
}

function wireAutoUpdater() {
  if (isDev) return
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('update-available', (info) => sendToMainWindow('update-event', { type: 'available', info }))
  autoUpdater.on('update-not-available', () => sendToMainWindow('update-event', { type: 'not-available' }))
  autoUpdater.on('error', (err) => sendToMainWindow('update-event', { type: 'error', message: err.message }))
  autoUpdater.on('download-progress', (progress) => sendToMainWindow('update-event', { type: 'progress', progress }))
  autoUpdater.on('update-downloaded', (info) => sendToMainWindow('update-event', { type: 'downloaded', info }))
}

function createWindow() {
  const { width: displayW, height: displayH } = screen.getPrimaryDisplay().workAreaSize
  const targetW = Math.max(1100, Math.min(1400, Math.round(displayW * 0.9)))
  const targetH = Math.max(760, Math.min(1100, Math.round(displayH * 0.8)))

  mainWindow = new BrowserWindow({
    width: targetW,
    height: targetH,
    minWidth: 1040,
    minHeight: 720,
    backgroundColor: '#060913',
    title: 'NEXUS',
    frame: false,
    titleBarStyle: 'hidden',
    show: false,
    icon: path.join(__dirname, 'nexus.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  const splashStart = Date.now()
  const MIN_SPLASH_MS = 1800

  mainWindow.once('ready-to-show', () => {
    const elapsed = Date.now() - splashStart
    const remaining = Math.max(0, MIN_SPLASH_MS - elapsed)
    setTimeout(() => {
      if (splashWindow) splashWindow.close()
      mainWindow.show()
    }, remaining)
  })

  if (isDev) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    const indexPath = path.join(__dirname, '../dist/index.html')
    mainWindow.loadFile(indexPath)
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
}

ipcMain.handle('load-prices', () => readPrices())
ipcMain.handle('save-prices', (_event, payload) => savePrices(payload))
ipcMain.handle('load-users', () => loadUsers())
ipcMain.handle('save-users', (_event, users) => saveUsers(users))
ipcMain.handle('get-config', () => loadConfig())
ipcMain.handle('update-config', (_event, nextConfig) => saveConfig(nextConfig))

ipcMain.handle('try-lock', (_event, user) => tryAcquireLock(user))
ipcMain.handle('heartbeat-lock', (_event, user) => heartbeatLock(user))
ipcMain.handle('release-lock', (_event, user) => releaseLock(user))
ipcMain.handle('get-lock-status', () => getLockStatus())

ipcMain.handle('pick-excel-file', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    title: 'Selectionner un fichier Excel',
    filters: [
      { name: 'Excel (.xls/.xlsx)', extensions: ['xls', 'xlsx'] },
      { name: 'All files', extensions: ['*'] },
    ],
  })
  if (res.canceled || res.filePaths.length === 0) return null
  return res.filePaths[0]
})

ipcMain.handle('get-excel-sheets', (_event, filePath) => getExcelSheets(filePath))
ipcMain.handle('import-excel', (_event, filePath, sheetName) => importExcel(filePath, sheetName))
ipcMain.handle('export-excel', (_event, items) => exportExcel(items))
ipcMain.handle('export-sheet', (_event, payload) => exportSheet(payload))
ipcMain.handle('get-prices-version', () => getPricesVersion())
ipcMain.handle('backup-prices', () => backupPrices())

ipcMain.handle('check-updates', async () => {
  if (isDev) return { status: 'dev' }
  try {
    const result = await autoUpdater.checkForUpdates()
    if (result?.updateInfo?.version && result.updateInfo.version !== app.getVersion()) {
      return { status: 'available', version: result.updateInfo.version }
    }
    return { status: 'up-to-date', version: app.getVersion() }
  } catch (err) {
    return { status: 'error', message: String(err) }
  }
})
ipcMain.handle('download-update', async () => { if (!isDev) await autoUpdater.downloadUpdate() })
ipcMain.handle('install-update', () => { if (!isDev) autoUpdater.quitAndInstall() })

ipcMain.handle('window-close', () => {
  if (mainWindow) mainWindow.close()
})

ipcMain.handle('window-minimize', () => {
  if (mainWindow) mainWindow.minimize()
})

ipcMain.handle('window-toggle-maximize', () => {
  if (!mainWindow) return
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize()
  } else {
    mainWindow.maximize()
  }
})

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)
  createSplash()
  createWindow()
  wireAutoUpdater()
  if (!isDev) autoUpdater.checkForUpdates()
  if (isDev) {
    globalShortcut.register('Control+Shift+I', () => {
      const win = BrowserWindow.getFocusedWindow()
      if (win) win.webContents.toggleDevTools({ mode: 'detach' })
    })
    globalShortcut.register('F12', () => {
      const win = BrowserWindow.getFocusedWindow()
      if (win) win.webContents.toggleDevTools({ mode: 'detach' })
    })
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})
