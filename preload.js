const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('froggyApi', {
  openFlashcardFile: () => ipcRenderer.invoke('open-flashcard-file'),
  listDecks: () => ipcRenderer.invoke('list-decks'),
  loadDeckByPath: (filePath) => ipcRenderer.invoke('load-deck-by-path', filePath),
  loadScores: () => ipcRenderer.invoke('load-scores'),
  saveScores: (scores) => ipcRenderer.invoke('save-scores', scores),
  loadSessionHistory: () => ipcRenderer.invoke('load-session-history'),
  appendSessionHistory: (entry) => ipcRenderer.invoke('append-session-history', entry),
  exportGraphData: () => ipcRenderer.invoke('export-graph-data'),
  loadUiConfig: () => ipcRenderer.invoke('load-ui-config'),
  saveUiConfig: (uiConfig) => ipcRenderer.invoke('save-ui-config', uiConfig),
  exitApp: () => ipcRenderer.invoke('app-exit'),
  loadLlmSettings: () => ipcRenderer.invoke('load-llm-settings'),
  saveLlmSettings: (partial) => ipcRenderer.invoke('save-llm-settings', partial),
  pickJsonFiles: () => ipcRenderer.invoke('pick-json-files'),
  createDeck: (payload) => ipcRenderer.invoke('create-deck', payload),
  renameDeck: (payload) => ipcRenderer.invoke('rename-deck', payload),
  deleteDeck: (payload) => ipcRenderer.invoke('delete-deck', payload),
  importDeckSets: (payload) => ipcRenderer.invoke('import-deck-sets', payload),
  readCardSetFile: (filePath) => ipcRenderer.invoke('read-card-set-file', filePath),
  writeCardSetFile: (payload) => ipcRenderer.invoke('write-card-set-file', payload),
  deleteCardSetFile: (filePath) => ipcRenderer.invoke('delete-card-set-file', filePath),
  generateCardSetViaLlm: (payload) => ipcRenderer.invoke('generate-card-set-via-llm', payload),
  getAppUpdateInfo: () => ipcRenderer.invoke('update-get-info'),
  checkForAppUpdates: () => ipcRenderer.invoke('update-check'),
  quitAndInstallUpdate: () => ipcRenderer.invoke('update-quit-and-install'),
  onAutoUpdateEvent: (callback) => {
    if (typeof callback !== 'function') {
      return () => {};
    }
    const listener = (_event, detail) => {
      callback(detail);
    };
    ipcRenderer.on('auto-update-event', listener);
    return () => {
      ipcRenderer.removeListener('auto-update-event', listener);
    };
  }
});


