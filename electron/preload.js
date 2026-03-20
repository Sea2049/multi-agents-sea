const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('desktop', {
  isElectron: true,
  platform: process.platform,
  versions: {
    chrome: process.versions.chrome,
    electron: process.versions.electron,
    node: process.versions.node,
  },
})

contextBridge.exposeInMainWorld('api', {
  getServerBaseUrl: () => ipcRenderer.invoke('get-server-base-url'),

  secrets: {
    save: (provider, key) => {
      if (typeof provider !== 'string' || typeof key !== 'string') {
        return Promise.reject(new Error('provider and key must be strings'))
      }
      return ipcRenderer.invoke('secrets:save', provider, key)
    },
    saveMany: (entries) => {
      if (!Array.isArray(entries)) {
        return Promise.reject(new Error('entries must be an array'))
      }
      return ipcRenderer.invoke('secrets:save-many', entries)
    },
    hasKey: (provider) => {
      if (typeof provider !== 'string') {
        return Promise.reject(new Error('provider must be a string'))
      }
      return ipcRenderer.invoke('secrets:has-key', provider)
    },
    remove: (provider) => {
      if (typeof provider !== 'string') {
        return Promise.reject(new Error('provider must be a string'))
      }
      return ipcRenderer.invoke('secrets:remove', provider)
    },
    removeMany: (providers) => {
      if (!Array.isArray(providers)) {
        return Promise.reject(new Error('providers must be an array'))
      }
      return ipcRenderer.invoke('secrets:remove-many', providers)
    },
    test: (provider) => {
      if (typeof provider !== 'string') {
        return Promise.reject(new Error('provider must be a string'))
      }
      return ipcRenderer.invoke('secrets:test', provider)
    },
  },
})
