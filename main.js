const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const http = require('http');

let mainWindow;
let devReloadWatcher = null;
let devReloadSetup = false;
let autoUpdaterListenersAttached = false;

function getAutoUpdater() {
  try {
    return require('electron-updater').autoUpdater;
  } catch (err) {
    console.warn('electron-updater not available:', err && err.message);
    return null;
  }
}

function sendAutoUpdateToRenderer(payload) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    mainWindow.webContents.send('auto-update-event', payload);
  } catch (_) {
    /* ignore */
  }
}

function setupAutoUpdater() {
  if (!app.isPackaged || autoUpdaterListenersAttached) return;
  const autoUpdater = getAutoUpdater();
  if (!autoUpdater) return;
  autoUpdaterListenersAttached = true;

  const feedUrl =
    typeof process.env.FROGGY_UPDATE_URL === 'string' && process.env.FROGGY_UPDATE_URL.trim()
      ? process.env.FROGGY_UPDATE_URL.trim().replace(/\/+$/, '')
      : '';
  if (feedUrl) {
    try {
      autoUpdater.setFeedURL({ provider: 'generic', url: feedUrl });
    } catch (err) {
      console.warn('Auto-update: could not set feed URL:', err);
    }
  }

  autoUpdater.autoDownload = true;

  autoUpdater.on('checking-for-update', () => {
    sendAutoUpdateToRenderer({ phase: 'checking' });
  });
  autoUpdater.on('update-available', (info) => {
    sendAutoUpdateToRenderer({
      phase: 'available',
      version: info && info.version,
      releaseName: info && info.releaseName
    });
  });
  autoUpdater.on('update-not-available', () => {
    sendAutoUpdateToRenderer({ phase: 'not-available' });
  });
  autoUpdater.on('error', (err) => {
    sendAutoUpdateToRenderer({
      phase: 'error',
      message: err && err.message ? err.message : String(err)
    });
  });
  autoUpdater.on('download-progress', (p) => {
    sendAutoUpdateToRenderer({
      phase: 'downloading',
      percent: typeof p.percent === 'number' ? p.percent : undefined,
      transferred: p.transferred,
      total: p.total
    });
  });
  autoUpdater.on('update-downloaded', (info) => {
    sendAutoUpdateToRenderer({
      phase: 'downloaded',
      version: info && info.version
    });
    if (!mainWindow || mainWindow.isDestroyed()) return;
    dialog
      .showMessageBox(mainWindow, {
        type: 'info',
        buttons: ['Restart now', 'Later'],
        defaultId: 0,
        cancelId: 1,
        title: 'Update ready',
        message:
          info && info.version
            ? `Version ${info.version} has been downloaded.`
            : 'A new version has been downloaded.',
        detail: 'Restart Froggy Flash to finish installing the update.'
      })
      .then(({ response }) => {
        if (response === 0) {
          autoUpdater.quitAndInstall(false, true);
        }
      })
      .catch(() => {});
  });

  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      console.warn('Auto-update check failed:', err && err.message ? err.message : err);
      sendAutoUpdateToRenderer({
        phase: 'error',
        message: err && err.message ? err.message : String(err)
      });
    });
  }, 4000);
}

/** In development, reload the window when renderer assets change; relaunch when main changes. */
function setupDevFileReload() {
  if (app.isPackaged || devReloadSetup) return;
  devReloadSetup = true;

  let chokidar;
  try {
    chokidar = require('chokidar');
  } catch (err) {
    console.warn('Dev reload: chokidar not available, skipping file watcher.');
    return;
  }

  const root = __dirname;
  const watched = ['index.html', 'renderer.js', 'preload.js', 'main.js'].map((f) => path.join(root, f));

  const debouncedRendererReload = (() => {
    let timer = null;
    return () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.reloadIgnoringCache();
        }
      }, 120);
    };
  })();

  devReloadWatcher = chokidar.watch(watched, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 }
  });

  devReloadWatcher.on('change', (changedPath) => {
    const base = path.basename(changedPath);
    if (base === 'main.js') {
      if (devReloadWatcher) {
        try {
          const p = devReloadWatcher.close();
          if (p && typeof p.then === 'function') p.catch(() => {});
        } catch (_) {
          /* ignore */
        }
        devReloadWatcher = null;
      }
      app.relaunch();
      app.exit(0);
      return;
    }
    debouncedRendererReload();
  });

  devReloadWatcher.on('error', (err) => {
    console.error('Dev file watcher error:', err);
  });
}

