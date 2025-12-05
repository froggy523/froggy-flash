const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('froggyApi', {
  openFlashcardFile: () => ipcRenderer.invoke('open-flashcard-file'),
  loadScores: () => ipcRenderer.invoke('load-scores'),
  saveScores: (scores) => ipcRenderer.invoke('save-scores', scores)
});


