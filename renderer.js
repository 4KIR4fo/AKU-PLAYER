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
  { key: 'sage', name: 'Sage' }
];

const audio = new Audio();
let seekDragging = false;
let pendingPlaylistTrackId = null;
let qualityPopoverTrackId;

const state = {
  folder: null,
  tracks: [],
  view: { type: 'library' },
  search: '',
  favorites: new Set(),
  playlists: [],
  queue: [],
  currentId: null,
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
  els.status = $('status');
  els.viewTitle = $('view-title');
  els.playlistList = $('playlist-list');
  els.newPlaylist = $('new-playlist');
  els.newPlaylistRow = $('new-playlist-row');
  els.newPlaylistInput = $('new-playlist-input');
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
  els.sidebarToggle = $('sidebar-toggle');
  els.sidebarHandle = $('sidebar-handle');
  els.sidebar = $('sidebar');
  els.settingsBtn = $('settings-btn');
  els.settingsOverlay = $('settings-overlay');
  els.settingsBody = $('settings-body');
  els.settingsClose = $('settings-close');
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
    const ids = playlist ? playlist.trackIds : [];
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
    }

    const del = document.createElement('button');
    del.className = 'delete-playlist';
    del.title = 'Delete playlist';
    del.textContent = '\u2715';

    li.append(name, del);
    li.addEventListener('click', () => setView({ type: 'playlist', name: playlist.name }));
    del.addEventListener('click', (event) => {
      event.stopPropagation();
      deletePlaylist(playlist.name);
    });
    els.playlistList.appendChild(li);
  }

  updateViewTitle();
}

function updateStatus() {
  if (state.folder) {
    els.status.textContent = `${state.tracks.length} tracks \u2014 ${state.folder}`;
  } else {
    els.status.textContent = '';
  }
}

function buildRow(track) {
  const row = document.createElement('div');
  row.className = 'track-row' + (track.id === state.currentId ? ' playing' : '');
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

  actions.append(fav, add);
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
    if (!state.folder) {
      empty.textContent = 'No music yet. Pick a folder and AKU will index what it finds.';
      const btn = document.createElement('button');
      btn.className = 'accent-btn';
      btn.textContent = 'Choose music folder';
      btn.addEventListener('click', chooseFolder);
      empty.appendChild(document.createElement('br'));
      empty.appendChild(btn);
    } else if (state.search.trim()) {
      empty.textContent = 'Nothing matched your search.';
    } else if (state.view.type === 'favorites') {
      empty.textContent = 'No favorites yet. Click the heart on any track.';
    } else if (state.view.type === 'playlist') {
      empty.textContent = 'This playlist is empty. Use the + button on a track to add it.';
    } else if (['album', 'artist', 'genre', 'era'].includes(state.view.type)) {
      empty.textContent = 'No tracks in here yet.';
    } else {
      empty.textContent = 'No audio files found in this folder.';
    }
    els.trackList.appendChild(empty);
  } else {
    const fragment = document.createDocumentFragment();
    for (const track of tracks) fragment.appendChild(buildRow(track));
    els.trackList.replaceChildren(fragment);
  }

  els.trackList.scrollTop = scrollTop;
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

