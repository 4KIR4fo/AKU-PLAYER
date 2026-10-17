const { app, BrowserWindow, ipcMain, dialog, protocol, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const { Readable } = require('stream');
const crypto = require('crypto');

const AUDIO_EXTS = new Set(['.mp3', '.m4a', '.aac', '.ogg', '.oga', '.opus', '.wav', '.flac']);

const MIME_TYPES = {
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac'
};

const coverCache = new Map();
let mainWindow = null;
let miniWindow = null;
let lastPlayerState = null;

app.setName('aku-player');

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'media',
    privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true }
  }
]);

function configPath() {
  return path.join(app.getPath('userData'), 'config.json');
}

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(configPath(), 'utf8'));
  } catch {
    return {};
  }
}

function saveConfig(config) {
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(config, null, 2));
}

const ITUNES_BASE = 'https://itunes.apple.com/search';
const ITUNES_MIN_INTERVAL = 1000;
let itunesLastRequest = 0;

function genreCachePath() {
  return path.join(app.getPath('userData'), 'genre-cache.json');
}

let genreCache = null;

function loadGenreCache() {
  if (genreCache) return genreCache;
  try {
    const parsed = JSON.parse(fs.readFileSync(genreCachePath(), 'utf8'));
    genreCache = parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    genreCache = {};
  }
  return genreCache;
}

function saveGenreCache() {
  try {
    fs.mkdirSync(path.dirname(genreCachePath()), { recursive: true });
    fs.writeFileSync(genreCachePath(), JSON.stringify(genreCache));
  } catch {
    // cache write failures are non-fatal
  }
}

function normalizeText(text) {
  return String(text || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function normKey(artist, title) {
  return `${normalizeText(artist)}|${normalizeText(title)}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function itunesFetch(url) {
  const wait = ITUNES_MIN_INTERVAL - (Date.now() - itunesLastRequest);
  if (wait > 0) await sleep(wait);
  itunesLastRequest = Date.now();
  return fetch(url, { headers: { Accept: 'application/json' } });
}

function sharesToken(a, b) {
  const setB = new Set(normalizeText(b).split(' ').filter(Boolean));
  return normalizeText(a).split(' ').some((token) => token && setB.has(token));
}

async function lookupGenre(artist, title) {
  const term = `${artist} ${title}`;
  const res = await itunesFetch(`${ITUNES_BASE}?term=${encodeURIComponent(term)}&entity=song&limit=5`);
  if (!res.ok) return [];
  const data = await res.json();
  const results = Array.isArray(data.results) ? data.results : [];
  let best = results.find((r) => r.primaryGenreName && sharesToken(r.artistName, artist));
  if (!best) best = results.find((r) => r.primaryGenreName);
  if (!best) return [];
  return tidyGenres([best.primaryGenreName]);
}

let categorizing = false;
let categorizeCancelled = false;

ipcMain.handle('categorize', async (event, items) => {
  if (categorizing) return { cancelled: true, results: [] };
  categorizing = true;
  categorizeCancelled = false;
  const list = Array.isArray(items) ? items : [];
  const cache = loadGenreCache();
  const results = [];
  try {
    for (let i = 0; i < list.length; i++) {
      if (categorizeCancelled) break;
      const item = list[i] || {};
      const artist = item.artist || '';
      const title = item.title || '';
      const key = normKey(artist, title);
      let genres;
      if (key && cache[key] && Array.isArray(cache[key].genres)) {
        genres = cache[key].genres;
      } else if (artist && title) {
        try {
          genres = await lookupGenre(artist, title);
        } catch {
          genres = [];
        }
        cache[key] = { genres, source: 'itunes', ts: Date.now() };
        saveGenreCache();
      } else {
        genres = [];
      }
      if (genres && genres.length) results.push({ id: item.id, genres });
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('categorize-progress', {
          done: i + 1, total: list.length, current: title
        });
      }
    }
  } finally {
    categorizing = false;
  }
  return { cancelled: categorizeCancelled, results };
});

ipcMain.on('categorize-cancel', () => {
  categorizeCancelled = true;
});

function trackId(filePath) {
  return crypto.createHash('sha1').update(filePath).digest('hex').slice(0, 16);
}

function tidyGenres(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    const genre = typeof raw === 'string' ? raw.trim() : '';
    if (!genre || /^\d+$/.test(genre)) continue;
    const key = genre.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(genre);
  }
  return out;
}

function cleanGenres(list) {
  if (!Array.isArray(list)) return [];
  const parts = [];
  for (const raw of list) {
    if (typeof raw !== 'string') continue;
    parts.push(...raw.split(/[;,/]/));
  }
  return tidyGenres(parts);
}

function streamUrl(filePath) {
  return `media://stream/${encodeURIComponent(filePath)}`;
}

async function walkAudioFiles(root) {
  const files = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile() && AUDIO_EXTS.has(path.extname(entry.name).toLowerCase())) {
        files.push(full);
      }
    }
  }
  files.sort((a, b) => a.localeCompare(b));
  return files;
}