function getBaseDir() {
  const homeDir = os.homedir();
  return path.join(homeDir, 'froggy-flash');
}

function getBundledDecksDir() {
  // Always load decks from the user's home-scoped froggy-flash/deck folder
  // so that bundled and custom decks share a single location.
  return path.join(getBaseDir(), 'decks');
}

function getLlmSettingsFilePath() {
  return path.join(getBaseDir(), 'llm-settings.json');
}

/** Condensed Froggy Flash JSON schema for LLM system prompts (packaged builds omit docs/). */
const FLASHCARD_FORMAT_LLM_INSTRUCTIONS = `You output a single valid JSON object (no markdown fences, no commentary) for a Froggy Flash card set.

Top level:
- name (string, required): human-readable set title.
- description (string, recommended): what the set covers.
- cards (array, required): ordered list of cards.

Each card:
- question (string): GitHub-flavored Markdown is supported in the app; use it for richer prompts when helpful; plain text is fine too.
- choices (object): keys are lowercase letters "a","b","c",... each maps to { "text": string, "explanation"?: string }. choice-level explanation: why wrong for incorrect options.
- answer (string): must exactly equal one key in choices.
- explanation (string): why the correct answer is correct.

Rules: one correct answer per card; keys in choices sorted logically a,b,c; no trailing commas; valid JSON only.`;

function readLlmSettingsFromDisk() {
  const defaults = {
    provider: 'ollama',
    ollamaBaseUrl: 'http://127.0.0.1:11434',
    ollamaModel: 'llama3.2',
    openaiBaseUrl: 'https://api.openai.com',
    openaiModel: 'gpt-4o-mini',
    apiKey: '',
    defaultNumCards: 10
  };
  try {
    const p = getLlmSettingsFilePath();
    if (!fs.existsSync(p)) {
      return defaults;
    }
    const raw = fs.readFileSync(p, 'utf8');
    if (!raw.trim()) return defaults;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return defaults;
    return { ...defaults, ...parsed };
  } catch (err) {
    console.error('Failed to read LLM settings:', err);
    return {
      provider: 'ollama',
      ollamaBaseUrl: 'http://127.0.0.1:11434',
      ollamaModel: 'llama3.2',
      openaiBaseUrl: 'https://api.openai.com',
      openaiModel: 'gpt-4o-mini',
      apiKey: '',
      defaultNumCards: 10
    };
  }
}

