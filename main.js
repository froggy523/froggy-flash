const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile('index.html');

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function getScoresFilePath() {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, 'froggy-flash-scores.json');
}

function readScoresFromDisk() {
  try {
    const scoresPath = getScoresFilePath();
    if (!fs.existsSync(scoresPath)) {
      return {};
    }
    const raw = fs.readFileSync(scoresPath, 'utf8');
    if (!raw.trim()) {
      return {};
    }
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) {
      return {};
    }
    return parsed;
  } catch (err) {
    console.error('Failed to read scores from disk:', err);
    return {};
  }
}

function writeScoresToDisk(scores) {
  try {
    const scoresPath = getScoresFilePath();
    const dir = path.dirname(scoresPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(scoresPath, JSON.stringify(scores, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('Failed to write scores to disk:', err);
    return false;
  }
}

// IPC handlers
ipcMain.handle('open-flashcard-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Open Flashcard Set JSON',
    properties: ['openFile'],
    filters: [{ name: 'JSON Files', extensions: ['json'] }]
  });

  if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
    return { canceled: true };
  }

  const filePath = result.filePaths[0];

  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw);

    // Basic shape validation
    if (!data || typeof data !== 'object') {
      throw new Error('JSON must be an object.');
    }
    if (!data.name || !Array.isArray(data.cards)) {
      throw new Error('JSON must include "name" and "cards" array.');
    }

    return {
      canceled: false,
      filePath,
      set: data
    };
  } catch (err) {
    console.error('Failed to load flashcard JSON:', err);
    dialog.showErrorBox('Invalid Flashcard File', err.message);
    return { canceled: true, error: err.message };
  }
});

ipcMain.handle('load-scores', () => {
  return readScoresFromDisk();
});

ipcMain.handle('save-scores', (_event, scores) => {
  if (!scores || typeof scores !== 'object') {
    return { ok: false, error: 'Invalid scores payload.' };
  }
  const ok = writeScoresToDisk(scores);
  return { ok };
});

app.on('ready', createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});


