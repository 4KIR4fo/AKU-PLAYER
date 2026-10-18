const STORAGE_KEY = 'aku-player-state';

const DEFAULT_SETTINGS = {
  theme: 'red',
  sidebarAutoHide: true,
  browseSections: true,
  genreTools: true,
  favorites: true,
  qualityIndicator: true,
  rowDisplay: 'comfortable',
  resumePlayback: false,
  confirmPlaylistDelete: true,
  shuffleRepeat: true,
  miniStyle: 'bar',
  miniSeek: false,
  miniVolume: false,
  miniStartCube: false,
  miniAlwaysOnTop: true
};

const THEMES = [
  { key: 'red', name: 'Crimson' },
  { key: 'teal', name: 'Terminal' },
  { key: 'ocean', name: 'Ocean' },
  { key: 'sage', name: 'Sage' },
  { key: 'forest', name: 'Forest' },
  { key: 'regal', name: 'Regal' },
  { key: 'terracotta', name: 'Terracotta' }
];

const audio = new Audio();
let seekDragging = false;
let pendingPlaylistIds = [];
let qualityPopoverTrackId;

const state = {
  sources: [],
  tracks: [],
  view: { type: 'library' },
  search: '',
  favorites: new Set(),
  playlists: [],
  queue: [],
  queueOrigin: [],
  queueOpen: false,
  currentId: null,
  selection: new Set(),
  selAnchor: null,
  // Duplicate-handling lives in config.json (main), not localStorage.
  dedupe: true,
  hidden: [],
  duplicates: 0,
  ignored: [],
  dupesKept: [],
  lastTrackId: null,
  shuffle: false,
  repeat: 'off',
  volume: 0.8,
  settings: { ...DEFAULT_SETTINGS },
  sidebarPinned: true,
  miniMode: 'full',
  lastPosition: 0
};

const els = {};
let pendingResume = null;

function $(id) {
  return document.getElementById(id);
}

function initEls() {
  els.trackList = $('track-list');
  els.search = $('search');
  els.chooseFolder = $('choose-folder');
  els.addMenu = $('add-menu');
  els.status = $('status');
  els.selBar = $('sel-bar');
  els.viewTitle = $('view-title');
  els.playlistList = $('playlist-list');
  els.newPlaylist = $('new-playlist');
  els.newPlaylistRow = $('new-playlist-row');
  els.newPlaylistInput = $('new-playlist-input');
  els.playlistBuilder = $('playlist-builder');
  els.genreMaker = $('genre-maker');
  els.genrePopover = $('genre-popover');
  els.categorizeBtn = $('categorize-btn');
  els.rowMenu = $('row-menu');
  els.nowCover = $('now-cover');
  els.nowTitle = $('now-title');
  els.nowArtist = $('now-artist');
  els.playIcon = $('play-icon');
  els.playBtn = $('play-btn');
  els.prevBtn = $('prev-btn');
  els.nextBtn = $('next-btn');
  els.shuffleBtn = $('shuffle-btn');
  els.repeatBtn = $('repeat-btn');
  els.repeatOne = $('repeat-one');
  els.seek = $('seek');
  els.timeCurrent = $('time-current');
  els.timeTotal = $('time-total');
  els.volume = $('volume');
  els.qualityBtn = $('quality-btn');
  els.qualityPopover = $('quality-popover');
  els.miniBtn = $('mini-btn');
  els.queueBtn = $('queue-btn');
  els.queuePanel = $('queue-panel');
  els.queueList = $('queue-list');
  els.queueClose = $('queue-close');
  els.sidebarToggle = $('sidebar-toggle');
  els.sidebarHandle = $('sidebar-handle');
  els.sidebar = $('sidebar');
  els.settingsBtn = $('settings-btn');
  els.settingsOverlay = $('settings-overlay');
  els.settingsBody = $('settings-body');
  els.settingsClose = $('settings-close');
  els.builderOverlay = $('builder-overlay');
  els.builderBody = $('builder-body');
  els.builderTitle = $('builder-title');
  els.builderSave = $('builder-save');
  els.builderClose = $('builder-close');
  els.dupesOverlay = $('dupes-overlay');
  els.dupesBody = $('dupes-body');
  els.dupesClose = $('dupes-close');
}

function fmtTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function trackById(id) {
  return state.tracks.find((track) => track.id === id) || null;
}

function shortFormat(quality) {
  const container = (quality.container || '').toLowerCase();
  const codec = (quality.codec || '').toLowerCase();
  if (codec.includes('opus')) return 'Opus';
  if (codec.includes('vorbis')) return 'Vorbis';
  if (container.includes('flac') || codec.includes('flac')) return 'FLAC';
  if (container.includes('wave') || codec.includes('pcm')) return 'WAV';
  if (container.includes('mpeg-4') || container.includes('mp4') || codec.includes('aac')) return 'AAC';
  if (container.includes('mpeg') || codec.includes('layer')) return 'MP3';
  return quality.codec || quality.container || 'Audio';
}

function fmtKHz(hz) {
  if (!hz) return null;
  return hz % 1000 === 0 ? `${hz / 1000} kHz` : `${(hz / 1000).toFixed(1)} kHz`;
}

function qualitySummary(quality) {
  if (!quality) return 'Unknown';
  const name = shortFormat(quality);
  if (quality.lossless && quality.bitsPerSample && quality.sampleRate) {
    return `${name} \u00B7 ${quality.bitsPerSample}/${quality.sampleRate / 1000}`;
  }
  if (quality.bitrate) return `${name} \u00B7 ${Math.round(quality.bitrate / 1000)} kbps`;
  if (quality.sampleRate) return `${name} \u00B7 ${quality.sampleRate / 1000} kHz`;
  return name;
}

function channelLabel(channels) {
  if (channels === 1) return 'Mono';
  if (channels === 2) return 'Stereo';
  if (channels) return `${channels} channels`;
  return null;
}

function closeQualityPopover() {
  els.qualityPopover.classList.add('hidden');
}

function openQualityPopover() {
  const track = state.currentId ? trackById(state.currentId) : null;
  if (!track) return;
  const popover = els.qualityPopover;
  popover.replaceChildren();

  const title = document.createElement('div');
  title.className = 'q-title';
  title.textContent = 'Audio quality';
  popover.appendChild(title);

  if (!track.quality) {
    const row = document.createElement('div');
    row.className = 'q-row';
    row.textContent = 'No quality metadata for this file.';
    popover.appendChild(row);
  } else {
    const quality = track.quality;
    const rows = [
      ['Format', quality.container || shortFormat(quality)],
      ['Codec', quality.codec],
      ['Bitrate', quality.bitrate ? `${Math.round(quality.bitrate / 1000)} kbps` : null],
      ['Sample rate', fmtKHz(quality.sampleRate)],
      ['Bit depth', quality.bitsPerSample ? `${quality.bitsPerSample} bit` : null],
      ['Channels', channelLabel(quality.channels)],
      ['Type', quality.lossless ? 'Lossless' : 'Lossy']
    ];
    for (const [label, value] of rows) {
      if (!value) continue;
      const row = document.createElement('div');
      row.className = 'q-row';
      const labelEl = document.createElement('span');
      labelEl.className = 'q-label';
      labelEl.textContent = label;
      const valueEl = document.createElement('span');
      valueEl.className = 'q-value';
      valueEl.textContent = value;
      row.append(labelEl, valueEl);
      popover.appendChild(row);
    }
  }

  popover.classList.remove('hidden');
  qualityPopoverTrackId = state.currentId;
  const rect = els.qualityBtn.getBoundingClientRect();
  const width = popover.offsetWidth;
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
  popover.style.left = `${left}px`;
  popover.style.bottom = `${window.innerHeight - rect.top + 6}px`;
  popover.style.top = 'auto';
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    favorites: [...state.favorites],
    playlists: state.playlists,
    volume: state.volume,
    shuffle: state.shuffle,
    repeat: state.repeat,
    view: state.view,
    lastTrackId: state.currentId,
    settings: state.settings,
    sidebarPinned: state.sidebarPinned,
    miniMode: state.miniMode,
    lastPosition: state.lastPosition
  }));
}

function restore() {
  let saved;
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
  } catch {
    saved = null;
  }
  if (!saved) return;
  if (Array.isArray(saved.favorites)) state.favorites = new Set(saved.favorites);
  if (Array.isArray(saved.playlists)) {
    state.playlists = saved.playlists.filter((pl) =>
      pl && typeof pl.name === 'string' && Array.isArray(pl.trackIds));
  }
  if (typeof saved.volume === 'number') {
    state.volume = Math.min(1, Math.max(0, saved.volume));
  }
  state.shuffle = !!saved.shuffle;
  if (saved.repeat === 'all' || saved.repeat === 'one') state.repeat = saved.repeat;
  if (saved.settings && typeof saved.settings === 'object') {
    state.settings = { ...DEFAULT_SETTINGS, ...saved.settings };
    // Older builds stored row cover art and density as two separate toggles;
    // fold them into the single rowDisplay choice so saved prefs still apply.
    if (saved.settings.rowDisplay === undefined &&
      (saved.settings.coverArt === false || saved.settings.compactDensity === true)) {
      state.settings.rowDisplay = saved.settings.compactDensity ? 'compact' : 'no-covers';
    }
    delete state.settings.coverArt;
    delete state.settings.compactDensity;
  }
  if (typeof saved.sidebarPinned === 'boolean') state.sidebarPinned = saved.sidebarPinned;
  if (saved.miniMode === 'cube' || saved.miniMode === 'full') state.miniMode = saved.miniMode;
  const view = saved.view;
  if (view && typeof view.type === 'string') {
    if (['library', 'favorites', 'albums', 'artists', 'genres', 'eras'].includes(view.type)) {
      state.view = { type: view.type };
    } else if (view.type === 'playlist' &&
      state.playlists.some((pl) => pl.name === view.name)) {
      state.view = { type: 'playlist', name: view.name };
    } else if (['album', 'artist', 'genre', 'era'].includes(view.type) && view.name) {
      state.view = { type: view.type, name: view.name };
    }
  }
  if (typeof saved.lastTrackId === 'string') state.lastTrackId = saved.lastTrackId;
  if (typeof saved.lastPosition === 'number') state.lastPosition = saved.lastPosition;
}

function baseTracks() {
  if (state.view.type === 'favorites') {
    return state.tracks.filter((track) => state.favorites.has(track.id));
  }
  if (state.view.type === 'playlist') {
    const playlist = state.playlists.find((pl) => pl.name === state.view.name);
    const ids = playlist ? playlistTrackIds(playlist) : [];
    return ids.map(trackById).filter(Boolean);
  }
  if (state.view.type === 'album') {
    const group = albumGroups().find((g) => g.key === state.view.name);
    return group ? group.ids.map(trackById).filter(Boolean) : [];
  }
  if (state.view.type === 'artist') {
    return state.tracks.filter((track) => track.artist === state.view.name);
  }
  if (state.view.type === 'genre') {
    const key = state.view.name.toLowerCase();
    return state.tracks.filter((track) =>
      (track.genre || []).some((g) => g.toLowerCase() === key));
  }
  if (state.view.type === 'era') {
    return state.tracks.filter((track) => eraKey(track) === state.view.name);
  }
  return state.tracks;
}

