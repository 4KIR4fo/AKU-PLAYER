// The mini player is a remote control, not a second player: the audio element
// lives in the main window. Buttons here send player-command messages through
// main, and the main window pushes player-state back for us to render.
const els = {};
let draggingSeek = false;
let draggingVolume = false;
let lastState = null;

function $(id) {
  return document.getElementById(id);
}

function initEls() {
  els.mini = $('mini');
  els.cover = $('mini-cover');
  els.title = $('mini-title');
  els.artist = $('mini-artist');
  els.play = $('mini-play');
  els.playIcon = $('mini-play-icon');
  els.next = $('mini-next');
  els.cube = $('mini-cube');
  els.close = $('mini-close');
  els.seekRow = $('mini-seek-row');
  els.seek = $('mini-seek');
  els.volumeRow = $('mini-volume-row');
  els.volume = $('mini-volume');
}

function applyTheme(theme) {
  if (theme) document.documentElement.dataset.theme = theme;
}

function applyLayout(state) {
  const cube = state.miniMode === 'cube';
  els.mini.classList.remove('mini-bar', 'mini-card', 'mini-minimal', 'mini-cube');
  els.mini.classList.add(cube ? 'mini-cube' : `mini-${state.miniStyle || 'bar'}`);
  const showBars = !cube;
  els.seekRow.classList.toggle('hidden', !(showBars && state.miniSeek));
  els.volumeRow.classList.toggle('hidden', !(showBars && state.miniVolume));
}

function renderState(state) {
  lastState = state;
  const cube = state.miniMode === 'cube';
  applyTheme(state.theme);
  applyLayout(state);

  const hasTrack = !!state.id;
  els.title.textContent = state.title || 'Nothing playing';
  els.artist.textContent = hasTrack
    ? [state.artist, state.album].filter(Boolean).join(' \u2014 ')
    : '';
  els.playIcon.setAttribute('href', state.playing ? '#icon-pause' : '#icon-play');
  els.play.disabled = !hasTrack;
  els.next.disabled = !hasTrack;
  els.cover.title = cube ? 'Expand mini player' : 'Minimize to cube';

  els.cover.replaceChildren();
  if (state.cover) {
    const img = document.createElement('img');
    img.src = state.cover;
    img.addEventListener('error', () => {
      img.remove();
      els.cover.textContent = '\u266A';
    });
    els.cover.appendChild(img);
  } else {
    els.cover.textContent = '\u266A';
  }

  const duration = state.duration || 0;
  if (!draggingSeek) {
    els.seek.disabled = !duration;
    els.seek.value = duration ? Math.round((state.currentTime / duration) * 1000) : 0;
  }
  if (!draggingVolume) {
    els.volume.value = Math.round((state.volume || 0) * 100);
  }
}

function sendMiniMode(mode) {
  window.akuMini.sendCommand({ type: 'mini-mode', mode });
}

function wireEvents() {
  els.play.addEventListener('click', () => window.akuMini.sendCommand({ type: 'toggle-play' }));
  els.next.addEventListener('click', () => window.akuMini.sendCommand({ type: 'next' }));
  els.close.addEventListener('click', () => window.akuMini.close());
  els.cube.addEventListener('click', () => sendMiniMode('cube'));
  els.cover.addEventListener('click', () => {
    if (lastState && lastState.miniMode === 'cube') sendMiniMode('full');
  });

  els.seek.addEventListener('input', () => {
    draggingSeek = true;
    window.akuMini.sendCommand({ type: 'seek', value: els.seek.value / 1000 });
  });
  els.seek.addEventListener('change', () => {
    draggingSeek = false;
  });
  els.seek.addEventListener('pointerup', () => {
    draggingSeek = false;
  });

  els.volume.addEventListener('input', () => {
    draggingVolume = true;
    window.akuMini.sendCommand({ type: 'volume', value: els.volume.value / 100 });
  });
  els.volume.addEventListener('change', () => {
    draggingVolume = false;
  });
  els.volume.addEventListener('pointerup', () => {
    draggingVolume = false;
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') window.akuMini.close();
  });
}

function init() {
  initEls();
  wireEvents();

  if (!window.akuMini) return;

  window.akuMini.onPlayerState((state) => {
    if (state) renderState(state);
  });
}

init();
