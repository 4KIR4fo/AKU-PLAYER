# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Multiple music sources: add any number of folders and/or individual files
  (Settings → Library, or the topbar "Add music" menu), all indexed into one
  library
- Multi-select track rows (Ctrl/Cmd-click to toggle, Shift-click for a range)
  with a bulk action bar: play, queue, favorite, add to a playlist
- Queue panel showing the current and upcoming tracks, with click-to-jump and
  "add to queue" from the selection bar
- Playlist builder: mix any number of genres, albums, artists, eras and years
  into one playlist, add individual tracks by hand, drag sources to reorder, and
  optionally keep the playlist live so it updates as the library changes
- Duplicate handling: songs with the same title **and** artist are collapsed to
  the best-quality copy (lossless/bit depth/sample rate/bitrate); files with no
  real artist (or no title) are never merged, and it can be toggled in
  Settings → Library
- View and restore ignored duplicates (Settings → Library): each ignored copy can
  be kept after all, and restored copies can be ignored again
- Remove-from-library: the ⊘ track action (and a Remove bulk action) takes a song
  out of the library without touching the file; removed songs are listed under
  Settings → Hidden songs with per-song and "Restore all" actions
- Three new themes: Forest, Regal and Terracotta (the first light theme)

### Changed

- The library config now stores a list of sources and migrates the previous
  single-folder setting
- Filled buttons (`.accent-btn`, the repeat-one badge) pick their text colour
  from a per-theme `--accent-text`, so light accents stay readable

## [0.3.0] - 2026-10-18

### Added

- Windows installer (`AKU-Setup-<version>.exe`): pick the install folder, choose
  whether to create a desktop shortcut, per-user or all-users install, and a
  proper uninstaller in Add/Remove Programs

### Changed

- The portable download is now named `AKU-Portable-<version>.exe` so it is not
  confused with the installer

[0.3.0]: https://github.com/4KIR4fo/AKU-PLAYER/releases/tag/v0.3.0

## [0.2.0] - 2026-10-18

### Added

- Albums, Artists, Genres and Eras browse views, each with a detail page
- Sidebar auto-hide with an edge handle to peek it open, plus a pin toggle
- Settings modal covering themes, display, favorites, playback and the mini player
- Mini player styles (Bar, Card, Minimal) with optional seek and volume bars, and
  a cover-only cube mode
- Resume playback, configurable display density, and "cover art in rows" option
- Alternate themes: Terminal, Ocean and Sage alongside the default Crimson
- MIT license, README and CHANGELOG
- One-line PowerShell installer and GitHub release workflow

### Changed

- Display settings consolidated into a single choice (Comfortable / Compact /
  No covers)
- Empty-state copy made more natural

[0.2.0]: https://github.com/4KIR4fo/AKU-PLAYER/releases/tag/v0.2.0
