# AGENTS.md

## Project
Electron music player for Windows. Entry: `main.js` (package.json `main`). Dev machine is WSL2, app runs on Windows.

- `main.js` — window, IPC (`choose-folder`, `get-library`; `scan-progress` events main→renderer), recursive library scan, ID3 tags via `music-metadata` (`title/artist/album/duration/genre/year/quality`), `media://` protocol streaming (Range/206 for seeking), config JSON; mini-player window plus `player-state`/`player-command` IPC relay between windows, and the `miniplayer-config` IPC that resizes/pins it (`setBounds` + `setAlwaysOnTop`)
- `preload.js` — contextBridge API exposed as `window.aku` (library, player-state/command, categorize, `setMiniPlayerWindow`)
- `renderer.js` — playback/queue/shuffle/repeat, favorites, playlists, search, browse views (Albums/Artists/Genres/Eras), settings modal, sidebar autohide, themes, localStorage persistence; owns the `<audio>` and broadcasts player state to the mini window
- `index.html` / `style.css` — UI (default `red` palette: `#000000`, `#830000`, `#BC0202`, `#FF0000`; alternate `teal`/`ocean`/`sage` themes via `:root[data-theme=…]`)
- `mini.html` / `mini.css` / `mini.js` / `mini-preload.js` — compact frameless always-on-top mini player (`window.akuMini`): cover + title/artist + play/pause/next/close, optional seek and volume bars, Bar/Card/Minimal styles and a cover-only "cube" mode (click to expand). It is a remote control only: audio lives in the main renderer, so controls go through main (`player-command`) and state comes back (`player-state`, cached in `lastPlayerState` and replayed on load)
- `scripts/make-icon.ps1` — icon pipeline; `build/` — icon source + generated PNG; `dist/` — packaging output (generated)

## Commands (must run on Windows, not WSL)
Node/npm exist only on Windows (`C:\Program Files\nodejs`). WSL interop PATH is stale, so prefix commands with a PATH set (no inner quotes — WSL interop mangles them) and use cwd on `/mnt/c`:

```
cmd.exe /c "set PATH=C:\PROGRA~1\nodejs;%PATH%&&C:\PROGRA~1\nodejs\npm.cmd install"
cmd.exe /c "C:\PROGRA~1\nodejs\node.exe node_modules\electron\cli.js ."
```

