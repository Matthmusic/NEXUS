# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

NEXUS is a Windows desktop application (Electron + React + TypeScript) for managing a price database of electrical components ("base de prix par références électriques"). It includes a fuzzy search interface, a cable cost calculator, and a file-based multi-user admin locking system.

## Development Commands

```bash
npm run electron:dev   # Start Vite dev server (port 5601) + Electron simultaneously
npm run dev            # Vite dev server only (port 5601, strictPort)
npm run electron       # Launch Electron only (requires dev server already running)
npm run build          # TypeScript check + Vite production build
npm run build:electron # Full Windows NSIS installer (runs build first)
npm run lint           # ESLint (TypeScript/React files only)
npm run preview        # Vite preview of production build
```

In dev mode, DevTools can be opened via **Ctrl+Shift+I** or **F12**.

## Architecture

### Process Separation (Electron IPC)

The app is split into two processes that communicate exclusively via IPC:

- **Main process** ([electron/main.cjs](electron/main.cjs)): All Node.js/filesystem operations. Handles prices CRUD, user management, config, Excel import, admin lock, window controls.
- **Renderer process** ([src/](src/)): React UI. Has zero direct filesystem access — all backend calls go through `window.api`.
- **Preload bridge** ([electron/preload.cjs](electron/preload.cjs)): Exposes `window.api` to the renderer via `contextBridge`. All IPC channel names are kebab-case (e.g. `load-prices`, `try-lock`).

The TypeScript types for `window.api` and all domain types are declared globally in [src/global.d.ts](src/global.d.ts).

### React Components

The app has two tabs: **Calculateur** (default) and **Base de prix**.

- [src/App.tsx](src/App.tsx): Root component. Owns global state: current user, db, search, selected item, import/config/user modal state. Delegates lock logic to `useLock`. Also implements bulk category/supplier update on current search results. Uses a custom frameless titlebar with `windowMinimize`/`windowToggleMaximize`/`windowClose` IPC calls.
- [src/hooks/useLock.ts](src/hooks/useLock.ts): Custom hook encapsulating admin lock state, heartbeat interval, 12s polling, and `handleToggleAdmin`. Also handles remote DB version change detection and auto-reload.
- [src/CableCalculator.tsx](src/CableCalculator.tsx): Cable cost calculator tab orchestrator. Receives `onDbChange` so it can persist price updates. Manages corrélateur state (type/section/ref selection), devis accumulation, and session persistence. Renders sub-components.
- [src/components/calc/TableDesPrix.tsx](src/components/calc/TableDesPrix.tsx): Fully self-contained accordion table of all cable prices with global/per-row overrides, filters, and CSV export. Owns all its own state.
- [src/components/calc/DevisPanel.tsx](src/components/calc/DevisPanel.tsx): Presentational devis (quote) table with editable quantities and xlsx export.
- [src/components/calc/SessionsPanel.tsx](src/components/calc/SessionsPanel.tsx): Presentational session save/load UI.
- [src/components/calc/cableData.ts](src/components/calc/cableData.ts): Shared cable constants (`CABLES`, `CABLE_CATS`, `SECTION_RE`, `COND_RE`, `normalizeSection`).
- [src/components/calc/types.ts](src/components/calc/types.ts): Shared types for calc layer (`Cable`, `DevisLine`, `CalcSession`, `Overrides`).
- [src/components/calc/styles.ts](src/components/calc/styles.ts): Shared inline style objects (`thS`, `tdS`) for table cells used across calc components.
- [src/components/modals/](src/components/modals/): Four modal components — `UserModal`, `ImportModal`, `ConfigModal`, `CablePrixImportModal`. The last one handles Excel-based cable price imports with column auto-detection, a preview diff (updated/added/skipped), and automatic backup before writing.

Reads cable specs from [src/assets/cables.json](src/assets/cables.json) and correlates with the price DB via `SECTION_RE` / `COND_RE` regexes.

### Data Files (dev: `./data/`, packaged: `%APPDATA%/nexus-data/`)

- `prices.json` — Main database (`PriceDatabase` shape: `{ meta, items[] }`)
- `users.json` — Array of user name strings
- `prices.lock` — JSON lock file (`{ user, machine, pid, since, heartbeat }`) — gitignored
- `admin.log` — Newline-delimited JSON audit log of lock events — gitignored
- `config.json` — Stored in `%APPDATA%` (not in `data/`); fields: `dataDir`, `lockTimeoutMin`

### Admin Lock System

Only one user at a time may edit the database. The lock is a file (`prices.lock`) created with `wx` flag to ensure atomicity. Key behaviors:
- Lock expires (becomes stale) after `lockTimeoutMin` minutes (default: 10) without a heartbeat.
- The active admin sends a heartbeat every **30 seconds** (`heartbeatLock` IPC call).
- All clients poll lock status every **12 seconds** (`getLockStatus` IPC call).
- `savePrices` in the main process enforces that the caller holds the lock.
- Writes to `prices.json` use a `.tmp` → rename pattern for atomicity.

### Search

Search uses [Fuse.js](https://fusejs.io/) over normalized (accent-stripped, lowercased) fields: `ref`, `name`, `keywords`, `category`, `supplier`. Results are capped at 200. Queries under 3 characters use simple `includes()` rather than fuzzy matching.

### Price History & Backup

Every `savePrices` call that changes a price appends a `PriceHistoryEntry` (up to 10 entries per item). Before bulk imports via `ImportModal` or `CablePrixImportModal`, `backupPrices()` is called first to create a timestamped backup in the data directory.

### UI Conventions

- CSS classes are defined in `src/index.css` and `src/App.css`. Use existing utility classes (`.btn`, `.btn.ghost`, `.btn.primary`, `.btn.danger`, `.btn.secondary`, `.panel`, `.panel-head`, `.modal`, `.modal-backdrop`, `.modal-head`, `.modal-body`, `.modal-footer`, `.field`, `.pill`, `.hint`) rather than creating new ones.
- Icons come from `lucide-react`. No emoji in UI unless already present.
- The app version is injected at build time via `import.meta.env.VITE_APP_VERSION` (set in `vite.config.ts` from `package.json`).