async function readTrackTags(filePath) {
  const id = trackId(filePath);
  const fallback = {
    id,
    title: path.basename(filePath, path.extname(filePath)),
    artist: 'Unknown artist',
    album: 'Unknown album',
    duration: 0,
    src: streamUrl(filePath),
    cover: null,
    quality: null,
    genre: [],
    year: null
  };
  try {
    const mm = await import('music-metadata');
    const meta = await mm.parseFile(filePath, { duration: true });
    const common = meta.common || {};
    const format = meta.format || {};
    const picture = common.picture && common.picture[0];
    let cover = null;
    if (picture && picture.data) {
      coverCache.set(id, { data: Buffer.from(picture.data), mime: picture.format || 'image/jpeg' });
      cover = `media://cover/${id}`;
    }
    const title = common.title || fallback.title;
    const artist = common.artist || (common.artists && common.artists.join(', ')) || fallback.artist;
    let genre = cleanGenres(common.genre);
    if (!genre.length) {
      const cached = loadGenreCache()[normKey(artist, title)];
      if (cached && Array.isArray(cached.genres)) genre = cached.genres;
    }
    let year = Number.isFinite(common.year) ? common.year : null;
    if (year === null && typeof common.date === 'string') {
      const parsed = parseInt(common.date, 10);
      if (Number.isFinite(parsed)) year = parsed;
    }
    return {
      id,
      title,
      artist,
      album: common.album || fallback.album,
      duration: format.duration ? Math.round(format.duration) : 0,
      src: streamUrl(filePath),
      cover,
      genre,
      year,
      quality: {
        container: format.container || null,
        codec: format.codec || null,
        bitrate: format.bitrate || null,
        sampleRate: format.sampleRate || null,
        bitsPerSample: format.bitsPerSample || null,
        channels: format.numberOfChannels || null,
        lossless: format.lossless === true
      }
    };
  } catch {
    return fallback;
  }
}

async function scanLibrary(root) {
  coverCache.clear();
  const files = await walkAudioFiles(root);
  const tracks = [];
  for (let i = 0; i < files.length; i++) {
    tracks.push(await readTrackTags(files[i]));
    if (mainWindow && !mainWindow.isDestroyed() && (i % 5 === 0 || i === files.length - 1)) {
      mainWindow.webContents.send('scan-progress', { done: i + 1, total: files.length });
    }
  }
  return tracks;
}

function parseRange(rangeHeader, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader || '');
  if (!match) return null;
  const [, startStr, endStr] = match;
  if (startStr === '' && endStr === '') return null;
  let start;
  let end;
  if (startStr === '') {
    const suffix = parseInt(endStr, 10);
    if (!Number.isFinite(suffix)) return null;
    start = Math.max(size - suffix, 0);
    end = size - 1;
  } else {
    start = parseInt(startStr, 10);
    end = endStr === '' ? size - 1 : parseInt(endStr, 10);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) return null;
  return { start, end: Math.min(end, size - 1) };
}

