import { app, BrowserWindow, dialog, ipcMain, net, protocol } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { mkdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ArchiveStore, type ImportMetadata } from './archive-store'
import type { ScoreRecord } from '../shared/score-domain'

protocol.registerSchemesAsPrivileged([{ scheme: 'arpeggio', privileges: { standard: true, secure: true, supportFetchAPI: true } }])

// ARPEGGIO_DATA_DIR isolates the archive, but the renderer also keeps small UI
// preferences (last stage layout, last featured score) in localStorage, and
// localStorage lives under Electron's userData instead. Left alone, a test run
// inherits whatever the previous run wrote and its outcome depends on ordering
// — a "single sheet" choice made by one spec silently failed the next. Pointing
// userData at the same sandbox keeps a run self-contained. Real launches leave
// the variable unset and keep the normal profile.
if (process.env.ARPEGGIO_DATA_DIR) app.setPath('userData', join(process.env.ARPEGGIO_DATA_DIR, 'user-data'))

let store: ArchiveStore

async function exists(path: string): Promise<boolean> {
  try { await stat(path); return true } catch { return false }
}

function seedRoot(): string {
  return app.isPackaged ? join(process.resourcesPath, 'seed-library') : join(app.getAppPath(), 'resources', 'seed-library')
}

async function prepareStore(): Promise<ArchiveStore> {
  const root = process.env.ARPEGGIO_DATA_DIR || join(app.getPath('userData'), 'Guitar Archive')
  await mkdir(root, { recursive: true })
  const archiveStore = await ArchiveStore.open(root, process.env.ARPEGGIO_DISABLE_COVER_LOOKUP ? async () => null : undefined)
  return archiveStore
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1500,
    height: 940,
    minWidth: 1120,
    minHeight: 720,
    show: false,
    backgroundColor: '#04060a',
    autoHideMenuBar: true,
    title: 'Arpeggio · 私人吉他曲谱档案馆',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  window.on('ready-to-show', () => window.show())
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) window.loadURL(process.env.ELECTRON_RENDERER_URL)
  else window.loadFile(join(__dirname, '../renderer/index.html'))
  return window
}

function registerIpc(): void {
  ipcMain.handle('scores:list', () => store.listScores())
  ipcMain.handle('scores:refresh-covers', () => store.refreshMissingCovers())
  ipcMain.handle('scores:choose-files', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择曲谱页面',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: '曲谱文件', extensions: ['pdf', 'jpg', 'jpeg', 'png', 'webp'] }]
    })
    return result.canceled ? [] : result.filePaths.map((path) => ({ path, name: path.split(/[\\/]/).at(-1) ?? path }))
  })
  ipcMain.handle('scores:import', (_event, paths: string[], metadata: ImportMetadata) => store.importScore(paths, metadata))
  ipcMain.handle('scores:update', (_event, id: string, patch: Partial<ScoreRecord>) => store.updateScore(id, patch))
  ipcMain.handle('scores:asset-url', (_event, path: string) => `arpeggio://asset/${encodeURIComponent(path)}`)
  ipcMain.handle('window:fullscreen', (event, value: boolean) => BrowserWindow.fromWebContents(event.sender)?.setFullScreen(value))
  ipcMain.handle('app:is-packaged', () => app.isPackaged)
  ipcMain.handle('state:get', () => store.getLibraryState())
  ipcMain.handle('state:save', (_event, state) => store.saveLibraryState(state))
  ipcMain.handle('backup:create', async () => {
    const result = await dialog.showOpenDialog({ title: '选择备份保存位置', properties: ['openDirectory', 'createDirectory'] })
    if (result.canceled || !result.filePaths[0]) return { canceled: true }
    return { canceled: false, path: await store.createBackup(result.filePaths[0]) }
  })
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.arpeggio.archive')
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))
  store = await prepareStore()
  protocol.handle('arpeggio', (request) => {
    const url = new URL(request.url)
    if (url.hostname !== 'asset') return new Response('Not found', { status: 404 })
    try {
      const relativePath = decodeURIComponent(url.pathname.slice(1))
      return net.fetch(pathToFileURL(store.absoluteAssetPath(relativePath)).toString())
    } catch {
      return new Response('Invalid path', { status: 400 })
    }
  })
  registerIpc()
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
