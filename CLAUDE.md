# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**ReoxMySQL** is a FiveM resource providing MySQL connectivity for game server scripts, forked from `oxmysql`. It allows multiple MySQL resources to connect to the same or different databases simultaneously without conflicts.

## Commands

```bash
# Install dependencies
bun install

# Build (bundles src/ via esbuild + compiles lib/ via tsc)
bun run build

# Build with release package
bun run release

# Watch mode during development
bun run watch
```

Build output: `dist/build.js` (server entry point) and `lib/MySQL.js` + `lib/MySQL.d.ts` (library exports).

## Architecture

### Entry Point
`src/index.ts` — registers FiveM exports for all MySQL methods (`query`, `single`, `scalar`, `update`, `insert`, `prepare`, `rawExecute`, `transaction`, `startTransaction`). Each method has an async variant via `_async` suffix.

### Core Modules

- **`src/database/`** — All DB operations:
  - `pool.ts`: mysql2 connection pool (limits, idle timeout, keepalive)
  - `rawQuery.ts`: Text-protocol queries with slow-query detection
  - `rawExecute.ts`: Binary-protocol with concurrency cap (≤60% of pool size) to prevent SELECT starvation
  - `rawTransaction.ts` / `startTransaction.ts`: Transaction support
  - `index.ts`: Initialization — reads config, creates pool, wires up the module

- **`src/config.ts`** — Parses FiveM convars (`re_mysql_*` prefix), supports MySQL URI and semicolon-style connection strings, and exposes options: named placeholders, transaction isolation level, compression, prepared statement cache size, graceful shutdown.

- **`src/logger/index.ts`** — Per-resource query logging, in-game `/mysql` debug dashboard (via `web/`), and error event triggering (`reoxmysql:error`).

- **`src/utils/`** — Argument parsing (named/positional placeholders), response shaping (`single`, `scalar`), MySQL type casting, result validation.

- **`src/profiler/`** — Batch statement profiling for performance analysis.

- **`lib/MySQL.ts`** — Lua-compatible wrapper consumed by client FiveM scripts; exports `QueryStore` array for query reuse.

### Build Pipeline
`build.js` uses esbuild to bundle TypeScript → CommonJS targeting Node 22, and auto-generates `fxmanifest.lua` from `package.json` metadata.

### FiveM Manifest
`fxmanifest.lua` declares the resource, specifies `dist/build.js` as the server script, `web/build/index.html` as the UI page, and requires FiveM server build 12913+.

## Configuration

Resources configure the connection via FiveM convars:
- `re_mysql_connection_string` — MySQL URI or `host=...;user=...;...` format
- `re_mysql_debug` — enables verbose query logging

Full convar reference: `docs/` directory and `README.md`.