function writeLlmSettingsToDisk(partial) {
  try {
    const existing = readLlmSettingsFromDisk();
    const merged = { ...existing, ...(partial && typeof partial === 'object' ? partial : {}) };
    const p = getLlmSettingsFilePath();
    const dir = path.dirname(p);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(p, JSON.stringify(merged, null, 2), 'utf8');
    return { ok: true, settings: merged };
  } catch (err) {
    console.error('Failed to write LLM settings:', err);
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

function resolveDecksDirAbsolute() {
  return path.resolve(getBundledDecksDir());
}

/** Ensures fullPath is inside the decks directory (after resolve). Returns resolved fullPath. */
function assertPathInsideDecksDir(fullPath) {
  if (!fullPath || typeof fullPath !== 'string') {
    throw new Error('Invalid path.');
  }
  const decksDir = resolveDecksDirAbsolute();
  const resolved = path.resolve(fullPath);
  const rel = path.relative(decksDir, resolved);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('Path must stay inside the decks directory.');
  }
  return resolved;
}

function slugifyDeckStem(name) {
  const trimmed = (name && String(name).trim()) || 'deck';
  const base = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return base || 'deck';
}

function ensureUniqueDeckStem(decksDir, baseStem) {
  let stem = baseStem;
  let n = 0;
  const manifestPath = (s) => path.join(decksDir, `${s}.deck.json`);
  const folderPath = (s) => path.join(decksDir, s);
  while (fs.existsSync(manifestPath(stem)) || fs.existsSync(folderPath(stem))) {
    n += 1;
    stem = `${baseStem}-${n}`;
  }
  return stem;
}

function getStemFromDeckManifestPath(manifestPath) {
  const base = path.basename(manifestPath);
  if (!base.toLowerCase().endsWith('.deck.json')) {
    return null;
  }
  return base.replace(/\.deck\.json$/i, '');
}

function getSetsDirectoryForDeckManifest(manifestPath) {
  const decksDir = resolveDecksDirAbsolute();
  const resolvedManifest = assertPathInsideDecksDir(manifestPath);
  const meta = readDeckManifestMeta(resolvedManifest);
  const stem = getStemFromDeckManifestPath(resolvedManifest);
  if (!stem) {
    throw new Error('Not a deck manifest path.');
  }
  const defaultSetsDir = path.join(decksDir, stem);
  if (meta.setsDirOverride) {
    const resolved = resolvePathUnderDecksDir(decksDir, meta.setsDirOverride);
    if (resolved) {
      return resolved;
    }
  }
  return defaultSetsDir;
}

function validateFlashcardSetShape(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('JSON must be an object.');
  }
  if (!data.name || typeof data.name !== 'string') {
    throw new Error('Set must include a string "name".');
  }
  if (data.description != null && typeof data.description !== 'string') {
    throw new Error('"description" must be a string if present.');
  }
  if (!Array.isArray(data.cards)) {
    throw new Error('Set must include a "cards" array.');
  }
  data.cards.forEach((card, i) => {
    if (!card || typeof card !== 'object') {
      throw new Error(`Card ${i + 1} is invalid.`);
    }
    if (!card.question || typeof card.question !== 'string') {
      throw new Error(`Card ${i + 1} needs a string "question".`);
    }
    if (!card.choices || typeof card.choices !== 'object') {
      throw new Error(`Card ${i + 1} needs a "choices" object.`);
    }
    const keys = Object.keys(card.choices);
    if (!keys.length) {
      throw new Error(`Card ${i + 1} has empty choices.`);
    }
    if (!card.answer || typeof card.answer !== 'string' || !card.choices[card.answer]) {
      throw new Error(`Card ${i + 1}: "answer" must match a key in choices.`);
    }
    if (typeof card.explanation !== 'string') {
      throw new Error(`Card ${i + 1} needs a string "explanation".`);
    }
    keys.forEach((k) => {
      const ch = card.choices[k];
      if (!ch || typeof ch !== 'object' || typeof ch.text !== 'string') {
        throw new Error(`Card ${i + 1} choice "${k}" needs a "text" string.`);
      }
    });
  });
  return true;
}

function stripCodeFences(text) {
  if (!text || typeof text !== 'string') return text;
  let t = text.trim();
  const fence = /^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/im;
  const m = t.match(fence);
  if (m) {
    return m[1].trim();
  }
  return t;
}

function extractJsonObjectString(text) {
  const cleaned = stripCodeFences(text);
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('No JSON object found in model output.');
  }
  return cleaned.slice(start, end + 1);
}

function parseFlashcardSetFromLlmOutput(text) {
  const jsonStr = extractJsonObjectString(text);
  const data = JSON.parse(jsonStr);
  validateFlashcardSetShape(data);
  return data;
}

