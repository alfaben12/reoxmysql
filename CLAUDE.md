# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**ReoxMySQL** is a FiveM resource providing MySQL connectivity for game server scripts, forked from `oxmysql`. It supports two database connectors (`mysql2` and `mariadb`) selectable at runtime, and allows multiple MySQL resources to share the same pool without conflicts.

## Commands

```bash
# Install dependencies
bun install

# Build (bundles src/ via esbuild + compiles lib/ via tsc)
bun run build

# Build watch mode during development
bun run watch

# Build with release package
bun run release
```

Build output: `dist/build.js` (FiveM server script entry point) and `lib/MySQL.js` + `lib/MySQL.d.ts` (Lua-callable library exports).

`bun run build` runs `build.js` (esbuild, CJS, Node 22 target) and then `cd lib && tsc`. Only `build.js` / `dist/` needs rebuilding for server-side changes; `lib/` is for the public TypeScript API.

## TypeScript Path Aliases

`src/tsconfig.json` sets `"baseUrl": "."` (relative to `src/`). All bare imports without a path prefix resolve from `src/`:

```typescript
import { typeCast } from 'utils/typeCast'; // → src/utils/typeCast.ts
import { pool } from 'database/pool'; // → src/database/pool.ts
import { mysql_connector } from 'config'; // → src/config.ts
```

esbuild resolves these via `tsconfig-paths`-equivalent bundler resolution. No `../` chains needed within `src/`.

## Architecture

### Entry Point & Export Layer

`src/index.ts` — registers FiveM `exports()` for every MySQL method. Each sync method gets an `_async` sibling that wraps it in a Promise. All methods call into `rawQuery`, `rawExecute`, `rawTransaction`, or `startTransaction`.

### Dual-Connector Design

The connector is selected by the `re_mysql_connector` convar (default `"mysql2"`). The two paths diverge at:

- **`src/database/pool.ts`** — `createConnectionPool()` branches on `mysql_connector`. The mariadb branch uses `require('mariadb')` (dynamic require inside the branch so esbuild bundles it) with an explicit `getConnection()` / `release()` startup probe instead of `pool.query()`.
- **`src/database/connection.ts`** — defines two connection classes:
  - `MySql` wraps a `mysql2` `PoolConnection` and calls `conn.query({sql, values, typeCast})`
  - `MariaDbConnection` wraps a mariadb `ConnectionPromise` and applies `normalizeMariaDbResult()` post-query

`getConnection()` returns whichever class matches `mysql_connector`. All consumers (`rawQuery`, `rawExecute`, `rawTransaction`, `startTransaction`) only ever call `.query()`, `.execute()`, `.beginTransaction()`, `.rollback()`, `.commit()`, `.release()` — they are unaware of which connector is active.

### mariadb Normalization (`connection.ts`)

mariadb does not support `typeCast`; instead `MariaDbConnection` normalizes query results to be byte-for-byte identical to mysql2's output. Critical implementation details:

- **`result.meta`** is an array of mariadb `ColumnDef` objects. `ColumnDef.name` is a **method** — always call `f.name()`, never `f.name`.
- **`ColumnDef.columnType`**, `.flags`, `.columnLength` are properties (direct access).
- **Binary charset detection**: `field.collation?.index === 63` (not `field.charset`; mariadb stores charset as a `Collation` object).
- The normalizer rebuilds rows as plain `{}` objects only when at least one column type needs transformation (`needsNorm()`). When no column in a result needs transformation the original result is returned unchanged.
- DML results (`INSERT`/`UPDATE`) are plain objects, not arrays — `normalizeMariaDbResult` passes them through immediately.

### mysql2 Type Casting (`src/utils/typeCast.ts`)

mysql2's `typeCast` callback defines the canonical behavior that mariadb normalization must match:

- `DATETIME`/`TIMESTAMP`/`NEWDATE` → `new Date(string).getTime()` (ms)
- `DATE` → `new Date(string + ' 00:00:00').getTime()` (ms)
- `TINY` length=1 → boolean (`field.string() === '1'`)
- `BIT` length=1 → `buffer[0] === 1`; BIT(n) → `buffer[0]`
- `*_BLOB` with charset=63 → `[...buffer]` (byte array); otherwise → string