function visibleTracks() {
  const query = state.search.trim().toLowerCase();
  const base = baseTracks();
  if (!query) return base;
  return base.filter((track) =>
    `${track.title} ${track.artist} ${track.album}`.toLowerCase().includes(query));
}

function albumGroups() {
  const map = new Map();
  for (const track of state.tracks) {
    const album = track.album || 'Unknown album';
    // Join album and artist with NUL (never present in tag text) so one
    // album's tracks by different artists don't get merged into a single group.
    const key = `${album}\u0000${track.artist || ''}`;
    let group = map.get(key);
    if (!group) {
      group = { key, album, artist: track.artist || 'Unknown artist', cover: null, ids: [] };
      map.set(key, group);
    }
    if (!group.cover && track.cover) group.cover = track.cover;
    group.ids.push(track.id);
  }
  return [...map.values()].sort((a, b) =>
    a.album.localeCompare(b.album) || a.artist.localeCompare(b.artist));
}

function artistGroups() {
  const map = new Map();
  for (const track of state.tracks) {
    const artist = track.artist || 'Unknown artist';
    let group = map.get(artist);
    if (!group) {
      group = { key: artist, name: artist, ids: [] };
      map.set(artist, group);
    }
    group.ids.push(track.id);
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function eraKey(track) {
  if (!Number.isFinite(track.year) || track.year < 1000) return 'unknown';
  return `d${Math.floor(track.year / 10) * 10}`;
}

function eraGroups() {
  const map = new Map();
  for (const track of state.tracks) {
    const key = eraKey(track);
    let group = map.get(key);
    if (!group) {
      const decade = key === 'unknown' ? null : parseInt(key.slice(1), 10);
      group = { key, label: decade === null ? 'Unknown' : `${decade}s`, ids: [] };
      map.set(key, group);
    }
    group.ids.push(track.id);
  }
  return [...map.values()].sort((a, b) => {
    if (a.key === 'unknown') return 1;
    if (b.key === 'unknown') return -1;
    return b.key.localeCompare(a.key);
  });
}

function setView(view) {
  state.view = view;
  state.search = '';
  els.search.value = '';
  persist();
  renderSidebar();
  renderMain();
}

function updateViewTitle() {
  const type = state.view.type;
  if (type === 'favorites') els.viewTitle.textContent = 'Favorites';
  else if (type === 'playlist') els.viewTitle.textContent = state.view.name;
  else if (type === 'albums') els.viewTitle.textContent = 'Albums';
  else if (type === 'artists') els.viewTitle.textContent = 'Artists';
  else if (type === 'genres') els.viewTitle.textContent = 'Genres';
  else if (type === 'eras') els.viewTitle.textContent = 'Eras';
  else if (type === 'album') {
    const group = albumGroups().find((g) => g.key === state.view.name);
    els.viewTitle.textContent = group ? group.album : 'Album';
  } else if (type === 'artist' || type === 'genre') {
    els.viewTitle.textContent = state.view.name;
  } else if (type === 'era') {
    const group = eraGroups().find((g) => g.key === state.view.name);
    els.viewTitle.textContent = group ? group.label : 'Era';
  } else els.viewTitle.textContent = 'Library';
}

function renderSidebar() {
  const browseHidden = !state.settings.browseSections;
  const favoritesHidden = !state.settings.favorites;
  document.querySelectorAll('.nav-item').forEach((item) => {
    const view = item.dataset.view;
    if (view === 'favorites') item.classList.toggle('hidden', favoritesHidden);
    else if (['albums', 'artists', 'genres', 'eras'].includes(view)) {
      item.classList.toggle('hidden', browseHidden);
    }
    item.classList.toggle('active', state.view.type === view);
  });

  els.playlistList.replaceChildren();
  for (const playlist of state.playlists) {
    const li = document.createElement('li');
    li.classList.toggle('active',
      state.view.type === 'playlist' && state.view.name === playlist.name);

    const name = document.createElement('span');
    name.className = 'playlist-name';
    name.textContent = playlist.name;
    if (playlist.auto) {
      const tag = document.createElement('span');
      tag.className = 'auto-tag';
      tag.title = 'Auto-generated from genre';
      tag.textContent = '\u266A';
      name.prepend(tag);
    } else if (playlist.live) {
      const tag = document.createElement('span');
      tag.className = 'auto-tag';
      tag.title = 'Live playlist built from sources';
      tag.textContent = '\u21BB';
      name.prepend(tag);
    }

    const del = document.createElement('button');
    del.className = 'delete-playlist';
    del.title = 'Delete playlist';
    del.textContent = '\u2715';
    del.addEventListener('click', (event) => {
      event.stopPropagation();
      deletePlaylist(playlist.name);
    });

    li.addEventListener('click', () => setView({ type: 'playlist', name: playlist.name }));
    if (playlist.live || Array.isArray(playlist.sources)) {
      const edit = document.createElement('button');
      edit.className = 'edit-playlist';
      edit.title = 'Edit in builder';
      edit.textContent = '\u270E';
      edit.addEventListener('click', (event) => {
        event.stopPropagation();
        openBuilder(playlist);
      });
      li.append(name, edit, del);
    } else {
      li.append(name, del);
    }
    els.playlistList.appendChild(li);
  }

  updateViewTitle();
}

function updateStatus() {
  const sources = state.sources.length;
  if (!sources) {
    els.status.textContent = '';
    return;
  }
  const count = state.tracks.length;
  const parts = [`${count} track${count === 1 ? '' : 's'} \u2014 ${sources} source${sources === 1 ? '' : 's'}`];
  if (state.dedupe && state.duplicates) {
    parts.push(`${state.duplicates} duplicate${state.duplicates === 1 ? '' : 's'} ignored`);
  }
  if (state.hidden.length) {
    parts.push(`${state.hidden.length} hidden`);
  }
  els.status.textContent = parts.join(' \u2014 ');
}

function buildRow(track) {
  const row = document.createElement('div');
  const selected = state.selection.has(track.id);
  row.className = 'track-row' +
    (track.id === state.currentId ? ' playing' : '') +
    (selected ? ' selected' : '');
  row.dataset.id = track.id;

  const cover = document.createElement('div');
  cover.className = 'cover';
  if (track.cover) {
    const img = document.createElement('img');
    img.src = track.cover;
    img.addEventListener('error', () => {
      img.remove();
      cover.textContent = '\u266A';
    });
    cover.appendChild(img);
  } else {
    cover.textContent = '\u266A';
  }

  const title = document.createElement('div');
  title.className = 'track-cell track-title';
  title.textContent = track.title;

  const artist = document.createElement('div');
  artist.className = 'track-cell track-artist';
  artist.textContent = track.artist;

  const album = document.createElement('div');
  album.className = 'track-cell track-album';
  album.textContent = track.album;

  const duration = document.createElement('div');
  duration.className = 'track-duration';
  duration.textContent = track.duration ? fmtTime(track.duration) : '--:--';

  const actions = document.createElement('div');
  actions.className = 'row-actions';

  const fav = document.createElement('button');
  fav.className = 'fav-btn' + (state.favorites.has(track.id) ? ' fav-on' : '');
  fav.title = 'Favorite';
  fav.textContent = state.favorites.has(track.id) ? '\u2665' : '\u2661';

  const add = document.createElement('button');
  add.className = 'add-btn';
  add.title = 'Add to playlist';
  add.textContent = '+';

  const hide = document.createElement('button');
  hide.className = 'hide-btn';
  hide.title = 'Remove from library (keeps the file)';
  hide.textContent = '\u2298';

  actions.append(fav, add, hide);
  row.append(cover, title, artist, album, duration, actions);
  return row;
}

function renderTrackList() {
  const scrollTop = els.trackList.scrollTop;
  const tracks = visibleTracks();

  if (!tracks.length) {
    els.trackList.replaceChildren();
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    if (!state.sources.length) {
      empty.textContent = 'No music yet. Add folders or files and AKU will index what it finds.';
      const btn = document.createElement('button');
      btn.className = 'accent-btn';
      btn.textContent = 'Add music';
      btn.addEventListener('click', () => openAddMenu(btn));
      empty.appendChild(document.createElement('br'));
      empty.appendChild(btn);
    } else if (state.search.trim()) {
      empty.textContent = 'Nothing matched your search.';
    } else if (state.view.type === 'favorites') {
      empty.textContent = 'No favorites yet. Click the heart on any track.';
    } else if (state.view.type === 'playlist') {
      empty.textContent = 'This playlist is empty. Use the + button on a track, or build it from genres and albums.';
    } else if (['album', 'artist', 'genre', 'era'].includes(state.view.type)) {
      empty.textContent = 'No tracks in here yet.';
    } else {
      empty.textContent = 'No audio files found in these sources.';
    }
    els.trackList.appendChild(empty);
  } else {
    const fragment = document.createDocumentFragment();
    for (const track of tracks) fragment.appendChild(buildRow(track));
    els.trackList.replaceChildren(fragment);
  }

  els.trackList.scrollTop = scrollTop;
  renderSelectionBar();
}

function browseConfig() {
  if (state.view.type === 'albums') {
    return { groups: albumGroups(), mode: 'grid', keyOf: (g) => g.key,
      title: (g) => g.album, sub: (g) => g.artist, cover: (g) => g.cover };
  }
  if (state.view.type === 'artists') {
    return { groups: artistGroups(), mode: 'list', keyOf: (g) => g.key,
      title: (g) => g.name, sub: () => '' };
  }
  if (state.view.type === 'genres') {
    return { groups: genreGroups(), mode: 'list', keyOf: (g) => g.name,
      title: (g) => g.name, sub: () => '' };
  }
  return { groups: eraGroups(), mode: 'list', keyOf: (g) => g.key,
    title: (g) => g.label, sub: () => '' };
}

function renderBrowse() {
  const config = browseConfig();
  const query = state.search.trim().toLowerCase();
  const groups = query
    ? config.groups.filter((g) => {
      const hay = `${config.title(g)} ${config.sub(g)}`.toLowerCase();
      return hay.includes(query);
    })
    : config.groups;

  const scrollTop = els.trackList.scrollTop;
  els.trackList.replaceChildren();

  if (!groups.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = query
      ? 'No matches for your search.'
      : 'Nothing to show here yet.';
    els.trackList.appendChild(empty);
    els.trackList.scrollTop = scrollTop;
    return;
  }

  const container = document.createElement('div');
  container.className = config.mode === 'grid' ? 'card-grid' : 'group-list';

  for (const group of groups) {
    const key = config.keyOf(group);
    if (config.mode === 'grid') {
      const card = document.createElement('button');
      card.className = 'album-card';
      card.dataset.key = key;

      const art = document.createElement('div');
      art.className = 'album-art';
      const cover = config.cover(group);
      if (cover) {
        const img = document.createElement('img');
        img.src = cover;
        img.addEventListener('error', () => {
          img.remove();
          art.textContent = '\u266A';
        });
        art.appendChild(img);
      } else {
        art.textContent = '\u266A';
      }

      const title = document.createElement('div');
      title.className = 'album-title';
      title.textContent = config.title(group);

      const sub = document.createElement('div');
      sub.className = 'album-sub';
      sub.textContent = config.sub(group);

      const count = document.createElement('div');
      count.className = 'album-count';
      count.textContent = `${group.ids.length} track${group.ids.length === 1 ? '' : 's'}`;

      card.append(art, title, sub, count);
      card.addEventListener('click', () => {
        setView({ type: state.view.type.slice(0, -1), name: key });
      });
      container.appendChild(card);
    } else {
      const row = document.createElement('button');
      row.className = 'group-row';
      row.dataset.key = key;

      const name = document.createElement('span');
      name.className = 'group-name';
      name.textContent = config.title(group);

      const count = document.createElement('span');
      count.className = 'group-count';
      count.textContent = `${group.ids.length} track${group.ids.length === 1 ? '' : 's'}`;

      row.append(name, count);
      row.addEventListener('click', () => {
        setView({ type: state.view.type.slice(0, -1), name: key });
      });
      container.appendChild(row);
    }
  }
  els.trackList.appendChild(container);
  els.trackList.scrollTop = scrollTop;
}

function renderMain() {
  if (['albums', 'artists', 'genres', 'eras'].includes(state.view.type)) {
    renderBrowse();
  } else {
    renderTrackList();
  }
}

function updatePlayerBar() {
  const track = state.currentId ? trackById(state.currentId) : null;
  els.nowTitle.textContent = track ? track.title : 'Nothing playing';
  els.nowArtist.textContent = track ? `${track.artist} \u2014 ${track.album}` : '';

  els.nowCover.replaceChildren();
  if (track && track.cover) {
    const img = document.createElement('img');
    img.src = track.cover;
    img.addEventListener('error', () => {
      img.remove();
      els.nowCover.textContent = '\u266A';
    });
    els.nowCover.appendChild(img);
  } else {
    els.nowCover.textContent = '\u266A';
  }

  els.playIcon.setAttribute('href', audio.paused ? '#icon-play' : '#icon-pause');
  els.shuffleBtn.classList.toggle('active', state.shuffle);
  els.repeatBtn.classList.toggle('active', state.repeat !== 'off');
  els.repeatOne.classList.toggle('hidden', state.repeat !== 'one');

  els.qualityBtn.textContent = track ? qualitySummary(track.quality) : '\u2014';
  if (state.currentId !== qualityPopoverTrackId) {
    qualityPopoverTrackId = state.currentId;
    closeQualityPopover();
  }
}

function updateSeek() {
  const duration = audio.duration;
  if (duration && Number.isFinite(duration)) {
    els.seek.disabled = false;
    els.seek.value = Math.round((audio.currentTime / duration) * 1000);
    els.timeTotal.textContent = fmtTime(duration);
  } else {
    els.seek.disabled = true;
    els.seek.value = 0;
    els.timeTotal.textContent = '0:00';
  }
  els.timeCurrent.textContent = fmtTime(audio.currentTime || 0);
}

let miniOpen = false;
let lastBroadcast = 0;

function playerSnapshot() {
  const track = state.currentId ? trackById(state.currentId) : null;
  return {
    id: track ? track.id : null,
    title: track ? track.title : null,
    artist: track ? track.artist : null,
    album: track ? track.album : null,
    cover: track ? track.cover : null,
    playing: !audio.paused,
    currentTime: audio.currentTime || 0,
    duration: Number.isFinite(audio.duration) ? audio.duration : 0,
    volume: state.volume,
    theme: state.settings.theme,
    miniStyle: state.settings.miniStyle,
    miniSeek: state.settings.miniSeek,
    miniVolume: state.settings.miniVolume,
    miniMode: state.miniMode
  };
}

function miniWindowSize() {
  if (state.miniMode === 'cube') return { width: 80, height: 80 };
  const bars = (state.settings.miniSeek ? 1 : 0) + (state.settings.miniVolume ? 1 : 0);
  if (state.settings.miniStyle === 'card') return { width: 300, height: 160 + bars * 24 };
  if (state.settings.miniStyle === 'minimal') return { width: 220, height: 64 };
  return { width: 320, height: 64 + bars * 24 };
}

function applyMiniWindow() {
  if (!window.aku || !miniOpen) return;
  const size = miniWindowSize();
  window.aku.setMiniPlayerWindow({
    width: size.width,
    height: size.height,
    alwaysOnTop: state.settings.miniAlwaysOnTop
  });
}

function broadcastState(force) {
  if (!window.aku) return;
  const now = performance.now();
  if (!force && now - lastBroadcast < 250) return;
  lastBroadcast = now;
  window.aku.sendPlayerState(playerSnapshot());
}

function handlePlayerCommand(command) {
  if (!command) return;
  if (command.type === 'toggle-play') {
    togglePlay();
  } else if (command.type === 'next') {
    playNext(false);
  } else if (command.type === 'prev') {
    playPrev();
  } else if (command.type === 'seek') {
    if (audio.duration && Number.isFinite(audio.duration)) {
      const ratio = Math.min(1, Math.max(0, command.value));
      audio.currentTime = ratio * audio.duration;
      updateSeek();
      broadcastState(true);
    }
  } else if (command.type === 'volume') {
    setVolume(command.value);
  } else if (command.type === 'mini-mode') {
    setMiniMode(command.mode === 'cube' ? 'cube' : 'full');
  }
}

function setMiniMode(mode) {
  state.miniMode = mode;
  persist();
  applyMiniWindow();
  broadcastState(true);
}

// Shuffling builds a play order once and is then walked linearly, so Next is
// randomized but Previous always returns to the song that actually played. The
// current track sits first only so there is a defined start.
function shuffledFrom(ids, currentId) {
  const rest = ids.filter((id) => id !== currentId);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  return currentId ? [currentId, ...rest] : rest;
}

function buildQueue(context, currentId) {
  state.queueOrigin = context.slice();
  state.queue = state.shuffle ? shuffledFrom(context, currentId) : context.slice();
}

function playTrack(id, listIds, keepQueue) {
  const track = trackById(id);
  if (!track) return;
  if (!keepQueue) {
    const context = listIds && listIds.length ? listIds : visibleTracks().map((t) => t.id);
    buildQueue(context, id);
  }
  state.currentId = id;
  state.lastPosition = 0;
  audio.src = track.src;
  audio.play().catch(() => {});
  persist();
  updatePlayerBar();
  renderTrackList();
  broadcastState(true);
  if (state.queueOpen) renderQueue();
}

function togglePlay() {
  if (!state.currentId) {
    const list = visibleTracks();
    if (list.length) playTrack(list[0].id, list.map((t) => t.id));
    return;
  }
  if (audio.paused) {
    if (!audio.src) {
      const track = trackById(state.currentId);
      if (track) audio.src = track.src;
    }
    audio.play().catch(() => {});
  } else {
    audio.pause();
  }
}

function playNext(auto) {
  const queue = state.queue;
  if (!queue.length) return;
  const index = queue.indexOf(state.currentId);
  let nextId;
  if (index === -1) {
    nextId = queue[0];
  } else if (index === queue.length - 1) {
    nextId = auto && state.repeat === 'off' ? null : queue[0];
  } else {
    nextId = queue[index + 1];
  }
  if (nextId === null) {
    updatePlayerBar();
    return;
  }
  playTrack(nextId, queue, true);
}

function playPrev() {
  if (audio.currentTime > 3) {
    audio.currentTime = 0;
    return;
  }
  const queue = state.queue;
  if (!queue.length) return;
  const index = queue.indexOf(state.currentId);
  const prevId = index <= 0 ? queue[queue.length - 1] : queue[index - 1];
  playTrack(prevId, queue, true);
}

function seekBy(delta) {
  if (!audio.duration || !Number.isFinite(audio.duration)) return;
  audio.currentTime = Math.min(audio.duration, Math.max(0, audio.currentTime + delta));
}

function setVolume(value) {
  state.volume = Math.min(1, Math.max(0, value));
  audio.volume = state.volume;
  els.volume.value = Math.round(state.volume * 100);
  persist();
  broadcastState(true);
}

function toggleFavorite(id) {
  if (state.favorites.has(id)) state.favorites.delete(id);
  else state.favorites.add(id);
  persist();
  renderTrackList();
}

function applyLibrary(result) {
  if (!result) {
    updateStatus();
    renderMain();
    return;
  }
  state.sources = Array.isArray(result.sources) ? result.sources : [];
  state.tracks = Array.isArray(result.tracks) ? result.tracks : [];
  state.dedupe = result.dedupe !== false;
  state.hidden = Array.isArray(result.hidden) ? result.hidden : [];
  state.duplicates = Number(result.duplicates) || 0;
  state.ignored = Array.isArray(result.ignored) ? result.ignored : [];
  state.dupesKept = Array.isArray(result.dupesKept) ? result.dupesKept : [];
  pruneSelection();
  recomputeLivePlaylists();
  if (state.currentId && !trackById(state.currentId)) {
    state.currentId = null;
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
  }
  updateStatus();
  updatePlayerBar();
  renderSidebar();
  renderMain();
  if (state.queueOpen) renderQueue();
  if (!els.builderOverlay.classList.contains('hidden')) renderBuilder();
  if (!els.settingsOverlay.classList.contains('hidden')) renderSettings();
  if (!els.dupesOverlay.classList.contains('hidden')) renderDuplicates();
}

async function addSource(type) {
  els.status.textContent = type === 'file'
    ? 'Waiting for file selection\u2026'
    : 'Waiting for folder selection\u2026';
  const result = type === 'file' ? await window.aku.addFiles() : await window.aku.addFolder();
  applyLibrary(result);
}

async function removeSource(sourcePath) {
  const result = await window.aku.removeSource(sourcePath);
  applyLibrary(result);
}

async function hideTracks(ids) {
  const valid = ids.filter((id) => trackById(id));
  if (!valid.length) return;
  const noun = valid.length === 1 ? 'song' : 'songs';
  if (!confirm(`Remove ${valid.length} ${noun} from the library? The files stay on disk.`)) return;
  clearSelection();
  applyLibrary(await window.aku.hideTracks(valid));
}

async function restoreTracks(paths) {
  applyLibrary(await window.aku.restoreTracks(paths));
}

async function restoreAllHidden() {
  applyLibrary(await window.aku.restoreAllHidden());
}

async function restoreDuplicates(ids) {
  if (!ids.length) return;
  applyLibrary(await window.aku.restoreDuplicates(ids));
}

async function restoreAllDuplicates() {
  await restoreDuplicates(state.ignored.map((entry) => entry.id));
}

async function ignoreDuplicates(ids) {
  if (!ids.length) return;
  applyLibrary(await window.aku.ignoreDuplicates(ids));
}

async function setDedupe(on) {
  applyLibrary(await window.aku.setDedupe(on));
}

function openAddMenu(anchor) {
  const menu = els.addMenu;
  menu.replaceChildren();
  const add = (label, fn) => {
    const item = document.createElement('button');
    item.className = 'menu-item';
    item.textContent = label;
    item.addEventListener('click', () => {
      closeAddMenu();
      fn();
    });
    menu.appendChild(item);
  };
  add('Add folder\u2026', () => addSource('folder'));
  add('Add files\u2026', () => addSource('file'));

  menu.classList.remove('hidden');
  const rect = anchor.getBoundingClientRect();
  const width = menu.offsetWidth;
  const height = menu.offsetHeight;
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
  const top = rect.bottom + 6 + height > window.innerHeight
    ? Math.max(8, rect.top - height - 6)
    : rect.bottom + 6;
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

function closeAddMenu() {
  els.addMenu.classList.add('hidden');
}

function pruneSelection() {
  for (const id of [...state.selection]) {
    if (!trackById(id)) state.selection.delete(id);
  }
  if (state.selAnchor && !trackById(state.selAnchor)) state.selAnchor = null;
}

function clearSelection() {
  if (!state.selection.size && !state.selAnchor) return;
  state.selection.clear();
  state.selAnchor = null;
  renderTrackList();
}

function toggleSelection(id) {
  if (state.selection.has(id)) state.selection.delete(id);
  else state.selection.add(id);
  state.selAnchor = id;
  renderTrackList();
}

function selectRange(fromId, toId, additive) {
  const list = visibleTracks().map((track) => track.id);
  const a = list.indexOf(fromId);
  const b = list.indexOf(toId);
  if (a === -1 || b === -1) return;
  if (!additive) state.selection.clear();
  const [start, end] = a <= b ? [a, b] : [b, a];
  for (let i = start; i <= end; i++) state.selection.add(list[i]);
  renderTrackList();
}

function selectedIds() {
  return visibleTracks().filter((track) => state.selection.has(track.id)).map((track) => track.id);
}

function setFavorite(ids, value) {
  for (const id of ids) {
    if (value) state.favorites.add(id);
    else state.favorites.delete(id);
  }
  persist();
  renderTrackList();
}

function renderSelectionBar() {
  const bar = els.selBar;
  const ids = selectedIds();
  if (!ids.length) {
    bar.classList.add('hidden');
    bar.replaceChildren();
    return;
  }
  bar.replaceChildren();

  const count = document.createElement('span');
  count.className = 'sel-count';
  count.textContent = `${ids.length} selected`;
  bar.appendChild(count);

  const make = (label, fn) => {
    const btn = document.createElement('button');
    btn.className = 'ghost-btn';
    btn.textContent = label;
    btn.addEventListener('click', fn);
    bar.appendChild(btn);
    return btn;
  };
  make('Play', () => {
    clearSelection();
    playTrack(ids[0], ids);
  });
  make('Queue', () => addToQueue(ids));
  make('Heart', () => setFavorite(ids, true));
  make('Unheart', () => setFavorite(ids, false));
  const addBtn = make('Add to playlist\u2026', () => {});
  addBtn.addEventListener('click', () => openPlaylistMenu(ids, addBtn));
  make('Remove from queue', () => removeFromQueue(ids));
  make('Remove', () => hideTracks(ids));
  make('Clear', () => clearSelection());

  bar.classList.remove('hidden');
}

function addToQueue(ids) {
  const valid = ids.filter((id) => trackById(id));
  if (!valid.length) return;
  if (!state.queue.length) state.queue = visibleTracks().map((track) => track.id);
  const at = state.currentId ? state.queue.indexOf(state.currentId) : -1;
  const insertAt = at === -1 ? state.queue.length : at + 1;
  state.queue.splice(insertAt, 0, ...valid.filter((id) => !state.queue.includes(id)));
  const origin = state.queueOrigin.length ? state.queueOrigin : state.queue.slice();
  for (const id of valid) if (!origin.includes(id)) origin.push(id);
  state.queueOrigin = origin;
  persist();
  if (state.queueOpen) renderQueue();
  els.status.textContent = `Queued ${valid.length} track${valid.length === 1 ? '' : 's'}.`;
}

function removeFromQueue(ids) {
  const drop = new Set(ids.filter((id) => state.queue.includes(id)));
  if (!drop.size) return;
  state.queue = state.queue.filter((id) => !drop.has(id));
  state.queueOrigin = state.queueOrigin.filter((id) => !drop.has(id));
  if (state.queueOpen) renderQueue();
  els.status.textContent = `Removed ${drop.size} track${drop.size === 1 ? '' : 's'} from the queue.`;
}

function renderQueue() {
  els.queueList.replaceChildren();
  if (!state.queue.length) {
    const empty = document.createElement('div');
    empty.className = 'queue-empty';
    empty.textContent = 'The queue is empty. Play something to fill it.';
    els.queueList.appendChild(empty);
    return;
  }
  state.queue.forEach((id, index) => {
    const track = trackById(id);
    if (!track) return;
    const item = document.createElement('button');
    item.className = 'queue-item' + (id === state.currentId ? ' current' : '');
    const num = document.createElement('span');
    num.className = 'queue-index';
    num.textContent = String(index + 1);
    const meta = document.createElement('span');
    meta.className = 'queue-meta';
    const title = document.createElement('span');
    title.className = 'queue-title';
    title.textContent = track.title;
    const artist = document.createElement('span');
    artist.className = 'queue-artist';
    artist.textContent = track.artist;
    meta.append(title, artist);
    item.append(num, meta);
    item.addEventListener('click', () => playTrack(id, null, true));
    els.queueList.appendChild(item);
  });
  const current = els.queueList.querySelector('.queue-item.current');
  if (current) current.scrollIntoView({ block: 'nearest' });
}

function toggleQueue(force) {
  const open = typeof force === 'boolean' ? force : !state.queueOpen;
  state.queueOpen = open;
  els.queuePanel.classList.toggle('hidden', !open);
  els.queueBtn.classList.toggle('active', open);
  if (open) renderQueue();
}

function closeRowMenu() {
  els.rowMenu.classList.add('hidden');
}

function openPlaylistMenu(ids, anchor) {
  const menu = els.rowMenu;
  menu.replaceChildren();

  for (const playlist of state.playlists) {
    const included = ids.every((id) => playlistTrackIds(playlist).includes(id));
    const item = document.createElement('button');
    item.className = 'menu-item';
    const check = document.createElement('span');
    check.className = 'check';
    check.textContent = included ? '\u2713' : '';
    const name = document.createElement('span');
    name.className = 'menu-name';
    name.textContent = playlist.name;
    item.append(check, name);
    item.addEventListener('click', () => {
      for (const id of ids) setPlaylistMembership(playlist.name, id, !included);
      closeRowMenu();
    });
    menu.appendChild(item);
  }

  if (state.playlists.length) {
    const sep = document.createElement('div');
    sep.className = 'menu-sep';
    menu.appendChild(sep);
  }

  const newItem = document.createElement('button');
  newItem.className = 'menu-item';
  newItem.textContent = '+ New playlist\u2026';
  newItem.addEventListener('click', () => {
    closeRowMenu();
    startNewPlaylist(ids);
  });
  menu.appendChild(newItem);

  const rect = anchor.getBoundingClientRect();
  menu.classList.remove('hidden');
  const width = menu.offsetWidth;
  const height = menu.offsetHeight;
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
  const top = rect.bottom + 6 + height > window.innerHeight
    ? Math.max(8, rect.top - height - 6)
    : rect.bottom + 6;
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

function startNewPlaylist(ids) {
  pendingPlaylistIds = (Array.isArray(ids) ? ids : ids ? [ids] : []).filter(Boolean);
  els.newPlaylistRow.classList.remove('hidden');
  els.newPlaylistInput.value = '';
  els.newPlaylistInput.focus();
}

function finishNewPlaylist() {
  const name = els.newPlaylistInput.value.trim();
  els.newPlaylistRow.classList.add('hidden');
  els.newPlaylistInput.value = '';
  const ids = pendingPlaylistIds;
  pendingPlaylistIds = [];
  if (!name) return;
  let playlist = state.playlists.find((pl) => pl.name === name);
  if (!playlist) {
    playlist = { name, trackIds: [] };
    state.playlists.push(playlist);
  }
  for (const id of ids) {
    if (!playlist.trackIds.includes(id)) playlist.trackIds.push(id);
  }
  persist();
  renderSidebar();
  if (state.view.type === 'playlist' && state.view.name === name) {
    renderTrackList();
  }
}

function setPlaylistMembership(name, id, include) {
  const playlist = state.playlists.find((pl) => pl.name === name);
  if (!playlist) return;
  if (playlist.live) {
    // Live playlists are derived from their sources; hand-added tracks ride
    // along as extras so they survive the next recompute.
    if (!Array.isArray(playlist.extraIds)) playlist.extraIds = [];
    const index = playlist.extraIds.indexOf(id);
    if (include && index === -1) playlist.extraIds.push(id);
    if (!include && index !== -1) playlist.extraIds.splice(index, 1);
    playlist.trackIds = computeLiveTrackIds(playlist);
  } else {
    const index = playlist.trackIds.indexOf(id);
    if (include && index === -1) playlist.trackIds.push(id);
    if (!include && index !== -1) playlist.trackIds.splice(index, 1);
  }
  persist();
  renderSidebar();
  if (state.view.type === 'playlist' && state.view.name === name) {
    renderTrackList();
  }
}

function togglePlaylistMembership(name, trackId) {
  const playlist = state.playlists.find((pl) => pl.name === name);
  if (!playlist) return;
  setPlaylistMembership(name, trackId, !playlistTrackIds(playlist).includes(trackId));
}

function sourceTrackIds(source) {
  const type = source && source.type;
  const key = source && source.key;
  if (type === 'genre') {
    const lower = String(key).toLowerCase();
    return state.tracks
      .filter((track) => (track.genre || []).some((g) => g.toLowerCase() === lower))
      .map((track) => track.id);
  }
  if (type === 'album') {
    const group = albumGroups().find((g) => g.key === key);
    return group ? group.ids : [];
  }
  if (type === 'artist') {
    return state.tracks.filter((track) => track.artist === key).map((track) => track.id);
  }
  if (type === 'era') {
    return state.tracks.filter((track) => eraKey(track) === key).map((track) => track.id);
  }
  if (type === 'year') {
    return state.tracks.filter((track) => String(track.year) === String(key)).map((track) => track.id);
  }
  return [];
}

// Sources are unioned in the order the user arranged them, then hand-picked
// tracks; duplicates are dropped so the same song never appears twice.
function computeLiveTrackIds(playlist) {
  const ids = [];
  const seen = new Set();
  const push = (id) => {
    if (seen.has(id) || !trackById(id)) return;
    seen.add(id);
    ids.push(id);
  };
  for (const source of playlist.sources || []) {
    for (const id of sourceTrackIds(source)) push(id);
  }
  for (const id of playlist.extraIds || []) push(id);
  return ids;
}

function playlistTrackIds(playlist) {
  if (playlist && playlist.live) return computeLiveTrackIds(playlist);
  return playlist && Array.isArray(playlist.trackIds) ? playlist.trackIds : [];
}

function recomputeLivePlaylists() {
  for (const playlist of state.playlists) {
    if (playlist && playlist.live) playlist.trackIds = computeLiveTrackIds(playlist);
  }
}

const BUILDER_TABS = [
  { key: 'genre', label: 'Genres' },
  { key: 'album', label: 'Albums' },
  { key: 'artist', label: 'Artists' },
  { key: 'era', label: 'Eras' },
  { key: 'year', label: 'Years' }
];

let builder = null;

function builderSourceItems(cat) {
  if (cat === 'album') {
    return albumGroups().map((g) => ({ type: 'album', key: g.key, label: g.album, sub: g.artist, count: g.ids.length }));
  }
  if (cat === 'artist') {
    return artistGroups().map((g) => ({ type: 'artist', key: g.key, label: g.name, count: g.ids.length }));
  }
  if (cat === 'era') {
    return eraGroups().map((g) => ({ type: 'era', key: g.key, label: g.label, count: g.ids.length }));
  }
  if (cat === 'year') {
    const years = new Map();
    for (const track of state.tracks) {
      if (!Number.isFinite(track.year)) continue;
      const key = String(track.year);
      years.set(key, (years.get(key) || 0) + 1);
    }
    return [...years.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([key, count]) => ({ type: 'year', key, label: key, count }));
  }
  return genreGroups().map((g) => ({ type: 'genre', key: g.key, label: g.name, count: g.ids.length }));
}

function tabLabel(type) {
  const tab = BUILDER_TABS.find((t) => t.key === type);
  return tab ? tab.label.replace(/s$/, '') : type;
}

function builderHasSource(source) {
  return builder.sources.some((s) => s.type === source.type && s.key === source.key);
}

function openBuilder(playlist) {
  builder = {
    editing: playlist ? playlist.name : null,
    name: playlist ? playlist.name : '',
    live: playlist ? playlist.live !== false : true,
    sources: playlist ? (playlist.sources || []).map((s) => ({ ...s })) : [],
    extraIds: playlist ? [...(playlist.extraIds || [])] : [],
    tab: 'genre',
    query: '',
    trackQuery: '',
    error: ''
  };
  els.builderTitle.textContent = playlist ? 'Edit playlist' : 'Playlist builder';
  els.builderOverlay.classList.remove('hidden');
  renderBuilder();
}

function closeBuilder() {
  builder = null;
  els.builderOverlay.classList.add('hidden');
}

function builderSectionTitle(text) {
  const title = document.createElement('h3');
  title.className = 'b-section';
  title.textContent = text;
  return title;
}

function renderBuilder() {
  if (!builder) return;
  const body = els.builderBody;
  body.replaceChildren();

  const head = document.createElement('div');
  head.className = 'b-head';
  const nameInput = document.createElement('input');
  nameInput.className = 'b-name';
  nameInput.type = 'text';
  nameInput.placeholder = 'Playlist name';
  nameInput.maxLength = 60;
  nameInput.value = builder.name;
  nameInput.addEventListener('input', () => { builder.name = nameInput.value; });
  const liveLabel = document.createElement('label');
  liveLabel.className = 'b-live';
  const liveBox = document.createElement('input');
  liveBox.type = 'checkbox';
  liveBox.checked = builder.live;
  liveBox.addEventListener('change', () => { builder.live = liveBox.checked; });
  const liveText = document.createElement('span');
  liveText.textContent = 'Live \u2014 update as my library changes';
  liveLabel.append(liveBox, liveText);
  head.append(nameInput, liveLabel);
  body.appendChild(head);

  if (builder.error) {
    const err = document.createElement('div');
    err.className = 'b-error';
    err.textContent = builder.error;
    body.appendChild(err);
  }

  body.appendChild(builderSectionTitle('Sources'));
  const chips = document.createElement('div');
  chips.className = 'b-chips';
  if (!builder.sources.length) {
    const hint = document.createElement('div');
    hint.className = 'b-hint';
    hint.textContent = 'Pick genres, albums, artists, eras or years below. Drag to reorder.';
    chips.appendChild(hint);
  }
  builder.sources.forEach((source, index) => {
    const chip = document.createElement('span');
    chip.className = 'b-chip';
    chip.draggable = true;
    const label = document.createElement('span');
    label.textContent = `${tabLabel(source.type)}: ${source.label}`;
    const remove = document.createElement('button');
    remove.className = 'b-chip-x';
    remove.textContent = '\u2715';
    remove.addEventListener('click', () => {
      builder.sources.splice(index, 1);
      renderBuilder();
    });
    chip.append(label, remove);
    chip.addEventListener('dragstart', (event) => {
      event.dataTransfer.setData('text/plain', String(index));
      event.dataTransfer.effectAllowed = 'move';
    });
    chip.addEventListener('dragover', (event) => event.preventDefault());
    chip.addEventListener('drop', (event) => {
      event.preventDefault();
      const from = parseInt(event.dataTransfer.getData('text/plain'), 10);
      if (!Number.isFinite(from) || from === index) return;
      const [moved] = builder.sources.splice(from, 1);
      builder.sources.splice(index, 0, moved);
      renderBuilder();
    });
    chips.appendChild(chip);
  });
  body.appendChild(chips);

  const tabs = document.createElement('div');
  tabs.className = 'b-tabs';
  for (const tab of BUILDER_TABS) {
    const btn = document.createElement('button');
    btn.className = 'b-tab' + (builder.tab === tab.key ? ' active' : '');
    btn.textContent = tab.label;
    btn.addEventListener('click', () => {
      builder.tab = tab.key;
      builder.query = '';
      renderBuilder();
    });
    tabs.appendChild(btn);
  }
  body.appendChild(tabs);

  const search = document.createElement('input');
  search.className = 'b-search';
  search.type = 'search';
  search.placeholder = `Filter ${tabLabel(builder.tab).toLowerCase()}s\u2026`;
  search.value = builder.query;
  search.addEventListener('input', () => {
    builder.query = search.value;
    renderBuilderList();
  });
  body.appendChild(search);

  const list = document.createElement('div');
  list.className = 'b-list';
  list.id = 'builder-list';
  body.appendChild(list);

  body.appendChild(builderSectionTitle('Tracks added by hand'));
  const trackSearch = document.createElement('input');
  trackSearch.className = 'b-search';
  trackSearch.type = 'search';
  trackSearch.placeholder = 'Search tracks to add\u2026';
  trackSearch.value = builder.trackQuery;
  trackSearch.addEventListener('input', () => {
    builder.trackQuery = trackSearch.value;
    renderBuilderExtras();
  });
  body.appendChild(trackSearch);

  const extras = document.createElement('div');
  extras.className = 'b-list';
  extras.id = 'builder-extras';
  body.appendChild(extras);

  const count = computeLiveTrackIds(builder).length;
  const preview = document.createElement('div');
  preview.className = 'b-preview';
  preview.textContent = `${count} track${count === 1 ? '' : 's'} in this playlist`;
  body.appendChild(preview);

  renderBuilderList();
  renderBuilderExtras();
}

function builderToggleSource(item, on) {
  if (on) {
    if (!builderHasSource(item)) {
      builder.sources.push({ type: item.type, key: item.key, label: item.label });
    }
  } else {
    builder.sources = builder.sources.filter((s) => !(s.type === item.type && s.key === item.key));
  }
  renderBuilder();
}

function renderBuilderList() {
  const wrap = els.builderBody.querySelector('#builder-list');
  if (!wrap || !builder) return;
  wrap.replaceChildren();
  const query = builder.query.trim().toLowerCase();
  let items = builderSourceItems(builder.tab);
  if (query) items = items.filter((item) => `${item.label} ${item.sub || ''}`.toLowerCase().includes(query));
  if (!items.length) {
    const hint = document.createElement('div');
    hint.className = 'b-hint';
    hint.textContent = 'Nothing to show here.';
    wrap.appendChild(hint);
    return;
  }
  for (const item of items) {
    const row = document.createElement('label');
    row.className = 'b-row';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = builderHasSource(item);
    box.addEventListener('change', () => builderToggleSource(item, box.checked));
    const name = document.createElement('span');
    name.className = 'b-row-name';
    name.textContent = item.sub ? `${item.label} \u2014 ${item.sub}` : item.label;
    const count = document.createElement('span');
    count.className = 'b-row-count';
    count.textContent = String(item.count);
    row.append(box, name, count);
    wrap.appendChild(row);
  }
}

function renderBuilderExtras() {
  const wrap = els.builderBody.querySelector('#builder-extras');
  if (!wrap || !builder) return;
  wrap.replaceChildren();
  const query = builder.trackQuery.trim().toLowerCase();
  const chosen = new Set(builder.extraIds);
  if (!query) {
    if (!builder.extraIds.length) {
      const hint = document.createElement('div');
      hint.className = 'b-hint';
      hint.textContent = 'Search above to add individual tracks.';
      wrap.appendChild(hint);
      return;
    }
    for (const id of builder.extraIds) {
      const track = trackById(id);
      if (track) wrap.appendChild(builderExtraRow(track, true));
    }
    return;
  }
  const matches = state.tracks
    .filter((track) => `${track.title} ${track.artist} ${track.album}`.toLowerCase().includes(query))
    .slice(0, 50);
  if (!matches.length) {
    const hint = document.createElement('div');
    hint.className = 'b-hint';
    hint.textContent = 'No matches.';
    wrap.appendChild(hint);
    return;
  }
  for (const track of matches) wrap.appendChild(builderExtraRow(track, chosen.has(track.id)));
}

function builderExtraRow(track, added) {
  const row = document.createElement('label');
  row.className = 'b-row';
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = added;
  box.addEventListener('change', () => {
    if (box.checked) {
      if (!builder.extraIds.includes(track.id)) builder.extraIds.push(track.id);
    } else {
      builder.extraIds = builder.extraIds.filter((id) => id !== track.id);
    }
    renderBuilder();
  });
  const name = document.createElement('span');
  name.className = 'b-row-name';
  name.textContent = `${track.title} \u2014 ${track.artist}`;
  row.append(box, name);
  return row;
}

function saveBuilder() {
  if (!builder) return;
  const name = builder.name.trim();
  if (!name) {
    builder.error = 'Give the playlist a name.';
    renderBuilder();
    return;
  }
  if (state.playlists.some((pl) => pl.name === name && pl.name !== builder.editing)) {
    builder.error = 'A playlist with that name already exists.';
    renderBuilder();
    return;
  }
  let playlist = state.playlists.find((pl) => pl.name === builder.editing);
  if (!playlist) {
    playlist = { name, trackIds: [] };
    state.playlists.push(playlist);
  }
  playlist.name = name;
  playlist.live = builder.live;
  playlist.sources = builder.sources.map((source) => ({ ...source }));
  playlist.extraIds = [...builder.extraIds];
  playlist.trackIds = computeLiveTrackIds(playlist);
  delete playlist.auto;
  if (state.view.type === 'playlist' && state.view.name === builder.editing) {
    state.view = { type: 'playlist', name };
  }
  resolvePlaylistView();
  persist();
  renderSidebar();
  renderMain();
  closeBuilder();
}

function deletePlaylist(name) {
  if (state.settings.confirmPlaylistDelete && !confirm(`Delete playlist "${name}"?`)) return;
  state.playlists = state.playlists.filter((pl) => pl.name !== name);
  if (state.view.type === 'playlist' && state.view.name === name) {
    state.view = { type: 'library' };
  }
  persist();
  renderSidebar();
  renderMain();
}

const GENRE_PREFIX = 'Genre: ';
let genreRows = [];
let lastGenreMin = 2;

function genreGroups() {
  const map = new Map();
  for (const track of state.tracks) {
    if (!track.genre || !track.genre.length) continue;
    for (const raw of track.genre) {
      const key = raw.toLowerCase();
      let group = map.get(key);
      if (!group) {
        group = { key, name: raw, ids: [] };
        map.set(key, group);
      }
      if (!group.ids.includes(track.id)) group.ids.push(track.id);
    }
  }
  return [...map.values()].sort((a, b) => b.ids.length - a.ids.length || a.name.localeCompare(b.name));
}

function closeGenrePopover() {
  els.genrePopover.classList.add('hidden');
}

function applyGenreFilter() {
  const min = Math.max(1, lastGenreMin);
  for (const row of genreRows) {
    const below = row.ids.length < min;
    row.row.classList.toggle('g-hidden', below && !row.input.checked);
    row.row.classList.toggle('g-dim', below);
  }
}

function openGenreMaker() {
  const popover = els.genrePopover;
  popover.replaceChildren();
  genreRows = [];

  const groups = genreGroups();
  const existing = new Set(
    state.playlists.filter((pl) => pl.auto).map((pl) => pl.genreKey));

  const title = document.createElement('div');
  title.className = 'g-title';
  title.textContent = 'Playlists by genre';
  popover.appendChild(title);

  if (!groups.length) {
    const empty = document.createElement('div');
    empty.className = 'g-empty';
    empty.textContent = 'No genre tags found in your library.';
    popover.appendChild(empty);
  } else {
    const minRow = document.createElement('label');
    minRow.className = 'g-min';
    const minLabel = document.createElement('span');
    minLabel.textContent = 'Min tracks';
    els.genreMin = document.createElement('input');
    els.genreMin.type = 'number';
    els.genreMin.min = '1';
    els.genreMin.value = String(lastGenreMin);
    els.genreMin.addEventListener('input', () => {
      lastGenreMin = Math.max(1, parseInt(els.genreMin.value, 10) || 1);
      applyGenreFilter();
    });
    minRow.append(minLabel, els.genreMin);
    popover.appendChild(minRow);

    const list = document.createElement('div');
    list.className = 'g-list';
    for (const group of groups) {
      const row = document.createElement('label');
      row.className = 'g-row';

      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = existing.has(group.key) || group.ids.length >= lastGenreMin;

      const name = document.createElement('span');
      name.className = 'g-name';
      name.textContent = group.name;

      const count = document.createElement('span');
      count.className = 'g-count';
      count.textContent = String(group.ids.length);

      row.append(box, name, count);
      list.appendChild(row);
      genreRows.push({ key: group.key, name: group.name, ids: group.ids, input: box, row });
    }
    popover.appendChild(list);
  }

  const footer = document.createElement('div');
  footer.className = 'g-footer';
  const createBtn = document.createElement('button');
  createBtn.className = 'accent-btn';
  createBtn.textContent = 'Create / Refresh';
  createBtn.addEventListener('click', createGenrePlaylists);
  const removeBtn = document.createElement('button');
  removeBtn.className = 'ghost-btn';
  removeBtn.textContent = 'Remove genre playlists';
  removeBtn.addEventListener('click', removeGenrePlaylists);
  footer.append(createBtn, removeBtn);
  popover.appendChild(footer);

  popover.classList.remove('hidden');
  applyGenreFilter();

  const rect = els.genreMaker.getBoundingClientRect();
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - popover.offsetWidth - 8));
  const top = Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - popover.offsetHeight - 8));
  popover.style.left = `${left}px`;
  popover.style.top = `${top}px`;
}