function playTrack(id, listIds) {
  const track = trackById(id);
  if (!track) return;
  const ids = listIds && listIds.length ? listIds : visibleTracks().map((t) => t.id);
  state.queue = ids;
  state.currentId = id;
  state.lastPosition = 0;
  audio.src = track.src;
  audio.play().catch(() => {});
  persist();
  updatePlayerBar();
  renderTrackList();
  broadcastState(true);
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
  let nextId = null;
  if (state.shuffle) {
    if (queue.length === 1) {
      nextId = queue[0];
    } else {
      do {
        nextId = queue[Math.floor(Math.random() * queue.length)];
      } while (nextId === state.currentId);
    }
  } else if (index === -1 || index === queue.length - 1) {
    nextId = auto && state.repeat === 'off' ? null : queue[0];
  } else {
    nextId = queue[index + 1];
  }
  if (nextId === null) {
    updatePlayerBar();
    return;
  }
  playTrack(nextId, queue);
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
  playTrack(prevId, queue);
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

function chooseFolder() {
  els.status.textContent = 'Waiting for folder selection\u2026';
  window.aku.chooseFolder().then((result) => {
    if (!result) {
      updateStatus();
      return;
    }
    state.folder = result.folder;
    state.tracks = result.tracks;
    if (state.currentId && !trackById(state.currentId)) {
      state.currentId = null;
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }
    updateStatus();
    updatePlayerBar();
    renderMain();
  });
}

function closeRowMenu() {
  els.rowMenu.classList.add('hidden');
}

function openRowMenu(trackId, anchor) {
  const menu = els.rowMenu;
  menu.replaceChildren();

  for (const playlist of state.playlists) {
    const item = document.createElement('button');
    item.className = 'menu-item';
    const check = document.createElement('span');
    check.className = 'check';
    check.textContent = playlist.trackIds.includes(trackId) ? '\u2713' : '';
    const name = document.createElement('span');
    name.className = 'menu-name';
    name.textContent = playlist.name;
    item.append(check, name);
    item.addEventListener('click', () => {
      togglePlaylistMembership(playlist.name, trackId);
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
    startNewPlaylist(trackId);
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

function startNewPlaylist(trackId) {
  pendingPlaylistTrackId = trackId || null;
  els.newPlaylistRow.classList.remove('hidden');
  els.newPlaylistInput.value = '';
  els.newPlaylistInput.focus();
}

function finishNewPlaylist() {
  const name = els.newPlaylistInput.value.trim();
  els.newPlaylistRow.classList.add('hidden');
  els.newPlaylistInput.value = '';
  const trackId = pendingPlaylistTrackId;
  pendingPlaylistTrackId = null;
  if (!name) return;
  let playlist = state.playlists.find((pl) => pl.name === name);
  if (!playlist) {
    playlist = { name, trackIds: [] };
    state.playlists.push(playlist);
  }
  if (trackId && !playlist.trackIds.includes(trackId)) {
    playlist.trackIds.push(trackId);
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
  const index = playlist.trackIds.indexOf(trackId);
  if (index === -1) playlist.trackIds.push(trackId);
  else playlist.trackIds.splice(index, 1);
  persist();
  if (state.view.type === 'playlist' && state.view.name === name) {
    renderTrackList();
  }
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
  sage: ['#040d12', '#183d3d', '#5c8374', '#93b1a6']
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

  els.chooseFolder.addEventListener('click', chooseFolder);

  els.search.addEventListener('input', () => {
    state.search = els.search.value;
    renderMain();
  });

  els.trackList.addEventListener('click', (event) => {
    const row = event.target.closest('.track-row');
    if (!row) return;
    if (event.target.closest('.fav-btn')) {
      toggleFavorite(row.dataset.id);
      return;
    }
    if (event.target.closest('.add-btn')) {
      openRowMenu(row.dataset.id, event.target.closest('.add-btn'));
      return;
    }
    playTrack(row.dataset.id);
  });

  document.addEventListener('click', (event) => {
    if (!els.rowMenu.classList.contains('hidden') &&
      !event.target.closest('#row-menu') &&
      !event.target.closest('.add-btn')) {
      closeRowMenu();
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
  els.genreMaker.addEventListener('click', () => {
    if (els.genrePopover.classList.contains('hidden')) openGenreMaker();
    else closeGenrePopover();
  });
  els.categorizeBtn.addEventListener('click', handleCategorize);

  els.settingsBtn.addEventListener('click', openSettings);
  els.settingsClose.addEventListener('click', closeSettings);
  els.settingsOverlay.addEventListener('click', (event) => {
    if (event.target === els.settingsOverlay) closeSettings();
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
      pendingPlaylistTrackId = null;
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
    persist();
    updatePlayerBar();
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
    if (event.key === 'Escape' && !els.settingsOverlay.classList.contains('hidden')) {
      closeSettings();
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
  state.folder = result.folder;
  state.tracks = result.tracks;
  if (state.lastTrackId && trackById(state.lastTrackId)) {
    state.currentId = state.lastTrackId;
  }
  if (state.settings.resumePlayback && state.currentId) {
    const track = trackById(state.currentId);
    if (track) {
      // Load the track but stay paused; the position is applied once metadata
      // is ready (see the loadedmetadata handler) so we don't autoplay.
      audio.src = track.src;
      pendingResume = state.lastPosition || 0;
      audio.load();
    }
  }
  updateStatus();
  updatePlayerBar();
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
