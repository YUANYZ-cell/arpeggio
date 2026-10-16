import { contextBridge, ipcRenderer } from 'electron'
import type { ArpeggioApi } from '../shared/ipc'

const api: ArpeggioApi = {
  listScores: () => ipcRenderer.invoke('scores:list'),
  refreshCovers: () => ipcRenderer.invoke('scores:refresh-covers'),
  chooseScoreFiles: () => ipcRenderer.invoke('scores:choose-files'),
  importScore: (paths, metadata) => ipcRenderer.invoke('scores:import', paths, metadata),
  updateScore: (id, patch) => ipcRenderer.invoke('scores:update', id, patch),
  assetUrl: (path) => ipcRenderer.invoke('scores:asset-url', path),
  enterFullscreen: (value) => ipcRenderer.invoke('window:fullscreen', value),
  isPackaged: () => ipcRenderer.invoke('app:is-packaged'),
  getLibraryState: () => ipcRenderer.invoke('state:get'),
  saveLibraryState: (state) => ipcRenderer.invoke('state:save', state),
  createBackup: () => ipcRenderer.invoke('backup:create')
}

contextBridge.exposeInMainWorld('arpeggio', api)