function resolvePlaylistView() {
  if (state.view.type === 'playlist' &&
    !state.playlists.some((pl) => pl.name === state.view.name)) {
    state.view = { type: 'library' };
  }
}

function createGenrePlaylists() {
  const min = Math.max(1, lastGenreMin);
  const selected = genreRows.filter((row) => row.ids.length >= min && row.input.checked);
  const keepKeys = new Set(selected.map((row) => row.key));

  state.playlists = state.playlists.filter((pl) => !pl.auto || keepKeys.has(pl.genreKey));

  for (const row of selected) {
    let playlist = state.playlists.find((pl) => pl.auto && pl.genreKey === row.key);
    if (!playlist) {
      playlist = { name: '', trackIds: [], auto: true, genre: row.name, genreKey: row.key };
      state.playlists.push(playlist);
    }
    playlist.name = GENRE_PREFIX + row.name;
    playlist.genre = row.name;
    playlist.trackIds = [...row.ids];
  }

  resolvePlaylistView();
  persist();
  renderSidebar();
  renderTrackList();
  closeGenrePopover();
}

function removeGenrePlaylists() {
  const count = state.playlists.filter((pl) => pl.auto).length;
  if (!count) {
    closeGenrePopover();
    return;
  }
  if (!confirm(`Remove ${count} genre playlist${count === 1 ? '' : 's'}?`)) return;
  state.playlists = state.playlists.filter((pl) => !pl.auto);
  resolvePlaylistView();
  persist();
  renderSidebar();
  renderTrackList();
  closeGenrePopover();
}