`typeCastExecute` (used for binary-protocol `execute` calls) omits TINY/BIT/BLOB handling (mysql2 3.9+ added those to execute separately).

### Request Flow

```
Lua script
  → FiveM export (src/index.ts)
    → rawQuery / rawExecute / rawTransaction / startTransaction
      → getConnection() → MySql | MariaDbConnection
        → connection.query() / connection.execute()
          → parseResponse() → Lua callback
```

- **`rawQuery`** (`src/database/rawQuery.ts`): text-protocol queries. Handles slow-query logging, profiler, and calls `parseResponse(type, result)` to shape the result.
- **`rawExecute`** (`src/database/rawExecute.ts`): binary-protocol prepared statements. Has two paths:
  - **Parallel batch**: when `parameters.length > 1` and profiler/connectionId are not active, spawns up to `getBatchLimit()` (≤60% of pool) concurrent workers so SELECT starvation doesn't occur.
  - **Sequential**: when profiler is active, a connection is pinned (`connectionId`), or there is a single parameter set.
- **`rawTransaction`**: array of `{query, params}` objects; uses `beginTransaction` / `commit` / `rollback`.
- **`startTransaction`**: experimental callback-based API for complex transactions; uses TypeScript `using` for automatic connection release.

### Connection Lifecycle (`using` statement)

All connection consumers use TypeScript's explicit resource management:

```typescript
using connection = await getConnection();
```

`[Symbol.dispose]()` on both `MySql` and `MariaDbConnection` commits any open transaction and releases the connection back to the pool. The `rawExecute` parallel batch path calls `conn.release()` manually (not `using`) because connections are acquired inside a nested closure.

### Pool Initialization Sequence

1. `src/database/index.ts` kicks off `createConnectionPool()` inside `setTimeout` (deferred until after FiveM resource init).
2. `pool` is exported as `let pool: any`. Consumers that need the pool before it's ready `await poolReady` (a Promise resolved once the pool is assigned).
3. On failure, the pool retries every 30 seconds.
4. Debug convars refresh via `AddConvarChangeListener('re_mysql_*', ...)` or a 5 s `setInterval` fallback.

### `parseResponse` Result Shaping

`src/utils/parseResponse.ts` maps raw driver results to the shape Lua scripts expect:

- `'single'` → `result[0] ?? null`
- `'scalar'` → first value of first row (`for (key in row) return row[key]`)
- `'insert'` → `result.insertId ?? null`
- `'update'` → `result.affectedRows ?? null`
- `null` (default) → `result ?? null` (full row array)

## Configuration Convars

All convars use the `re_mysql_` prefix:

| Convar                                 | Default              | Description                                                             |
| -------------------------------------- | -------------------- | ----------------------------------------------------------------------- |
| `re_mysql_connection_string`           | `''`                 | MySQL URI or `host=…;user=…;password=…;database=…`                      |
| `re_mysql_connector`                   | `'mysql2'`           | `'mysql2'` or `'mariadb'`                                               |
| `re_mysql_connection_limit`            | `25`                 | Max pool connections                                                    |
| `re_mysql_queue_limit`                 | `0` (unlimited)      | mysql2 only                                                             |
| `re_mysql_max_idle_connections`        | `= connection_limit` | mysql2 only                                                             |
| `re_mysql_idle_timeout`                | `60000` (ms)         | Divided by 1000 for mariadb (which uses seconds)                        |
| `re_mysql_transaction_isolation_level` | `2`                  | 1=REPEATABLE READ, 2=READ COMMITTED, 3=READ UNCOMMITTED, 4=SERIALIZABLE |
| `re_mysql_slow_query_warning`          | `200` (ms)           | Log queries slower than this                                            |
| `re_mysql_debug`                       | `'false'`            | `'false'`, `'true'`, or JSON array of resource names                    |
| `re_mysql_ui`                          | `'false'`            | Enable in-game `/mysql` dashboard                                       |
| `re_mysql_log_size`                    | `100`                | Max query log entries per resource                                      |
| `re_mysql_graceful_end`                | `1`                  | Send COM_QUIT on idle close (mysql2 only)                               |
| `re_mysql_compress`                    | `0`                  | Enable wire compression                                                 |
| `re_mysql_max_prepared_statements`     | `500`                | Per-connection LRU prepared statement cache                             |
