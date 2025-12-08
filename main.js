const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

let mainWindow;

function getBaseDir() {
  const homeDir = os.homedir();
  return path.join(homeDir, 'froggy-flash');
}

function getWindowStateFilePath() {
  const baseDir = getBaseDir();
  return path.join(baseDir, 'window-state.json');
}

function readWindowStateFromDisk() {
  try {
    const statePath = getWindowStateFilePath();
    if (!fs.existsSync(statePath)) {
      return null;
    }
    const raw = fs.readFileSync(statePath, 'utf8');
    if (!raw.trim()) {
      return null;
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    return parsed;
  } catch (err) {
    console.error('Failed to read window state from disk:', err);
    return null;
  }
}

function writeWindowStateToDisk(state) {
  try {
    const statePath = getWindowStateFilePath();
    const dir = path.dirname(statePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to write window state to disk:', err);
  }
}

function saveCurrentWindowState() {
  if (!mainWindow) return;
  const isMaximized = mainWindow.isMaximized();
  const bounds = isMaximized ? mainWindow.getNormalBounds() : mainWindow.getBounds();

  const state = {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    isMaximized
  };

  writeWindowStateToDisk(state);
}

function getSessionHistoryFilePath() {
  return path.join(getBaseDir(), 'sessions.json');
}

function readSessionHistoryFromDisk() {
  try {
    const historyPath = getSessionHistoryFilePath();
    if (!fs.existsSync(historyPath)) {
      return [];
    }
    const raw = fs.readFileSync(historyPath, 'utf8');
    if (!raw.trim()) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed;
  } catch (err) {
    console.error('Failed to read session history from disk:', err);
    return [];
  }
}

function appendSessionHistoryEntry(entry) {
  try {
    if (!entry || typeof entry !== 'object') {
      throw new Error('Invalid session entry payload.');
    }

    const historyPath = getSessionHistoryFilePath();
    const dir = path.dirname(historyPath);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    let history = [];
    if (fs.existsSync(historyPath)) {
      const raw = fs.readFileSync(historyPath, 'utf8');
      if (raw.trim()) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          history = parsed;
        }
      }
    }

    history.push(entry);
    fs.writeFileSync(historyPath, JSON.stringify(history, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('Failed to append session history entry:', err);
    return false;
  }
}

function createWindow() {
  const previousState = readWindowStateFromDisk();

  const browserWindowOptions = {
    width: 1100,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  };

  if (
    previousState &&
    typeof previousState.width === 'number' &&
    typeof previousState.height === 'number'
  ) {
    browserWindowOptions.width = previousState.width;
    browserWindowOptions.height = previousState.height;

    if (
      typeof previousState.x === 'number' &&
      typeof previousState.y === 'number'
    ) {
      browserWindowOptions.x = previousState.x;
      browserWindowOptions.y = previousState.y;
    }
  }

  mainWindow = new BrowserWindow(browserWindowOptions);

  if (previousState && previousState.isMaximized) {
    mainWindow.maximize();
  }

  mainWindow.loadFile('index.html');

  mainWindow.on('close', () => {
    saveCurrentWindowState();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function getScoresFilePath() {
  const baseDir = getBaseDir();
  return path.join(baseDir, 'scores.json');
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
  const decksDir = path.join(getBaseDir(), 'decks');

  // Ensure the decks directory exists so the dialog opens there.
  try {
    if (!fs.existsSync(decksDir)) {
      fs.mkdirSync(decksDir, { recursive: true });
    }
  } catch (err) {
    console.error('Failed to ensure decks directory exists:', err);
  }

  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Open Flashcard Set JSON',
    defaultPath: decksDir,
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

ipcMain.handle('load-session-history', () => {
  return readSessionHistoryFromDisk();
});

ipcMain.handle('append-session-history', (_event, entry) => {
  const ok = appendSessionHistoryEntry(entry);
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