let categorizing = false;

async function handleCategorize() {
  if (categorizing) {
    window.aku.cancelCategorize();
    return;
  }
  const missing = state.tracks.filter((track) => !track.genre || !track.genre.length);
  if (!missing.length) {
    els.status.textContent = 'Every track already has a genre.';
    return;
  }
  const items = missing.map((track) => ({ id: track.id, artist: track.artist, title: track.title }));
  categorizing = true;
  els.categorizeBtn.classList.add('active');
  els.categorizeBtn.title = 'Cancel categorizing';
  els.status.textContent = `Categorizing 0 / ${items.length}\u2026`;
  try {
    const { results, cancelled } = await window.aku.categorize(items);
    let applied = 0;
    for (const entry of results) {
      const track = trackById(entry.id);
      if (track && entry.genres && entry.genres.length) {
        track.genre = entry.genres;
        applied++;
      }
    }
    recomputeLivePlaylists();
    renderMain();
    if (cancelled) {
      els.status.textContent = `Categorization cancelled \u2014 ${applied} track${applied === 1 ? '' : 's'} updated.`;
    } else if (applied) {
      els.status.textContent = `Categorized ${applied} of ${items.length} track${items.length === 1 ? '' : 's'}.`;
    } else {
      els.status.textContent = 'No genres found for the untagged tracks.';
    }
  } catch {
    els.status.textContent = 'Categorization failed.';
  } finally {
    categorizing = false;
    els.categorizeBtn.classList.remove('active');
    els.categorizeBtn.title = 'Find genres by artist and title';
  }
}