async function handleMediaRequest(request) {
  const url = new URL(request.url);

  if (url.hostname === 'cover') {
    const id = url.pathname.replace(/^\//, '');
    const cover = coverCache.get(id);
    if (!cover) {
      return new Response(null, { status: 404 });
    }
    return new Response(cover.data, {
      headers: { 'Content-Type': cover.mime, 'Cache-Control': 'no-store' }
    });
  }

  if (url.hostname === 'stream') {
    const filePath = decodeURIComponent(url.pathname.replace(/^\//, ''));
    if (!AUDIO_EXTS.has(path.extname(filePath).toLowerCase())) {
      return new Response(null, { status: 403 });
    }
    let stat;
    try {
      stat = await fsp.stat(filePath);
    } catch {
      return new Response(null, { status: 404 });
    }
    const mime = MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    const range = parseRange(request.headers.get('Range'), stat.size);
    if (range) {
      const stream = fs.createReadStream(filePath, { start: range.start, end: range.end });
      return new Response(Readable.toWeb(stream), {
        status: 206,
        headers: {
          'Content-Type': mime,
          'Accept-Ranges': 'bytes',
          'Content-Range': `bytes ${range.start}-${range.end}/${stat.size}`,
          'Content-Length': String(range.end - range.start + 1)
        }
      });
    }
    const stream = fs.createReadStream(filePath);
    return new Response(Readable.toWeb(stream), {
      status: 200,
      headers: {
        'Content-Type': mime,
        'Accept-Ranges': 'bytes',
        'Content-Length': String(stat.size)
      }
    });
  }

  return new Response(null, { status: 404 });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 840,
    minHeight: 560,
    title: 'AKU',
    icon: path.join(__dirname, 'build', 'icon.png'),
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow.loadFile('index.html');
  mainWindow.on('closed', () => {
    mainWindow = null;
    if (miniWindow && !miniWindow.isDestroyed()) {
      miniWindow.close();
    }
  });
}

function openMiniplayer() {
  if (miniWindow && !miniWindow.isDestroyed()) {
    miniWindow.show();
    miniWindow.focus();
    return;
  }
  miniWindow = new BrowserWindow({
    width: 300,
    height: 64,
    minWidth: 40,
    minHeight: 40,
    resizable: false,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    title: 'AKU',
    icon: path.join(__dirname, 'build', 'icon.png'),
    backgroundColor: '#000000',
    webPreferences: {
      preload: path.join(__dirname, 'mini-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  miniWindow.loadFile('mini.html');
  miniWindow.on('closed', () => {
    miniWindow = null;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('miniplayer-open-changed', false);
    }
  });
  miniWindow.webContents.on('did-finish-load', () => {
    if (lastPlayerState && miniWindow && !miniWindow.isDestroyed()) {
      miniWindow.webContents.send('player-state', lastPlayerState);
    }
  });
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('miniplayer-open-changed', true);
  }
}

ipcMain.handle('miniplayer-open', () => {
  openMiniplayer();
  return true;
});

ipcMain.on('miniplayer-config', (_event, config) => {
  if (!miniWindow || miniWindow.isDestroyed()) return;
  const cfg = config || {};
  const width = Math.max(48, Math.round(cfg.width || 300));
  const height = Math.max(48, Math.round(cfg.height || 64));
  const bounds = miniWindow.getBounds();
  let x = bounds.x;
  let y = bounds.y;
  const display = screen.getDisplayMatching(bounds);
  const area = display.workArea;
  x = Math.min(Math.max(x, area.x), area.x + area.width - width);
  y = Math.min(Math.max(y, area.y), area.y + area.height - height);
  miniWindow.setBounds({ x, y, width, height });
  if (typeof cfg.alwaysOnTop === 'boolean') {
    miniWindow.setAlwaysOnTop(cfg.alwaysOnTop);
  }
});

ipcMain.on('miniplayer-close', () => {
  if (miniWindow && !miniWindow.isDestroyed()) {
    miniWindow.close();
  }
});

ipcMain.on('player-state', (_event, state) => {
  lastPlayerState = state;
  if (miniWindow && !miniWindow.isDestroyed()) {
    miniWindow.webContents.send('player-state', state);
  }
});

ipcMain.on('player-command', (_event, command) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('player-command', command);
  }
});

ipcMain.handle('choose-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose your music folder',
    properties: ['openDirectory']
  });
  if (result.canceled || !result.filePaths.length) {
    return null;
  }
  const root = result.filePaths[0];
  const config = loadConfig();
  config.libraryRoot = root;
  saveConfig(config);
  const tracks = await scanLibrary(root);
  return { folder: root, tracks };
});

ipcMain.handle('get-library', async () => {
  const config = loadConfig();
  if (!config.libraryRoot) return null;
  const tracks = await scanLibrary(config.libraryRoot);
  return { folder: config.libraryRoot, tracks };
});

app.whenReady().then(() => {
  protocol.handle('media', handleMediaRequest);
  createWindow();
});

app.on('window-all-closed', () => {
  app.quit();
});