function fetchUrlJson(urlString, options) {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(urlString);
    } catch (e) {
      reject(new Error('Invalid URL: ' + urlString));
      return;
    }
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(
      u,
      {
        method: options.method || 'GET',
        headers: options.headers || {}
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 500)}`));
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch (err) {
            reject(new Error('Invalid JSON in response: ' + (err && err.message)));
          }
        });
      }
    );
    req.on('error', reject);
    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
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

  // Hide the native menu bar; the app uses in-window controls (e.g. Settings).
  mainWindow.setMenuBarVisibility(false);
  mainWindow.setMenu(null);

  if (previousState && previousState.isMaximized) {
    mainWindow.maximize();
  }

  mainWindow.loadFile('index.html');

  setupDevFileReload();

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

/** Resolve a path under decksDir; rejects ".." segments and absolute paths. */
function resolvePathUnderDecksDir(decksDir, relativePath) {
  if (!relativePath || typeof relativePath !== 'string') {
    return null;
  }
  const trimmed = relativePath.trim();
  if (!trimmed || trimmed.includes('..')) {
    return null;
  }
  if (path.isAbsolute(trimmed)) {
    return null;
  }
  const resolved = path.resolve(decksDir, trimmed);
  const baseResolved = path.resolve(decksDir);
  const rel = path.relative(baseResolved, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return null;
  }
  return resolved;
}

function readDeckManifestMeta(deckJsonPath) {
  const raw = fs.readFileSync(deckJsonPath, 'utf8');
  const data = JSON.parse(raw);
  if (!data || typeof data !== 'object') {
    throw new Error('Deck manifest must be a JSON object.');
  }
  if (!data.name || typeof data.name !== 'string') {
    throw new Error('Deck manifest must include a string "name".');
  }
  let setsDirOverride = null;
  if (data.setsDir && typeof data.setsDir === 'string') {
    setsDirOverride = data.setsDir;
  } else if (data.setsDirectory && typeof data.setsDirectory === 'string') {
    setsDirOverride = data.setsDirectory;
  }
  return { name: String(data.name), setsDirOverride };
}

function listCardSetSummariesInDir(setsDir) {
  if (!fs.existsSync(setsDir)) {
    return [];
  }
  const stat = fs.statSync(setsDir);
  if (!stat.isDirectory()) {
    return [];
  }

  const files = fs
    .readdirSync(setsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.json'));

  const sets = files.map((entry) => {
    const fullPath = path.join(setsDir, entry.name);
    let displayName = entry.name.replace(/\.json$/i, '');
    try {
      const raw = fs.readFileSync(fullPath, 'utf8');
      const data = JSON.parse(raw);
      if (data && typeof data === 'object' && data.name) {
        displayName = String(data.name);
      }
    } catch {
      // Fall back to filename-based label.
    }
    return {
      id: fullPath,
      name: displayName,
      fileName: entry.name
    };
  });

  sets.sort((a, b) => a.name.localeCompare(b.name));
  return sets;
}

ipcMain.handle('list-decks', async () => {
  try {
    const decksDir = getBundledDecksDir();
    if (!fs.existsSync(decksDir)) {
      return [];
    }

    const dirEntries = fs.readdirSync(decksDir, { withFileTypes: true });
    const decks = [];

    for (const entry of dirEntries) {
      if (!entry.isFile()) continue;
      const lower = entry.name.toLowerCase();
      if (!lower.endsWith('.deck.json')) continue;

      const deckPath = path.join(decksDir, entry.name);
      const stem = entry.name.replace(/\.deck\.json$/i, '');
      let deckName = stem;
      let setsDirOverride = null;

      try {
        const meta = readDeckManifestMeta(deckPath);
        deckName = meta.name;
        setsDirOverride = meta.setsDirOverride;
      } catch (err) {
        console.error('Failed to read deck manifest:', deckPath, err);
      }

      const defaultSetsDir = path.join(decksDir, stem);
      let setsDir = defaultSetsDir;
      if (setsDirOverride) {
        const resolved = resolvePathUnderDecksDir(decksDir, setsDirOverride);
        if (resolved) {
          setsDir = resolved;
        }
      }

      const sets = listCardSetSummariesInDir(setsDir);

      decks.push({
        id: deckPath,
        name: deckName,
        fileName: entry.name,
        sets
      });
    }

    // Legacy: standalone flashcard JSON in the decks folder (not a deck manifest).
    for (const entry of dirEntries) {
      if (!entry.isFile()) continue;
      const lower = entry.name.toLowerCase();
      if (!lower.endsWith('.json')) continue;
      if (lower.endsWith('.deck.json')) continue;

      const fullPath = path.join(decksDir, entry.name);
      let name = entry.name.replace(/\.json$/i, '');
      try {
        const raw = fs.readFileSync(fullPath, 'utf8');
        const data = JSON.parse(raw);
        if (data && typeof data === 'object' && data.name) {
          name = String(data.name);
        }
      } catch {
        // Filename-based name.
      }

      decks.push({
        id: fullPath,
        name,
        fileName: entry.name,
        sets: null
      });
    }

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

ipcMain.handle('update-get-info', () => ({
  version: app.getVersion(),
  name: app.getName(),
  isPackaged: app.isPackaged
}));

ipcMain.handle('update-check', async () => {
  if (!app.isPackaged) {
    return { ok: false, skipped: true, reason: 'not-packaged' };
  }
  const autoUpdater = getAutoUpdater();
  if (!autoUpdater) {
    return { ok: false, error: 'Updater unavailable.' };
  }
  try {
    const result = await autoUpdater.checkForUpdates();
    return {
      ok: true,
      updateInfo: result && result.updateInfo ? result.updateInfo : null
    };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
});

ipcMain.handle('update-quit-and-install', () => {
  if (!app.isPackaged) return { ok: false };
  const autoUpdater = getAutoUpdater();
  if (!autoUpdater) return { ok: false };
  try {
    autoUpdater.quitAndInstall(false, true);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
});

ipcMain.handle('load-llm-settings', () => {
  return readLlmSettingsFromDisk();
});

ipcMain.handle('save-llm-settings', (_event, partial) => {
  return writeLlmSettingsToDisk(partial);
});

ipcMain.handle('pick-json-files', async () => {
  const decksDir = getBundledDecksDir();
  try {
    if (!fs.existsSync(decksDir)) {
      fs.mkdirSync(decksDir, { recursive: true });
    }
  } catch (err) {
    console.error(err);
  }
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select flashcard JSON files',
    defaultPath: decksDir,
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });
  if (result.canceled || !result.filePaths || !result.filePaths.length) {
    return { canceled: true, filePaths: [] };
  }
  return { canceled: false, filePaths: result.filePaths };
});

ipcMain.handle('create-deck', async (_event, payload) => {
  try {
    const name = payload && payload.name ? String(payload.name).trim() : '';
    if (!name) {
      return { ok: false, error: 'Deck name is required.' };
    }
    const decksDir = resolveDecksDirAbsolute();
    if (!fs.existsSync(decksDir)) {
      fs.mkdirSync(decksDir, { recursive: true });
    }
    const baseStem = slugifyDeckStem(name);
    const stem = ensureUniqueDeckStem(decksDir, baseStem);
    const manifestPath = path.join(decksDir, `${stem}.deck.json`);
    const setsDir = path.join(decksDir, stem);
    fs.mkdirSync(setsDir, { recursive: true });
    const manifest = { name };
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
    return { ok: true, deckManifestPath: manifestPath, stem, name };
  } catch (err) {
    console.error('create-deck:', err);
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
});

ipcMain.handle('rename-deck', async (_event, payload) => {
  try {
    const manifestPath = payload && payload.deckManifestPath;
    const newName = payload && payload.newName != null ? String(payload.newName).trim() : '';
    if (!manifestPath || !newName) {
      return { ok: false, error: 'Deck path and new name are required.' };
    }
    const resolved = assertPathInsideDecksDir(manifestPath);
    if (!resolved.toLowerCase().endsWith('.deck.json')) {
      return { ok: false, error: 'Only deck manifests can be renamed this way.' };
    }
    const raw = fs.readFileSync(resolved, 'utf8');
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') {
      throw new Error('Invalid manifest.');
    }
    data.name = newName;
    fs.writeFileSync(resolved, JSON.stringify(data, null, 2), 'utf8');
    return { ok: true };
  } catch (err) {
    console.error('rename-deck:', err);
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
});

ipcMain.handle('delete-deck', async (_event, payload) => {
  try {
    const targetPath = payload && payload.deckManifestPath;
    if (!targetPath || typeof targetPath !== 'string') {
      return { ok: false, error: 'No deck path provided.' };
    }
    const resolved = assertPathInsideDecksDir(targetPath);
    const lower = resolved.toLowerCase();

    if (lower.endsWith('.deck.json')) {
      const stem = getStemFromDeckManifestPath(resolved);
      if (!stem) {
        return { ok: false, error: 'Invalid deck manifest file.' };
      }
      const setsDir = path.join(resolveDecksDirAbsolute(), stem);
      if (fs.existsSync(resolved)) {
        fs.unlinkSync(resolved);
      }
      if (fs.existsSync(setsDir)) {
        const st = fs.statSync(setsDir);
        if (st.isDirectory()) {
          fs.rmSync(setsDir, { recursive: true, force: true });
        }
      }
      return { ok: true };
    }

    if (lower.endsWith('.json')) {
      fs.unlinkSync(resolved);
      return { ok: true };
    }

    return { ok: false, error: 'Unsupported deck path for deletion.' };
  } catch (err) {
    console.error('delete-deck:', err);
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
});

ipcMain.handle('import-deck-sets', async (_event, payload) => {
  try {
    const manifestPath = payload && payload.deckManifestPath;
    const filePaths = payload && Array.isArray(payload.filePaths) ? payload.filePaths : [];
    const replaceExisting = !!(payload && payload.replaceExisting);
    if (!manifestPath || !filePaths.length) {
      return { ok: false, error: 'Deck manifest and at least one source file are required.' };
    }
    const setsDir = getSetsDirectoryForDeckManifest(manifestPath);
    assertPathInsideDecksDir(setsDir);
    if (!fs.existsSync(setsDir)) {
      fs.mkdirSync(setsDir, { recursive: true });
    }

    if (replaceExisting) {
      const entries = fs.readdirSync(setsDir, { withFileTypes: true });
      entries.forEach((e) => {
        if (e.isFile() && e.name.toLowerCase().endsWith('.json')) {
          fs.unlinkSync(path.join(setsDir, e.name));
        }
      });
    }

    const copied = [];
    for (const src of filePaths) {
      if (!src || typeof src !== 'string') continue;
      const absSrc = path.resolve(src);
      if (!fs.existsSync(absSrc) || !fs.statSync(absSrc).isFile()) {
        continue;
      }
      let base = path.basename(absSrc);
      if (!base.toLowerCase().endsWith('.json')) {
        base += '.json';
      }
      let dest = path.join(setsDir, base);
      let n = 0;
      while (fs.existsSync(dest)) {
        n += 1;
        const ext = path.extname(base);
        const stem = path.basename(base, ext);
        dest = path.join(setsDir, `${stem}-${n}${ext || '.json'}`);
      }
      fs.copyFileSync(absSrc, dest);
      copied.push(dest);
    }

    if (!copied.length) {
      return { ok: false, error: 'No files were copied. Check that sources exist and are files.' };
    }
    return { ok: true, copiedPaths: copied };
  } catch (err) {
    console.error('import-deck-sets:', err);
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
});

ipcMain.handle('read-card-set-file', async (_event, filePath) => {
  try {
    if (!filePath || typeof filePath !== 'string') {
      return { ok: false, error: 'No path provided.' };
    }
    const resolved = assertPathInsideDecksDir(filePath);
    if (!resolved.toLowerCase().endsWith('.json')) {
      return { ok: false, error: 'Not a JSON file.' };
    }
    if (resolved.toLowerCase().endsWith('.deck.json')) {
      return { ok: false, error: 'Cannot edit deck manifest as a card set.' };
    }
    const raw = fs.readFileSync(resolved, 'utf8');
    return { ok: true, content: raw, filePath: resolved };
  } catch (err) {
    console.error('read-card-set-file:', err);
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
});

ipcMain.handle('write-card-set-file', async (_event, payload) => {
  try {
    const filePath = payload && payload.filePath;
    const content = payload && payload.content != null ? String(payload.content) : '';
    if (!filePath) {
      return { ok: false, error: 'No path provided.' };
    }
    const resolved = assertPathInsideDecksDir(filePath);
    if (!resolved.toLowerCase().endsWith('.json') || resolved.toLowerCase().endsWith('.deck.json')) {
      return { ok: false, error: 'Invalid card set path.' };
    }
    const data = JSON.parse(content);
    validateFlashcardSetShape(data);
    fs.writeFileSync(resolved, JSON.stringify(data, null, 2), 'utf8');
    return { ok: true, filePath: resolved };
  } catch (err) {
    console.error('write-card-set-file:', err);
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
});

ipcMain.handle('delete-card-set-file', async (_event, filePath) => {
  try {
    if (!filePath || typeof filePath !== 'string') {
      return { ok: false, error: 'No path provided.' };
    }
    const resolved = assertPathInsideDecksDir(filePath);
    if (!resolved.toLowerCase().endsWith('.json') || resolved.toLowerCase().endsWith('.deck.json')) {
      return { ok: false, error: 'Invalid card set path.' };
    }
    if (!fs.existsSync(resolved)) {
      return { ok: false, error: 'File does not exist.' };
    }
    fs.unlinkSync(resolved);
    return { ok: true };
  } catch (err) {
    console.error('delete-card-set-file:', err);
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
});

ipcMain.handle('generate-card-set-via-llm', async (_event, payload) => {
  try {
    const topic = payload && payload.topic ? String(payload.topic).trim() : '';
    const deckManifestPath = payload && payload.deckManifestPath;
    if (!topic) {
      return { ok: false, error: 'Topic is required.' };
    }
    if (!deckManifestPath) {
      return { ok: false, error: 'Deck manifest path is required.' };
    }

    const setsDir = getSetsDirectoryForDeckManifest(deckManifestPath);
    assertPathInsideDecksDir(setsDir);
    if (!fs.existsSync(setsDir)) {
      fs.mkdirSync(setsDir, { recursive: true });
    }

    const settings = readLlmSettingsFromDisk();
    const numCardsRaw = payload && payload.numCards != null ? Number(payload.numCards) : NaN;
    let numCards = Number.isFinite(numCardsRaw) ? Math.round(numCardsRaw) : settings.defaultNumCards;
    if (!Number.isFinite(numCards) || numCards < 1) numCards = 10;
    if (numCards > 50) numCards = 50;

    const provider = settings.provider === 'openai' ? 'openai' : 'ollama';
    const userMessage = `Create a flashcard set for the following topic. Be accurate and educational.\n\nTopic (use all detail below):\n${topic}\n\nProduce exactly ${numCards} cards in the cards array.`;

    const systemMessage = `${FLASHCARD_FORMAT_LLM_INSTRUCTIONS}\n\nOutput only the JSON object.`;

    let assistantText = '';

    if (provider === 'ollama') {
      const base = (settings.ollamaBaseUrl || 'http://127.0.0.1:11434').replace(/\/+$/, '');
      const model = settings.ollamaModel || 'llama3.2';
      const url = `${base}/api/chat`;
      const bodyObj = {
        model,
        stream: false,
        messages: [
          { role: 'system', content: systemMessage },
          { role: 'user', content: userMessage }
        ]
      };
      const parsed = await fetchUrlJson(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyObj)
      });
      assistantText =
        (parsed &&
          parsed.message &&
          typeof parsed.message.content === 'string' &&
          parsed.message.content) ||
        '';
      if (!assistantText && typeof parsed.response === 'string') {
        assistantText = parsed.response;
      }
    } else {
      const base = (settings.openaiBaseUrl || 'https://api.openai.com').replace(/\/+$/, '');
      const model = settings.openaiModel || 'gpt-4o-mini';
      const apiKey = settings.apiKey ? String(settings.apiKey) : '';
      if (!apiKey) {
        return { ok: false, error: 'OpenAI API key is not set. Add it in Settings.' };
      }
      const url = `${base}/v1/chat/completions`;
      const bodyObj = {
        model,
        messages: [
          { role: 'system', content: systemMessage },
          { role: 'user', content: userMessage }
        ],
        temperature: 0.4
      };
      const parsed = await fetchUrlJson(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify(bodyObj)
      });
      const choice = parsed && parsed.choices && parsed.choices[0];
      assistantText =
        choice && choice.message && typeof choice.message.content === 'string'
          ? choice.message.content
          : '';
    }

    if (!assistantText) {
      return { ok: false, error: 'Model returned an empty response.' };
    }

    const setData = parseFlashcardSetFromLlmOutput(assistantText);
    if (setData.cards && setData.cards.length > numCards) {
      setData.cards = setData.cards.slice(0, numCards);
    }

    let baseName =
      payload && payload.outputBaseName
        ? String(payload.outputBaseName).trim().replace(/[\\/]/g, '')
        : '';
    if (!baseName) {
      const slug = slugifyDeckStem(setData.name || 'generated');
      baseName = `${slug || 'generated'}-${Date.now()}`;
    }
    if (!baseName.toLowerCase().endsWith('.json')) {
      baseName += '.json';
    }

    let outPath = path.join(setsDir, baseName);
    let n = 0;
    while (fs.existsSync(outPath)) {
      n += 1;
      const ext = path.extname(baseName);
      const stem = path.basename(baseName, ext);
      outPath = path.join(setsDir, `${stem}-${n}${ext || '.json'}`);
    }

    fs.writeFileSync(outPath, JSON.stringify(setData, null, 2), 'utf8');
    return { ok: true, filePath: outPath, set: setData };
  } catch (err) {
    console.error('generate-card-set-via-llm:', err);
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
});

app.on('will-quit', () => {
  if (devReloadWatcher) {
    try {
      const p = devReloadWatcher.close();
      if (p && typeof p.then === 'function') p.catch(() => {});
    } catch (_) {
      /* ignore */
    }
    devReloadWatcher = null;
  }
});

app.on('ready', () => {
  createWindow();
  setupAutoUpdater();
});

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


