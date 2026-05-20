const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  loadPrices: () => ipcRenderer.invoke('load-prices'),
  savePrices: (payload) => ipcRenderer.invoke('save-prices', payload),
  loadUsers: () => ipcRenderer.invoke('load-users'),
  saveUsers: (users) => ipcRenderer.invoke('save-users', users),
  getConfig: () => ipcRenderer.invoke('get-config'),
  updateConfig: (nextConfig) => ipcRenderer.invoke('update-config', nextConfig),
  tryLock: (user) => ipcRenderer.invoke('try-lock', user),
  heartbeatLock: (user) => ipcRenderer.invoke('heartbeat-lock', user),
  releaseLock: (user) => ipcRenderer.invoke('release-lock', user),
  getLockStatus: () => ipcRenderer.invoke('get-lock-status'),
  pickExcelFile: () => ipcRenderer.invoke('pick-excel-file'),
  getExcelSheets: (filePath) => ipcRenderer.invoke('get-excel-sheets', filePath),
  importExcel: (filePath, sheetName) => ipcRenderer.invoke('import-excel', filePath, sheetName),
  exportExcel: (items) => ipcRenderer.invoke('export-excel', items),
  exportSheet: (payload) => ipcRenderer.invoke('export-sheet', payload),
  getPricesVersion: () => ipcRenderer.invoke('get-prices-version'),
  backupPrices: () => ipcRenderer.invoke('backup-prices'),
  windowClose: () => ipcRenderer.invoke('window-close'),
  windowMinimize: () => ipcRenderer.invoke('window-minimize'),
  windowToggleMaximize: () => ipcRenderer.invoke('window-toggle-maximize'),
  checkUpdates: () => ipcRenderer.invoke('check-updates'),
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  onUpdateEvent: (callback) => {
    const listener = (_event, data) => callback(data)
    ipcRenderer.on('update-event', listener)
    return () => ipcRenderer.removeListener('update-event', listener)
  },
})
