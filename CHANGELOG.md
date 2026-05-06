# Changelog

All notable changes to **Froggy Flash** are documented in this file.

Release tags are `v[major].[minor].[patch]`, matching `package.json` after the default patch bump in `scripts/new-github-release.ps1` (use `-BumpMinor` / `-BumpMajor` or `-SkipVersionBump` / `-Tag` as needed).

## [Unreleased]

### Added

- **Dynamic LLM quizzes** – Folder decks show a **Dynamic** control in the deck tree. The LLM builds a pool of up to fifty multiple-choice questions from the deck manifest `description` (or from a one-off topic prompt if the manifest has no description). Each session shuffles and studies up to ten cards from that pool (same session cap as other sets when the pool is larger).
- **Deck manifest descriptions** – Optional `description` string on `*.deck.json` manifests, returned with deck listings and honored when creating a deck from Manage decks (the generation topic is stored on the manifest when you add a deck that way).

### Changed

- **LLM configuration** – OpenAI and Ollama settings are validated through a shared path before any model call, with errors that explicitly point to **Settings → LLM**.
- **Manage decks** – Renaming a folder deck uses an inline form in the detail pane instead of a browser prompt.

## [1.0.1] – 2026-05-01

Follow-up to the first Windows build: tighter update behavior for packaged installs and cleaner release versioning.

### Changed

- **Automatic updates (packaged builds)** – Further work on `electron-updater`: checking the feed, background download, and restart-to-install prompts aligned with how the app is shipped.
- **Installer and release flow** – Versioning and GitHub release scripts updated; `build-info.json` removed from the versioning approach.

### Developer / release tooling

- `package.json` scripts for packaging, semver bumps, and releases adjusted alongside the above.

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

[1.0.1]: https://github.com/froggy523/froggy-flash/releases/tag/v1.0.1

[1.0.0]: https://github.com/froggy523/froggy-flash/releases
