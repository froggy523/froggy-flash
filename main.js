const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

let mainWindow;

function getBaseDir() {
  const homeDir = os.homedir();
  return path.join(homeDir, 'froggy-flash');
}

function getBundledDecksDir() {
  // Always load decks from the user's home-scoped froggy-flash/deck folder
  // so that bundled and custom decks share a single location.
  return path.join(getBaseDir(), 'decks');
}

function getUiConfigFilePath() {
  const baseDir = getBaseDir();
  return path.join(baseDir, 'ui.json');
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

function readUiConfigFromDisk() {
  try {
    const uiPath = getUiConfigFilePath();
    if (!fs.existsSync(uiPath)) {
      return {};
    }
    const raw = fs.readFileSync(uiPath, 'utf8');
    if (!raw.trim()) {
      return {};
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return {};
    }
    return parsed;
  } catch (err) {
    console.error('Failed to read UI config from disk:', err);
    return {};
  }
}

function writeUiConfigToDisk(partialConfig) {
  try {
    if (!partialConfig || typeof partialConfig !== 'object') {
      throw new Error('Invalid UI config payload.');
    }

    const uiPath = getUiConfigFilePath();
    const dir = path.dirname(uiPath);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const existing = readUiConfigFromDisk();
    const merged = Object.assign({}, existing, partialConfig);

    fs.writeFileSync(uiPath, JSON.stringify(merged, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('Failed to write UI config to disk:', err);
    return false;
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
    icon: path.join(__dirname, 'images', 'Cards x32.png'),
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

  // Hide the native menu bar; we'll render our own in the renderer process.
  mainWindow.setMenuBarVisibility(false);
  mainWindow.setMenu(null);

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

function normalizeScoresShape(rawValue) {
  // New structured format: { bySet: { [setName]: stats }, byDeck: { [deckKey]: stats } }
  if (rawValue && typeof rawValue === 'object' && (rawValue.bySet || rawValue.byDeck)) {
    const bySet =
      rawValue.bySet && typeof rawValue.bySet === 'object' && rawValue.bySet !== null
        ? rawValue.bySet
        : {};
    const byDeck =
      rawValue.byDeck && typeof rawValue.byDeck === 'object' && rawValue.byDeck !== null
        ? rawValue.byDeck
        : {};
    return { bySet, byDeck };
  }

  // Legacy flat object shape: treat as bySet only.
  if (rawValue && typeof rawValue === 'object') {
    return { bySet: rawValue, byDeck: {} };
  }

  return { bySet: {}, byDeck: {} };
}

function readScoresFromDisk() {
  try {
    const scoresPath = getScoresFilePath();
    if (!fs.existsSync(scoresPath)) {
      return { bySet: {}, byDeck: {} };
    }
    const raw = fs.readFileSync(scoresPath, 'utf8');
    if (!raw.trim()) {
      return { bySet: {}, byDeck: {} };
    }
    const parsed = JSON.parse(raw);
    return normalizeScoresShape(parsed);
  } catch (err) {
    console.error('Failed to read scores from disk:', err);
    return { bySet: {}, byDeck: {} };
  }
}

function writeScoresToDisk(scoresPayload) {
  try {
    const scoresPath = getScoresFilePath();
    const dir = path.dirname(scoresPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const normalized = normalizeScoresShape(scoresPayload || {});
    fs.writeFileSync(scoresPath, JSON.stringify(normalized, null, 2), 'utf8');
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

function loadDeckFromFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const data = JSON.parse(raw);

  // Basic shape validation
  if (!data || typeof data !== 'object') {
    throw new Error('JSON must be an object.');
  }
  if (!data.name || !Array.isArray(data.cards)) {
    throw new Error('JSON must include "name" and \"cards\" array.');
  }

  return {
    filePath,
    set: data
  };
}

ipcMain.handle('list-decks', async () => {
  try {
    const decksDir = getBundledDecksDir();
    if (!fs.existsSync(decksDir)) {
      return [];
    }

    const files = fs
      .readdirSync(decksDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.json'));

    const decks = files.map((entry) => {
      const fullPath = path.join(decksDir, entry.name);
      let name = entry.name.replace(/\.json$/i, '');
      try {
        const raw = fs.readFileSync(fullPath, 'utf8');
        const data = JSON.parse(raw);
        if (data && typeof data === 'object' && data.name) {
          name = String(data.name);
        }
      } catch {
        // If a single deck fails to parse, just fall back to filename-based name.
      }

      return {
        id: fullPath,
        name,
        fileName: entry.name
      };
    });

    // Sort alphabetically by display name for a stable, easy-to-scan list.
    decks.sort((a, b) => a.name.localeCompare(b.name));
    return decks;
  } catch (err) {
    console.error('Failed to list decks:', err);
    return [];
  }
});

ipcMain.handle('load-deck-by-path', async (_event, filePath) => {
  if (!filePath || typeof filePath !== 'string') {
    return { canceled: true, error: 'No deck path provided.' };
  }

  try {
    const { set } = loadDeckFromFile(filePath);
    return {
      canceled: false,
      filePath,
      set
    };
  } catch (err) {
    console.error('Failed to load deck by path:', err);
    dialog.showErrorBox('Invalid Deck File', err && err.message ? err.message : String(err));
    return { canceled: true, error: err && err.message ? err.message : String(err) };
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

ipcMain.handle('load-ui-config', () => {
  return readUiConfigFromDisk();
});

ipcMain.handle('save-ui-config', (_event, uiConfig) => {
  if (!uiConfig || typeof uiConfig !== 'object') {
    return { ok: false, error: 'Invalid UI config payload.' };
  }
  const ok = writeUiConfigToDisk(uiConfig);
  return { ok };
});

ipcMain.handle('export-graph-data', async () => {
  try {
    const scores = readScoresFromDisk();
    const sessions = readSessionHistoryFromDisk();

    const defaultPath = path.join(
      getBaseDir(),
      `froggy-flash-graph-data-${new Date().toISOString().slice(0, 10)}.json`
    );

    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Export scores and sessions for graphing',
      defaultPath,
      filters: [{ name: 'JSON Files', extensions: ['json'] }]
    });

    if (result.canceled || !result.filePath) {
      return { canceled: true };
    }

    const payload = {
      exportedAt: new Date().toISOString(),
      scores,
      sessions
    };

    fs.writeFileSync(result.filePath, JSON.stringify(payload, null, 2), 'utf8');
    return { ok: true, filePath: result.filePath };
  } catch (err) {
    console.error('Failed to export graph data:', err);
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
});

// Allow the renderer to request that the application exit.
ipcMain.handle('app-exit', () => {
  if (mainWindow) {
    // Trigger the normal close flow so window state is persisted.
    mainWindow.close();
  } else {
    app.quit();
  }
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