- Launching (dev): do NOT use `npm.cmd start` from WSL — the `.bin\electron.cmd` shim needs `node` on PATH. Either use the `cli.js` invocation above, or prefix with the PATH set. In a native Windows terminal (fresh session), `npm start` works normally.
- Dev workflow: `main.js` / `preload.js` / `mini-preload.js` changes need a full app restart (main-process/preload code doesn't hot-apply); renderer-only changes (`index.html`, `style.css`, `renderer.js`, `mini.html`, `mini.css`, `mini.js`) apply with Ctrl+R (default Electron menu is kept)
- Packaging: `cmd.exe /c "set PATH=C:\PROGRA~1\nodejs;%PATH%&&C:\PROGRA~1\nodejs\node.exe node_modules\electron-builder\out\cli\cli.js --win portable"` (equivalent to `npm run dist` / `npm run build`; same PATH caveat) → `dist\AKU.exe`
- Electron 44 has **no postinstall download**, so `package.json` declares `"postinstall": "node node_modules/electron/install.js"` and a fresh `npm install` now fetches the binary automatically. With `--ignore-scripts`, run it by hand: `cmd.exe /c "C:\PROGRA~1\nodejs\node.exe node_modules\electron\install.js"`
- npm 11 `allowScripts` blocks `electron-winstaller`'s postinstall by default; harmless for the portable (NSIS) target
- Never run npm inside WSL for this project — it would resolve the Linux Electron, which cannot run as the intended Windows app

## Packaging
- electron-builder 26, target `portable` (NSIS wrapper), config in `package.json` → `build`
- Output: `dist\AKU.exe` (self-contained portable, ~96–100 MB; extracts to temp at launch, slower start); settings still live in `%APPDATA%\aku-player`. Name comes from `build.artifactName` (`AKU.${ext}`) + `build.win.executableName` (`AKU`); `productName`/`name`/`appId` stay `aku-player` so the data path doesn't move. Its file timestamp/size is how to confirm a fresh build.
- `dist\win-unpacked\AKU.exe` is the same build without the portable wrapper — no temp extraction at launch, handy for quickly testing a packaged build
- `build.files` is a **whitelist**: any new runtime file (html/js/css preload) must be added there or it won't be in the packaged exe. Only `build/icon.png` is pulled from a subdir
- Icon: `build\icon.png` (512×512, transparent background) is used for the exe and the dev window (`BrowserWindow.icon`)
- Regenerate icon: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\make-icon.ps1` — decodes `build\icon-source.webp` via WIC, center-crops, scales to 512, flood-fills border-connected white to transparent (inline C# in the script)

## Data locations
- Config: `%APPDATA%\aku-player\config.json` (remembers `libraryRoot`)
- Renderer state (favorites/playlists/volume/view, plus `settings`, `sidebarPinned`, `miniMode`, `lastPosition`): localStorage inside the Electron profile (= userData dir)
- Caches: `%LOCALAPPDATA%\npm-cache`, `%LOCALAPPDATA%\electron`, `%LOCALAPPDATA%\electron-builder` (approved standard locations)

## Conventions / gotchas
- Track IDs are `sha1(path).slice(0, 16)` — favorites/playlists survive rescans as long as file paths are unchanged
- A single click on a track row starts playback (the heart and `+` buttons are excluded); there is no double-click handler
- Mini player is opened from `#mini-btn` in the player bar; main owns the audio, the mini window only reflects state and sends commands
- The mini window is created `resizable: false` but is resized programmatically through `miniplayer-config` → `setBounds` (and pinned via `setAlwaysOnTop`); its `minWidth`/`minHeight` are 40 so cube mode (80×80) fits. If a future Electron build ignores `setBounds` on non-resizable windows, switch it to `resizable: true` (frameless windows show no user resize grips)
- Display name is `AKU` (sidebar brand, window titles; the red first letter comes from `.brand::first-letter`). Internal id stays `aku-player` (`app.setName`, package.json `name`/`productName`/`appId`) so `%APPDATA%\aku-player` stays put; only the packaged exe name is `AKU` (via `build.artifactName` + `build.win.executableName`)
- Track objects include `quality` (`container, codec, bitrate, sampleRate, bitsPerSample, channels, lossless`) from music-metadata `format`; `null` if parsing failed. Shown as a pill + popover in the player bar (`#quality-btn`, `#quality-popover`)
- Track objects include `genre` (`string[]`, cleaned from `common.genre`: split on `;` `,` `/`, de-duped case-insensitively, numeric-only dropped). The genre maker (`#genre-maker` → `#genre-popover`, next to the playlists `+`) creates one auto playlist per genre: multi-genre tracks join every genre, no-genre tracks are skipped, a min-tracks filter hides small genres. Auto playlists carry `{ auto: true, genre, genreKey }`, are named `Genre: <name>`, and are refreshed in place on re-run (unchecked genres are removed; manual playlists are never touched)
- Genre categorizer (`#categorize-btn`, sidebar) fills missing genres by querying the iTunes Search API (`entity=song`, takes `primaryGenreName`), rate-limited to ~1 req/1s. It runs in main (`categorize` IPC, `categorize-progress`/`categorize-cancel` events) and results are merged into in-memory `track.genre` (file tags are never modified). Results are cached in `%APPDATA%\aku-player\genre-cache.json` keyed by normalized `artist|title` and re-applied during scan. This is the app's only outbound network use. (MusicBrainz was evaluated first: recording-level genres were reliably empty and artist-level genres far too noisy)
- Scan extensions: mp3, m4a, aac, ogg, oga, opus, wav, flac. `.wma` is intentionally excluded — Chromium cannot decode WMA (nor ALAC/APE/WavPack/DSD)
- Audio is streamed via custom `media://` scheme in `main.js`; do not switch to `file://` or relax `webSecurity` — CSP in `index.html` only allows `media:` for audio/covers
- Both windows use `contextIsolation: true` + `sandbox: true` with a preload (`window.aku` / `window.akuMini`); add APIs via `contextBridge`, never expose Node. Renderer CSP is `default-src 'none'`, so the renderer cannot fetch externally — do outbound network in `main.js` (see categorizer)
- `window.prompt` is unavailable in Electron; playlist creation uses an inline input (`#new-playlist-input`)
- No tests or linter configured; `.github/workflows/ci.yml` runs `node --check` on the JS entry points as a light parse gate
- User constraint: keep all changes inside this folder unless explicitly approved

## Views & settings
- Sidebar nav: Library, Favorites, then browse views Albums/Artists/Genres/Eras. Browse pages show a cover grid (Albums) or list rows (Artists/Genres/Eras); clicking one opens a detail view (`state.view.type` `album`/`artist`/`genre`/`era` with `name`), which reuses the normal track rows. Search filters group names on browse pages, tracks on list/detail views (`renderMain()` routes). `renderer.js` helpers: `albumGroups()` (key `album\u0000artist`), `artistGroups()`, `eraGroups()` (decade label from `track.year`, newest-first, `Unknown` last), plus the existing `genreGroups()`
- Track objects include `year` (from music-metadata `common.year`, falling back to `common.date`); `null` when absent. Eras group by `floor(year/10)*10` → e.g. `2000s`; year-less tracks land in `Unknown`
- Settings is a modal overlay in the main window (`#settings-overlay`, built by `renderSettings()` from `settingsSections()`), opened by the topbar gear (`#settings-btn`). Every option lives in `state.settings` (persisted in the localStorage blob) and is applied by `applySettings()`. Toggles: theme, sidebar auto-hide, browse sections, genre tools, favorites, quality indicator, track rows (Comfortable / Compact / No covers), resume playback, confirm playlist delete, shuffle/repeat buttons, and the mini-player options below. `settings.rowDisplay` replaced the old separate `coverArt`/`compactDensity` toggles; `restore()` migrates the legacy keys
- Sidebar autohide: when `settings.sidebarAutoHide` is on the sidebar collapses via `margin-left` (`html[data-sidebar="hidden"]`); a left-edge `#sidebar-handle` peeks it open (`html.sidebar-peek`), and `#sidebar-toggle` (topbar) pins it (`state.sidebarPinned`, persisted). Menu button + handle are hidden when autohide is off
- Themes: `state.settings.theme` sets `document.documentElement.dataset.theme`; `:root[data-theme="teal"|"ocean"|"sage"]` blocks in `style.css` and `mini.css` override the palette vars (default `red` uses the plain `:root`). Theme travels to the mini window inside the `player-state` snapshot
- Mini player: `state.settings.miniStyle` (`bar`/`card`/`minimal`), `miniSeek`/`miniVolume` add seek/volume rows, `miniStartCube` starts it collapsed, `miniAlwaysOnTop` toggles pinning. `state.miniMode` (`full`/`cube`) is a cover-only square; the cube button collapses, clicking the cover expands. `miniWindowSize()` computes the size and `applyMiniWindow()` sends it via `setMiniPlayerWindow` → main `miniplayer-config` IPC (`setBounds` + `setAlwaysOnTop`). Seek/volume/cube controls ride the existing `player-command` relay (`mini-mode` handled in `handlePlayerCommand`)
- Resume playback (`settings.resumePlayback`): `state.lastPosition` is saved with the state; on launch `loadLibrary()` sets `audio.src` and restores the position via the `pendingResume` path (no autoplay)

## Install & distribution
- License is MIT (`LICENSE`); `package.json` carries `license`, `repository`, `homepage`, `bugs` and `engines` (`node >=20`), and `.nvmrc` pins 20
- From source: `git clone` → `npm install` → `npm start` (the `postinstall` fetches Electron); `npm run dev` is an alias of `start`
- One-line source installer: `scripts/install.ps1` — clones into `%LOCALAPPDATA%\AKU-PLAYER`, installs deps and adds Desktop/Start Menu shortcuts (pointing at `node_modules\electron\dist\electron.exe`, or `dist\AKU.exe` with `-Build`); `-Uninstall` reverses it. Served from the repo raw URL
- Releases: `.github/workflows/release.yml` builds the portable exe on any `v*` tag (windows-latest, Node 20, `npm run dist`) and attaches `dist/AKU.exe` to the GitHub release. To publish, bump `package.json` `version` and push a matching tag
- `.gitignore` excludes `node_modules/` and `dist/`; `build/` (icon) is committed. `.gitattributes` forces CRLF for `.ps1`/`.cmd`/`.bat`

## Comments
- Comments are used sparingly and explain *why*, not *what* — range/seek handling, ID stability, the iTunes rate limit, the mini relay, legacy settings migration. Match that style rather than narrating obvious lines