const THEME_SWATCH = {
  red: ['#000000', '#830000', '#bc0202', '#ff0000'],
  teal: ['#212121', '#323232', '#0d7377', '#14ffec'],
  ocean: ['#0a2647', '#144272', '#205295', '#4a9ee8'],
  sage: ['#040d12', '#183d3d', '#5c8374', '#93b1a6'],
  forest: ['#2c3639', '#3f4e4f', '#a27b5c', '#dcd7c9'],
  regal: ['#000000', '#8e1616', '#e8c999', '#f8eedf'],
  terracotta: ['#524646', '#a8a492', '#ec5b38', '#fcf2e5']
};

function applyTheme() {
  document.documentElement.dataset.theme = state.settings.theme;
}

function applySidebar() {
  const root = document.documentElement;
  const auto = state.settings.sidebarAutoHide;
  root.dataset.autohide = auto ? 'on' : 'off';
  if (!auto) {
    els.sidebarToggle.classList.add('hidden');
    root.dataset.sidebar = 'open';
    root.classList.remove('sidebar-peek');
    return;
  }
  els.sidebarToggle.classList.remove('hidden');
  root.dataset.sidebar = state.sidebarPinned ? 'open' : 'hidden';
  if (state.sidebarPinned) root.classList.remove('sidebar-peek');
}

