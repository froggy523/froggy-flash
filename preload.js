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
  exitApp: () => ipcRenderer.invoke('app-exit')
});


