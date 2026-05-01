# Changelog

All notable changes to **Froggy Flash** are documented in this file.

Release tags are `v[major].[minor].[patch]`, matching `package.json` after the default patch bump in `scripts/new-github-release.ps1` (use `-BumpMinor` / `-BumpMajor` or `-SkipVersionBump` / `-Tag` as needed).

## [1.0.0] – 2026-05-01

First public release of the Windows desktop app (Electron).

### Added

- **Study flow** – Load flashcard sets from JSON, move through cards, mark correct or incorrect, and track scores per deck and set.
- **Deck library** – Organize material as folder decks with manifests (`*.deck.json`), a resizable sidebar tree, and actions to add, rename, delete, and import card sets from JSON files.
- **LLM card generation** – Configure an OpenAI- or Ollama-compatible HTTP endpoint under **LLM settings**, then generate new card sets from a topic or instructions (output is validated against the Froggy Flash JSON shape).
- **Markdown on cards** – Card questions can use GitHub-flavored Markdown; rendering uses `marked` and is sanitized with `DOMPurify`.
- **Session history** – Recent study sessions are recorded and can be reviewed in the UI; scores and session data can be exported for graphing or analysis.
- **Window layout persistence** – Window size, position, and related UI preferences are saved and restored between launches.
- **Automatic updates (packaged builds)** – When a generic update feed URL is configured (`FROGGY_UPDATE_URL` and matching `publish` entry from `electron-builder`), the app checks for updates, downloads in the background, and offers a restart to install.
- **Windows installer** – NSIS-based installer via `electron-builder` (optional install directory, branded icons). Installer file names follow `Froggy Flash Setup {semver}.exe` (for example `Froggy Flash Setup 1.0.1.exe`).

### Developer / release tooling

- Scripts for semver bumps, icon generation, resolving the built installer path, and creating GitHub releases with `gh` (`scripts/`).

### Documentation

- Flashcard and deck JSON format described in `docs/flashcard-format.md`.

[1.0.0]: https://github.com/froggy523/froggy-flash/releases