function applySettings() {
  const s = state.settings;
  applyTheme();
  applySidebar();
  const display = s.rowDisplay || 'comfortable';
  document.documentElement.dataset.cover = display === 'no-covers' ? 'off' : 'on';
  document.documentElement.dataset.density = display === 'compact' ? 'compact' : 'normal';
  document.documentElement.dataset.favorites = s.favorites ? 'on' : 'off';
  els.categorizeBtn.classList.toggle('hidden', !s.genreTools);
  els.genreMaker.classList.toggle('hidden', !s.genreTools);
  els.qualityBtn.classList.toggle('hidden', !s.qualityIndicator);
  els.shuffleBtn.classList.toggle('hidden', !s.shuffleRepeat);
  els.repeatBtn.classList.toggle('hidden', !s.shuffleRepeat);
  if (!s.qualityIndicator) closeQualityPopover();
  if (!s.genreTools) closeGenrePopover();

  if (!s.browseSections &&
    ['albums', 'artists', 'genres', 'eras', 'album', 'artist', 'genre', 'era'].includes(state.view.type)) {
    state.view = { type: 'library' };
  }
  if (!s.favorites && state.view.type === 'favorites') {
    state.view = { type: 'library' };
  }

  renderSidebar();
  renderMain();
  applyMiniWindow();
  broadcastState(true);
}

function setSetting(key, value) {
  state.settings[key] = value;
  if (key === 'miniStartCube') {
    state.miniMode = value ? 'cube' : 'full';
  }
  persist();
  applySettings();
  renderSettings();
}

function settingsSections() {
  return [
    { title: 'Appearance', rows: [{ type: 'theme' }] },
    {
      title: 'Sidebar',
      rows: [{
        type: 'toggle', key: 'sidebarAutoHide', label: 'Auto-hide sidebar',
        hint: 'Reveal by hovering the left edge; pin with the menu button'
      }]
    },
    {
      title: 'Library',
      rows: [
        { type: 'sources' },
        { type: 'dedupe' },
        { type: 'duplicates' },
        { type: 'hidden' },
        { type: 'toggle', key: 'browseSections', label: 'Browse sections', hint: 'Albums, Artists, Genres, Eras' },
        { type: 'toggle', key: 'genreTools', label: 'Genre tools', hint: 'Genre playlists and online categorizer' },
        { type: 'toggle', key: 'favorites', label: 'Favorites' },
        { type: 'toggle', key: 'qualityIndicator', label: 'Quality indicator' },
        {
          type: 'segment', key: 'rowDisplay', label: 'Track rows',
          options: [['comfortable', 'Comfortable'], ['compact', 'Compact'], ['no-covers', 'No covers']]
        }
      ]
    },
    {
      title: 'Playback',
      rows: [
        { type: 'toggle', key: 'resumePlayback', label: 'Resume playback', hint: 'Restore the last track position on launch' },
        { type: 'toggle', key: 'confirmPlaylistDelete', label: 'Confirm playlist delete' },
        { type: 'toggle', key: 'shuffleRepeat', label: 'Shuffle / repeat buttons' }
      ]
    },
    {
      title: 'Mini player',
      rows: [
        { type: 'segment', key: 'miniStyle', label: 'Style', options: [['bar', 'Bar'], ['card', 'Card'], ['minimal', 'Minimal']] },
        { type: 'toggle', key: 'miniSeek', label: 'Seek bar' },
        { type: 'toggle', key: 'miniVolume', label: 'Volume bar' },
        { type: 'toggle', key: 'miniStartCube', label: 'Start minimized to cube' },
        { type: 'toggle', key: 'miniAlwaysOnTop', label: 'Always on top' }
      ]
    }
  ];
}

function buildThemeRow() {
  const wrap = document.createElement('div');
  wrap.className = 'theme-row';
  for (const theme of THEMES) {
    const btn = document.createElement('button');
    btn.className = 'theme-swatch' + (state.settings.theme === theme.key ? ' active' : '');
    btn.title = theme.name;
    const strip = document.createElement('span');
    strip.className = 'swatch-colors';
    for (const color of THEME_SWATCH[theme.key]) {
      const dot = document.createElement('span');
      dot.style.background = color;
      strip.appendChild(dot);
    }
    const name = document.createElement('span');
    name.className = 'swatch-name';
    name.textContent = theme.name;
    btn.append(strip, name);
    btn.addEventListener('click', () => setSetting('theme', theme.key));
    wrap.appendChild(btn);
  }
  return wrap;
}

function buildToggleRow(row) {
  const label = document.createElement('label');
  label.className = 'set-row';
  const text = document.createElement('span');
  text.className = 'set-label';
  text.textContent = row.label;
  if (row.hint) {
    const hint = document.createElement('span');
    hint.className = 'set-hint';
    hint.textContent = row.hint;
    text.appendChild(hint);
  }
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.className = 'switch';
  input.checked = !!state.settings[row.key];
  input.addEventListener('change', () => setSetting(row.key, input.checked));
  label.append(text, input);
  return label;
}

function buildSegmentRow(row) {
  const wrap = document.createElement('div');
  wrap.className = 'set-row set-row-top';
  const text = document.createElement('span');
  text.className = 'set-label';
  text.textContent = row.label;
  const seg = document.createElement('div');
  seg.className = 'seg';
  for (const [value, name] of row.options) {
    const btn = document.createElement('button');
    btn.textContent = name;
    btn.classList.toggle('active', state.settings[row.key] === value);
    btn.addEventListener('click', () => setSetting(row.key, value));
    seg.appendChild(btn);
  }
  wrap.append(text, seg);
  return wrap;
}

function buildSourcesRow() {
  const wrap = document.createElement('div');
  wrap.className = 'sources-row';
  const title = document.createElement('div');
  title.className = 'sources-title';
  title.textContent = `Music sources (${state.sources.length})`;
  wrap.appendChild(title);
  if (!state.sources.length) {
    const empty = document.createElement('div');
    empty.className = 'set-hint';
    empty.textContent = 'No sources yet. Add a folder or some files.';
    wrap.appendChild(empty);
  }
  for (const source of state.sources) {
    const row = document.createElement('div');
    row.className = 'source-item';
    const icon = document.createElement('span');
    icon.className = 'source-icon';
    icon.textContent = source.type === 'file' ? '\u266B' : '\u25A0';
    const path = document.createElement('span');
    path.className = 'source-path';
    path.textContent = source.path;
    path.title = source.path;
    const remove = document.createElement('button');
    remove.className = 'ghost-btn source-remove';
    remove.textContent = 'Remove';
    remove.addEventListener('click', () => removeSource(source.path));
    row.append(icon, path, remove);
    wrap.appendChild(row);
  }
  const actions = document.createElement('div');
  actions.className = 'sources-actions';
  const addFolder = document.createElement('button');
  addFolder.className = 'accent-btn';
  addFolder.textContent = 'Add folder';
  addFolder.addEventListener('click', () => addSource('folder'));
  const addFiles = document.createElement('button');
  addFiles.className = 'ghost-btn';
  addFiles.textContent = 'Add files';
  addFiles.addEventListener('click', () => addSource('file'));
  actions.append(addFolder, addFiles);
  wrap.appendChild(actions);
  return wrap;
}

// Dedupe is stored in config.json (main scans with it), so it can't ride the
// normal settings toggle row; the checkbox reflects state.dedupe instead.
function buildDedupeRow() {
  const label = document.createElement('label');
  label.className = 'set-row';
  const text = document.createElement('span');
  text.className = 'set-label';
  text.textContent = 'Ignore duplicate songs';
  const hint = document.createElement('span');
  hint.className = 'set-hint';
  hint.textContent = 'Keeps the best-quality copy of the same title and artist';
  text.appendChild(hint);
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.className = 'switch';
  input.checked = state.dedupe;
  input.addEventListener('change', () => setDedupe(input.checked));
  label.append(text, input);
  return label;
}

function buildHiddenRow() {
  const wrap = document.createElement('div');
  wrap.className = 'sources-row';
  const title = document.createElement('div');
  title.className = 'sources-title';
  title.textContent = `Hidden songs (${state.hidden.length})`;
  wrap.appendChild(title);
  if (!state.hidden.length) {
    const empty = document.createElement('div');
    empty.className = 'set-hint';
    empty.textContent = 'No songs removed. Use the \u2298 button on a track to take it out of the library.';
    wrap.appendChild(empty);
    return wrap;
  }
  for (const entry of state.hidden) {
    const row = document.createElement('div');
    row.className = 'source-item';
    const icon = document.createElement('span');
    icon.className = 'source-icon';
    icon.textContent = '\u2298';
    const label = document.createElement('span');
    label.className = 'source-path';
    label.textContent = [entry.artist, entry.title].filter(Boolean).join(' \u2014 ') || entry.path;
    label.title = entry.path;
    const restore = document.createElement('button');
    restore.className = 'ghost-btn source-remove';
    restore.textContent = 'Restore';
    restore.addEventListener('click', () => restoreTracks([entry.path]));
    row.append(icon, label, restore);
    wrap.appendChild(row);
  }
  const actions = document.createElement('div');
  actions.className = 'sources-actions';
  const all = document.createElement('button');
  all.className = 'ghost-btn';
  all.textContent = 'Restore all';
  all.addEventListener('click', restoreAllHidden);
  actions.appendChild(all);
  wrap.appendChild(actions);
  return wrap;
}

// Duplicates are only ignored automatically; "Restore" pins a copy so it stays
// even though it looks like another track, and "Ignore again" unpins it. The
// list lives in its own overlay so it doesn't bloat the Settings panel.
function buildDuplicatesRow() {
  const wrap = document.createElement('div');
  wrap.className = 'set-row set-row-top';
  const text = document.createElement('span');
  text.className = 'set-label';
  text.textContent = 'Duplicates';
  const hint = document.createElement('span');
  hint.className = 'set-hint';
  hint.textContent = state.dedupe
    ? `${state.ignored.length} ignored, ${state.dupesKept.length} restored`
    : 'Ignoring is off \u2014 every copy shows';
  text.appendChild(hint);
  const manage = document.createElement('button');
  manage.className = 'ghost-btn';
  manage.textContent = 'Manage duplicates\u2026';
  manage.addEventListener('click', openDuplicates);
  wrap.append(text, manage);
  return wrap;
}

function openDuplicates() {
  renderDuplicates();
  els.dupesOverlay.classList.remove('hidden');
}

function closeDuplicates() {
  els.dupesOverlay.classList.add('hidden');
}

function renderDuplicates() {
  els.dupesBody.replaceChildren();

  if (!state.ignored.length && !state.dupesKept.length) {
    const empty = document.createElement('div');
    empty.className = 'set-hint';
    empty.textContent = 'No duplicates ignored. Songs are matched on the same title and artist.';
    els.dupesBody.appendChild(empty);
    return;
  }

  const heading = (label) => {
    const title = document.createElement('div');
    title.className = 'sources-title';
    title.textContent = label;
    return title;
  };

  els.dupesBody.appendChild(heading(`Ignored duplicates (${state.ignored.length})`));
  if (!state.ignored.length) {
    const none = document.createElement('div');
    none.className = 'set-hint';
    none.textContent = 'Nothing ignored right now.';
    els.dupesBody.appendChild(none);
  }
  for (const entry of state.ignored) {
    const row = document.createElement('div');
    row.className = 'source-item';
    const icon = document.createElement('span');
    icon.className = 'source-icon';
    icon.textContent = '\u29C9';
    const text = document.createElement('div');
    text.className = 'dup-text';
    const primary = document.createElement('span');
    primary.className = 'dup-name';
    primary.textContent = [entry.artist, entry.title].filter(Boolean).join(' \u2014 ');
    const kept = document.createElement('span');
    kept.className = 'dup-kept';
    kept.textContent = entry.keptTitle
      ? `Ignored in favour of ${[entry.keptArtist, entry.keptTitle].filter(Boolean).join(' \u2014 ')}`
      : 'Ignored as a duplicate';
    text.append(primary, kept);
    const restore = document.createElement('button');
    restore.className = 'ghost-btn source-remove';
    restore.textContent = 'Restore';
    restore.addEventListener('click', () => restoreDuplicates([entry.id]));
    row.append(icon, text, restore);
    els.dupesBody.appendChild(row);
  }
  if (state.ignored.length) {
    const actions = document.createElement('div');
    actions.className = 'sources-actions';
    const all = document.createElement('button');
    all.className = 'ghost-btn';
    all.textContent = 'Restore all';
    all.addEventListener('click', restoreAllDuplicates);
    actions.appendChild(all);
    els.dupesBody.appendChild(actions);
  }

  const keptHeading = heading(`Restored duplicates (${state.dupesKept.length})`);
  keptHeading.classList.add('dup-kept-title');
  els.dupesBody.appendChild(keptHeading);
  if (!state.dupesKept.length) {
    const none = document.createElement('div');
    none.className = 'set-hint';
    none.textContent = 'None restored. Restore an ignored copy to keep it.';
    els.dupesBody.appendChild(none);
  }
  for (const entry of state.dupesKept) {
    const row = document.createElement('div');
    row.className = 'source-item';
    const icon = document.createElement('span');
    icon.className = 'source-icon';
    icon.textContent = '\u2714';
    const text = document.createElement('div');
    text.className = 'dup-text';
    const primary = document.createElement('span');
    primary.className = 'dup-name';
    primary.textContent = [entry.artist, entry.title].filter(Boolean).join(' \u2014 ');
    text.appendChild(primary);
    const ignore = document.createElement('button');
    ignore.className = 'ghost-btn source-remove';
    ignore.textContent = 'Ignore again';
    ignore.addEventListener('click', () => ignoreDuplicates([entry.id]));
    row.append(icon, text, ignore);
    els.dupesBody.appendChild(row);
  }
}

function renderSettings() {
  els.settingsBody.replaceChildren();
  for (const section of settingsSections()) {
    const sec = document.createElement('section');
    sec.className = 'set-section';
    const title = document.createElement('h2');
    title.className = 'set-title';
    title.textContent = section.title;
    sec.appendChild(title);
    for (const row of section.rows) {
      if (row.type === 'theme') sec.appendChild(buildThemeRow());
      else if (row.type === 'toggle') sec.appendChild(buildToggleRow(row));
      else if (row.type === 'segment') sec.appendChild(buildSegmentRow(row));
      else if (row.type === 'sources') sec.appendChild(buildSourcesRow());
      else if (row.type === 'dedupe') sec.appendChild(buildDedupeRow());
      else if (row.type === 'duplicates') sec.appendChild(buildDuplicatesRow());
      else if (row.type === 'hidden') sec.appendChild(buildHiddenRow());
    }
    els.settingsBody.appendChild(sec);
  }
}

function openSettings() {
  renderSettings();
  els.settingsOverlay.classList.remove('hidden');
}

function closeSettings() {
  els.settingsOverlay.classList.add('hidden');
}

function wireEvents() {
  document.querySelectorAll('.nav-item').forEach((item) => {
    item.addEventListener('click', () => setView({ type: item.dataset.view }));
  });

  els.chooseFolder.addEventListener('click', () => openAddMenu(els.chooseFolder));

  els.search.addEventListener('input', () => {
    state.search = els.search.value;
    renderMain();
  });

  els.trackList.addEventListener('click', (event) => {
    const row = event.target.closest('.track-row');
    if (!row) return;
    const id = row.dataset.id;
    if (event.target.closest('.fav-btn')) {
      toggleFavorite(id);
      return;
    }
    if (event.target.closest('.add-btn')) {
      openPlaylistMenu([id], event.target.closest('.add-btn'));
      return;
    }
    if (event.target.closest('.hide-btn')) {
      hideTracks([id]);
      return;
    }
    // Ctrl/Cmd and Shift clicks build a multi-track selection; a plain click
    // still starts playback so the single-click-to-play behaviour is intact.
    if (event.shiftKey && state.selAnchor) {
      selectRange(state.selAnchor, id, event.ctrlKey || event.metaKey);
      return;
    }
    if (event.ctrlKey || event.metaKey) {
      toggleSelection(id);
      return;
    }
    clearSelection();
    playTrack(id);
  });

  document.addEventListener('click', (event) => {
    if (!els.rowMenu.classList.contains('hidden') &&
      !event.target.closest('#row-menu') &&
      !event.target.closest('.add-btn') &&
      !els.selBar.contains(event.target)) {
      closeRowMenu();
    }
    if (!els.addMenu.classList.contains('hidden') &&
      !event.target.closest('#add-menu') &&
      !event.target.closest('#choose-folder')) {
      closeAddMenu();
    }
    if (!els.qualityPopover.classList.contains('hidden') &&
      !event.target.closest('#quality-popover') &&
      !event.target.closest('#quality-btn')) {
      closeQualityPopover();
    }
    if (!els.genrePopover.classList.contains('hidden') &&
      !event.target.closest('#genre-popover') &&
      !event.target.closest('#genre-maker')) {
      closeGenrePopover();
    }
  });

  els.qualityBtn.addEventListener('click', () => {
    if (els.qualityPopover.classList.contains('hidden')) openQualityPopover();
    else closeQualityPopover();
  });

  els.newPlaylist.addEventListener('click', () => startNewPlaylist(null));
  els.playlistBuilder.addEventListener('click', () => openBuilder(null));
  els.genreMaker.addEventListener('click', () => {
    if (els.genrePopover.classList.contains('hidden')) openGenreMaker();
    else closeGenrePopover();
  });
  els.categorizeBtn.addEventListener('click', handleCategorize);

  els.queueBtn.addEventListener('click', () => toggleQueue());
  els.queueClose.addEventListener('click', () => toggleQueue(false));

  els.builderClose.addEventListener('click', closeBuilder);
  els.builderSave.addEventListener('click', saveBuilder);
  els.builderOverlay.addEventListener('click', (event) => {
    if (event.target === els.builderOverlay) closeBuilder();
  });

  els.settingsBtn.addEventListener('click', openSettings);
  els.settingsClose.addEventListener('click', closeSettings);
  els.settingsOverlay.addEventListener('click', (event) => {
    if (event.target === els.settingsOverlay) closeSettings();
  });

  els.dupesClose.addEventListener('click', closeDuplicates);
  els.dupesOverlay.addEventListener('click', (event) => {
    if (event.target === els.dupesOverlay) closeDuplicates();
  });

  els.sidebarToggle.addEventListener('click', () => {
    state.sidebarPinned = !state.sidebarPinned;
    persist();
    applySidebar();
  });
  els.sidebarHandle.addEventListener('mouseenter', () => {
    if (!state.settings.sidebarAutoHide || state.sidebarPinned) return;
    document.documentElement.classList.add('sidebar-peek');
  });
  els.sidebar.addEventListener('mouseenter', () => {
    if (!state.settings.sidebarAutoHide || state.sidebarPinned) return;
    document.documentElement.classList.add('sidebar-peek');
  });
  els.sidebar.addEventListener('mouseleave', () => {
    document.documentElement.classList.remove('sidebar-peek');
  });

  els.newPlaylistInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') finishNewPlaylist();
    if (event.key === 'Escape') {
      pendingPlaylistIds = [];
      els.newPlaylistRow.classList.add('hidden');
    }
  });

  els.playBtn.addEventListener('click', togglePlay);
  els.prevBtn.addEventListener('click', playPrev);
  els.nextBtn.addEventListener('click', () => playNext(false));

  els.miniBtn.addEventListener('click', async () => {
    if (miniOpen) {
      window.aku.closeMiniplayer();
      return;
    }
    if (state.settings.miniStartCube) state.miniMode = 'cube';
    else state.miniMode = 'full';
    await window.aku.openMiniplayer();
    applyMiniWindow();
    broadcastState(true);
  });

  els.shuffleBtn.addEventListener('click', () => {
    state.shuffle = !state.shuffle;
    if (state.queue.length) {
      const base = state.queueOrigin.length ? state.queueOrigin : state.queue;
      state.queue = state.shuffle ? shuffledFrom(base, state.currentId) : base.slice();
      if (state.queueOpen) renderQueue();
    }
    persist();
    updatePlayerBar();
    broadcastState(true);
  });

  els.repeatBtn.addEventListener('click', () => {
    state.repeat = state.repeat === 'off' ? 'all' : state.repeat === 'all' ? 'one' : 'off';
    persist();
    updatePlayerBar();
  });

  els.seek.addEventListener('input', () => {
    seekDragging = true;
    const duration = audio.duration || 0;
    els.timeCurrent.textContent = fmtTime((els.seek.value / 1000) * duration);
  });

  els.seek.addEventListener('change', () => {
    if (audio.duration && Number.isFinite(audio.duration)) {
      audio.currentTime = (els.seek.value / 1000) * audio.duration;
    }
    seekDragging = false;
    broadcastState(true);
  });

  els.volume.addEventListener('input', () => setVolume(els.volume.value / 100));

  audio.addEventListener('timeupdate', () => {
    if (!seekDragging) updateSeek();
    state.lastPosition = audio.currentTime || 0;
    broadcastState(false);
  });
  audio.addEventListener('loadedmetadata', () => {
    if (pendingResume !== null) {
      if (audio.duration && Number.isFinite(audio.duration)) {
        audio.currentTime = Math.min(pendingResume, audio.duration);
      }
      pendingResume = null;
    }
    updateSeek();
    broadcastState(true);
  });
  audio.addEventListener('play', () => {
    updatePlayerBar();
    broadcastState(true);
  });
  audio.addEventListener('pause', () => {
    updatePlayerBar();
    broadcastState(true);
  });

  audio.addEventListener('ended', () => {
    if (state.repeat === 'one') {
      audio.currentTime = 0;
      audio.play().catch(() => {});
      return;
    }
    playNext(true);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !els.builderOverlay.classList.contains('hidden')) {
      closeBuilder();
      return;
    }
    if (event.key === 'Escape' && !els.settingsOverlay.classList.contains('hidden')) {
      closeSettings();
      return;
    }
    if (event.key === 'Escape' && !els.dupesOverlay.classList.contains('hidden')) {
      closeDuplicates();
      return;
    }
    const tag = (event.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || event.target.isContentEditable) {
      return;
    }
    if (event.key === ' ') {
      event.preventDefault();
      togglePlay();
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      if (event.ctrlKey) playNext(false);
      else seekBy(5);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      if (event.ctrlKey) playPrev();
      else seekBy(-5);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setVolume(state.volume + 0.05);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      setVolume(state.volume - 0.05);
    }
  });

  window.addEventListener('beforeunload', persist);
}

async function loadLibrary() {
  const result = await window.aku.getLibrary();
  if (!result) {
    updateStatus();
    renderMain();
    return;
  }
  state.sources = result.sources || [];
  state.tracks = result.tracks || [];
  state.dedupe = result.dedupe !== false;
  state.hidden = Array.isArray(result.hidden) ? result.hidden : [];
  state.duplicates = Number(result.duplicates) || 0;
  state.ignored = Array.isArray(result.ignored) ? result.ignored : [];
  state.dupesKept = Array.isArray(result.dupesKept) ? result.dupesKept : [];
  recomputeLivePlaylists();
  if (state.lastTrackId && trackById(state.lastTrackId)) {
    state.currentId = state.lastTrackId;
  }
  if (state.settings.resumePlayback && state.currentId) {
    const track = trackById(state.currentId);
    if (track) {
      // Load the track but stay paused; the position is applied once metadata
      // is ready (see the loadedmetadata handler) so we don't autoplay.
      buildQueue(state.tracks.map((t) => t.id), state.currentId);
      audio.src = track.src;
      pendingResume = state.lastPosition || 0;
      audio.load();
    }
  }
  updateStatus();
  updatePlayerBar();
  renderSidebar();
  renderMain();
}

async function init() {
  initEls();
  restore();
  wireEvents();
  applySettings();
  setVolume(state.volume);
  updatePlayerBar();

  if (!window.aku) {
    els.status.textContent = 'Preload API unavailable.';
    return;
  }

  window.aku.onScanProgress(({ done, total }) => {
    els.status.textContent = `Scanning ${done} / ${total}\u2026`;
  });

  window.aku.onPlayerCommand(handlePlayerCommand);

  window.aku.onMiniplayerChanged((open) => {
    miniOpen = open;
    els.miniBtn.classList.toggle('active', open);
    if (open) applyMiniWindow();
  });

  window.aku.onCategorizeProgress(({ done, total }) => {
    if (categorizing) els.status.textContent = `Categorizing ${done} / ${total}\u2026`;
  });

  await loadLibrary();
}

init();
