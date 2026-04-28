# ReoxMySQL — Changelog & Differences from OxMySQL

> Forked from [oxmysql](https://github.com/CommunityOx/oxmysql) v2.13.1  
> Focus: higher performance, isolated convar names, and no legacy compatibility layer.

---

## Summary of Differences from OxMySQL

| Aspect                       | OxMySQL                        | ReoxMySQL                                                 |
| ---------------------------- | ------------------------------ | --------------------------------------------------------- |
| Resource name                | `oxmysql`                      | `reoxmysql`                                               |
| Convar prefix                | `mysql_*`                      | `re_mysql_*`                                              |
| `mysql-async` compatibility  | Yes (`provide`)                | **No**                                                    |
| `ghmattimysql` compatibility | Yes (`provide`)                | **No**                                                    |
| Batch execute                | Unbounded `Promise.all`        | Worker pool, adaptive cap (60% of live idle connections)  |
| Tick-batched write API       | Not available                  | `MySQL.deferUpdate` / `MySQL.deferInsert`                 |
| Busy-wait pool               | `while (!pool) await sleep(0)` | `await poolReady` (Promise)                               |
| `typeCast` on `query()`      | No                             | Yes                                                       |
| Placeholder regex cache      | No                             | Yes (query meta cache, max 500 entries)                   |
| Named placeholder scan cache | `.includes(':')` per call      | Cached together with placeholder count                    |
| `parseExecute` normalization | 2-3 passes (`every` x 2)       | Single-pass classify + build                              |
| `scheduleTick` coalescing    | Fired per query                | Coalesced per tick                                        |
| Convar refresh               | `setInterval(1000)` polling    | `AddConvarChangeListener` event-driven                    |
| Logger fast path             | Function always called         | Inlined gate, skipped on rawQuery hot path                |
| Scalar value extraction      | `Object.values(row)[0]`        | `for...in` (zero allocation)                              |
| Log trim strategy            | `splice(0,1)` per insert O(n)  | `slice()` every N inserts, amortized                      |
| Connection keep-alive        | Not configured                 | `enableKeepAlive: true`, delay **0 ms**                   |
| Pool idle tuning             | None                           | `re_mysql_max_idle_connections` + `re_mysql_idle_timeout` |
| Idle connection close        | TCP destroy (abrupt)           | `re_mysql_graceful_end` — COM_QUIT before close           |
| Prepared statement cache     | 16 000 per connection          | `re_mysql_max_prepared_statements` (default 500)          |
| Network compression          | Not configurable               | `re_mysql_compress` convar (default off)                  |
| Database engine              | mysql2 only                    | `mysql2` **or** `mariadb` via `re_mysql_connector` convar |
| mysql2 version               | Patched 3.11.3                 | Patched 3.22.2                                            |
| mariadb version              | —                              | 3.5.2                                                     |
| named-placeholders version   | Patched 1.1.3                  | Patched 1.1.6 (LRU cache via `lru.min`)                   |
| Read/write pool split       | Single pool                   | `readPool` (SELECT) + `writePool` (INSERT/UPDATE/DELETE) |
| Parallel query API          | Not available                 | `MySQL.parallel` — simultaneous heterogeneous queries     |
| Pool warm-up                | Cold-start each connection   | Pre-opens connections at startup (0–50 ms saved)         |
| Query meta cache            | Clear-on-full                | LRU eviction (one entry removed, not all 500)             |
| Regex object               | New RegExp per cache miss     | Static `PLACEHOLDER_RE` reused, `lastIndex` reset          |
| Tick batch flush           | `setImmediate`               | `queueMicrotask` (faster, same tick)                       |
| Config documentation       | None                          | `RECOMENDED_CONF.md`                                      |

---

## Breaking Changes

### 1. Required Convar Rename

All convars now use the `re_` prefix. Scripts that still set old convars will no longer be read.

| Old Convar                          | New Convar                             |
| ----------------------------------- | -------------------------------------- |
| `mysql_connection_string`           | `re_mysql_connection_string`           |
| `mysql_connection_limit`            | `re_mysql_connection_limit`            |
| `mysql_queue_limit`                 | `re_mysql_queue_limit`                 |
| `mysql_slow_query_warning`          | `re_mysql_slow_query_warning`          |
| `mysql_resultset_warning`           | `re_mysql_resultset_warning`           |
| `mysql_transaction_isolation_level` | `re_mysql_transaction_isolation_level` |
| `mysql_debug`                       | `re_mysql_debug`                       |
| `mysql_ui`                          | `re_mysql_ui`                          |
| `mysql_log_size`                    | `re_mysql_log_size`                    |
| `mysql_logger_service`              | `re_mysql_logger_service`              |
| `mysql_versioncheck`                | `re_mysql_versioncheck`                |

**Migration in `server.cfg`:**

```diff
- set mysql_connection_string "mysql://user:pass@localhost/db"
+ set re_mysql_connection_string "mysql://user:pass@localhost/db"
```

### 2. mysql-async and ghmattimysql Compatibility Removed

`provide 'mysql-async'` and `provide 'ghmattimysql'` are removed from the manifest. Scripts that call `exports['mysql-async'].*` or `exports['ghmattimysql'].*` will fail.

**Migration:**

```lua
-- Before (mysql-async)
MySQL.Async.fetchAll('SELECT * FROM players WHERE identifier = ?', {identifier}, function(result) end)

-- After (reoxmysql)
exports.reoxmysql:query('SELECT * FROM players WHERE identifier = ?', {identifier}, function(result) end)

-- Or async
local result = exports.reoxmysql:query_async('SELECT * FROM players WHERE identifier = ?', {identifier})
```

### 3. Removed Exports

| Export          | Reason                                 |
| --------------- | -------------------------------------- |
| `MySQL.store`   | ghmatti/mysql-async compatibility shim |
| `MySQL.execute` | Deprecated alias of `MySQL.query`      |
| `MySQL.fetch`   | Deprecated alias of `MySQL.query`      |
| `${key}Sync`    | Deprecated alias - use `${key}_async`  |

---

## Library Upgrade

### mysql2: 3.11.3 → 3.22.2

Patch files renamed from `patches/mysql2+3.11.3.patch` to `patches/mysql2+3.22.2.patch`.

Changes applied to mysql2@3.22.2 (structure changed from 3.x — `lib/connection.js` split into `lib/base/connection.js` + `lib/packets/encode_parameter.js`):

| File                              | Change                                                     | Reason                                                 |
| --------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------ |
| `lib/parsers/binary_parser.js`    | `readLengthCodedBuffer()` → `[...readLengthCodedBuffer()]` | Lua cannot receive a `Buffer`; spread to plain array   |
| `lib/parsers/binary_parser.js`    | Add `charset: field.characterSet` to `wrap()`              | Expose charset so `typeCast` can detect BINARY columns |
| `lib/parsers/text_parser.js`      | Add `charset: field.characterSet` to `wrap()`              | Same as above for text (query) protocol                |
| `lib/packets/encode_parameter.js` | `undefined` → `''` + `Types.NULL` instead of throw         | Prevents crash on unexpected undefined parameters      |
| `typings/.../typeCast.d.ts`       | Add `charset: number` to `Field`                           | TypeScript type for the new `field.charset` usage      |

### named-placeholders: 1.1.3 → 1.1.6

Patch files renamed from `patches/named-placeholders+1.1.3.patch` to `patches/named-placeholders+1.1.6.patch`.

named-placeholders@1.1.6 uses `lru.min` for its internal parse-tree cache (same LRU library as mysql2). The named-placeholders factory now accepts `{ cache: N }` to size it:

```typescript
// config.ts — aligned to 500 entries, matching parseArguments meta cache
require('named-placeholders')({ cache: 500 });
```

Custom patch still applied to 1.1.6:

- `RE_PARAM` regex extended to match `@param` in addition to `:param`, with negative lookbehind to skip matches inside quoted strings
- Key prefix stripping (`@key` / `:key` → `key`) before token lookup
- `undefined` param values fall back to `null` instead of being pushed as-is

---

## Dual Database Engine: mysql2 or mariadb

ReoxMySQL now supports choosing between two database connectors at runtime via the `re_mysql_connector` convar:

| Convar               | Default  | Options              |
| -------------------- | -------- | -------------------- |
| `re_mysql_connector` | `mysql2` | `mysql2` / `mariadb` |

```lua
-- server.cfg
set re_mysql_connector "mysql2"   -- default, uses mysql2@3.22.2
set re_mysql_connector "mariadb"  -- uses mariadb@3.5.2
```

**Package versions (see `package.json`):**

| Package   | Version |
| --------- | ------- |
| `mysql2`  | 3.22.2  |
| `mariadb` | 3.5.2   |

Both connectors share the same pool-based architecture and expose identical behavior to Lua/JS consumers. The connector is selected once at startup — no restart of the resource is needed if the convar is set before `ensure reoxmysql`.

Key implementation details:

- `src/database/pool.ts` — `createConnectionPool()` branches on `mysql_connector`. The mariadb path uses an explicit `getConnection()` / `release()` startup probe.
- `src/database/connection.ts` — defines `MySql` (mysql2) and `MariaDbConnection` (mariadb). `getConnection()` returns the matching class. Both implement the same `.query()`, `.execute()`, `.beginTransaction()`, `.rollback()`, `.commit()`, `.release()` interface.
- mariadb does not support `typeCast`; instead `MariaDbConnection` normalizes results post-query to be byte-for-byte identical to mysql2's output (see CLAUDE.md § "mariadb Normalization").

---

## Bug Fixes

### `rawTransaction`: `transactionError` never returned its string

**File:** `src/database/rawTransaction.ts`

```typescript
// Before — template string was built but discarded (no return)
const transactionError = (...) => {
  `${queries.map(...).join('\n')}\n${JSON.stringify(parameters)}`;
};

// After
const transactionError = (...) => {
  return `${queries.map(...).join('\n')}\n${JSON.stringify(parameters)}`;
};
```

Effect: `transactionError(...)` always returned `undefined`. When `err.sql` was falsy, the message in `reoxmysql:transaction-error` event and the logger contained no query/parameter context.

---

### `typeCast`: NULL BLOB returned `[null]` instead of `null`

**File:** `src/utils/typeCast.ts`

mysql2@3.22.2 `text_parser.js` calls `typeCast` for **all** fields including NULL ones. In the text protocol (`query()`), `field.buffer()` returns `null` for a NULL column:

```typescript
// Before — [null] is a one-element array containing null
if (value === null) return [value];

// After — return null directly (SQL NULL → Lua nil)
if (value === null) return null;
```

A NULL BLOB column was previously delivered to Lua as `{ [1] = nil }` (single-element table with nil). Now it correctly arrives as `nil`.

---

## Performance Changes

### Batch Execute: Worker Pool with Concurrency Cap

**File:** `src/database/rawExecute.ts`

**Problem in OxMySQL:**
When `rawExecute` is called with many parameter sets, the whole batch is executed through unbounded `Promise.all`. With 50 parameter sets and a 25-connection pool, one batch can consume the entire pool, leaving no connections for `SELECT` queries from other resources.

```
OxMySQL:   batch(50 params) + pool(25) = 25 connections taken by batch, 0 for SELECT
ReoxMySQL: batch(50 params) + pool(25) = cap(15) for batch, >=10 left for SELECT
```

**Solution in ReoxMySQL:**
Worker-pool pattern with a cap of at most 60% of pool size:

```typescript
function getBatchLimit(): number {
  if (!_batchConcurrencyLimit) {
    _batchConcurrencyLimit = Math.max(4, Math.floor(GetConvarInt('re_mysql_connection_limit', 25) * 0.6));
  }
  return _batchConcurrencyLimit;
}

const runBatch = async () => {
  while (batchIndex < parameters.length) {
    const i = batchIndex++;
    const conn = await getConnection();
    try {
      results[i] = await conn.execute(query, parameters[i]);
    } finally {
      conn.release();
    }
  }
};
await Promise.all(Array.from({ length: concurrency }, runBatch));
```

This keeps part of the pool available for normal queries even during heavy batch load.

---

### Pool Ready: Promise Replaces Busy-Wait

**Files:** `src/database/pool.ts`, `src/database/connection.ts`, `src/index.ts`

**Problem in OxMySQL:**

```typescript
while (!pool) await sleep(0);
```

This burns CPU with repeated microtasks during startup.

**Solution in ReoxMySQL:**

```typescript
export const poolReady = new Promise<void>((resolve) => {
  _poolReadyResolve = resolve;
});

_poolReadyResolve?.();

if (!pool) await poolReady;
```

No wasted CPU while waiting for the first database connection.

---

### Connection Keep-Alive, Pool Idle Tuning, and New mysql2@3.22.2 Options

**Files:** `src/database/pool.ts`, `src/config.ts`

The pool supports all of the following:

- `enableKeepAlive: true` — prevent socket drops after MySQL `wait_timeout`
- `keepAliveInitialDelay: 0` — detect dead sockets immediately when a connection goes idle
- `re_mysql_max_idle_connections` — cap idle connections during quiet hours
- `re_mysql_idle_timeout` — recycle connections past this age (ms)
- `re_mysql_graceful_end` (new) — send COM_QUIT before closing idle connections (default on)
- `re_mysql_max_prepared_statements` (new) — per-connection prepared statement LRU size (default 500)
- `re_mysql_compress` (new) — MySQL protocol network compression (default off)

```typescript
// pool.ts
const maxIdle = GetConvarInt('re_mysql_max_idle_connections', connectionLimit);
const idleTimeout = GetConvarInt('re_mysql_idle_timeout', 60000);

createPool({
  ...config,   // gracefulEnd, maxPreparedStatements, compress come from getConnectionOptions()
  connectionLimit,
  waitForConnections: true,
  queueLimit,
  maxIdle,
  idleTimeout,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
});

// config.ts
return {
  ...options,
  gracefulEnd: GetConvarInt('re_mysql_graceful_end', 1) !== 0,
  maxPreparedStatements: GetConvarInt('re_mysql_max_prepared_statements', 500),
  compress: GetConvarInt('re_mysql_compress', 0) !== 0,
  ...
};
```

**`gracefulEnd`:** When an idle connection is recycled, `true` sends COM_QUIT before closing the socket — MySQL cleans up the thread immediately instead of waiting for TCP timeout. Prior behavior (`destroy()`) incremented `Aborted_clients` and left "sleep" rows in `SHOW PROCESSLIST`.

**`maxPreparedStatements`:** mysql2@3.22.2 creates one `lru.min` LRU per connection with `max: 16000` by default. A typical FiveM server has fewer than 200 unique `execute()` queries, so 500 is more than sufficient and lowers memory overhead per connection.

**`compress`:** MySQL protocol compression. Only useful when the DB server is on a different machine. On localhost or LAN the CPU cost outweighs the bandwidth savings.

---

### typeCast on Text Protocol (`query()`)

**File:** `src/database/connection.ts`

**Problem in OxMySQL:**
`typeCast` only applied to `execute()`. `query()` still returned raw types such as DATETIME strings or `TINYINT(1)` as `0`/`1`.

**Solution in ReoxMySQL:**

```diff
- const [result] = await this.connection.query(query, values);
+ const [result] = await this.connection.query({ sql: query, values, typeCast });
```

Result parsing is now consistent across query paths.

---

### Placeholder Cache and Query Meta Cache

**File:** `src/utils/parseArguments.ts`

ReoxMySQL caches query metadata so it does not repeatedly:

- rerun `/\?(?!\?)/g`
- rescan for `:` and `@`

```typescript
interface QueryMeta {
  placeholders: number;
  hasNamed: boolean;
}

const _queryMetaCache = new Map<string, QueryMeta>();
```

This is especially effective on ESX/QB servers where the same 50-200 query strings are repeated all day.

---

### parseExecute: Single-Pass Normalization

**File:** `src/utils/parseExecute.ts`

The old logic could traverse batch parameters multiple times with `.every()` plus `Object.entries()` allocations.

ReoxMySQL switches to single-pass classification and `for...in` iteration, reducing both CPU work and allocations during large batches.

---

### Scalar Value Extraction: Zero Allocation

**File:** `src/utils/parseResponse.ts`

**Old behavior:**

```typescript
return (row && Object.values(row)[0]) ?? null;
```

**New behavior:**

```typescript
if (!row) return null;
for (const key in row) return row[key];
return null;
```

This avoids creating arrays for scalar queries.

---

### Convar Refresh: Event-Driven Instead of Polling

**File:** `src/database/index.ts`

**Old behavior:**

```typescript
setInterval(() => {
  setDebug();
}, 1000);
```

**New behavior:**

```typescript
if (typeof AddConvarChangeListener === 'function') {
  AddConvarChangeListener('re_mysql_*', () => setDebug());
} else {
  setInterval(setDebug, 5000);
}
```

This removes constant polling on supported server builds.

---

### scheduleTick: Coalesced per Tick

**File:** `src/utils/scheduleTick.ts`

Instead of calling `ScheduleResourceTick` for every query, ReoxMySQL coalesces it so only one native call is made per tick.

```typescript
let _scheduled = false;
export function scheduleTick() {
  if (_scheduled) return;
  _scheduled = true;
  ScheduleResourceTick(resourceName);
  setImmediate(() => {
    _scheduled = false;
  });
}
```

This heavily reduces JS -> native overhead at high QPS.

---

### Logger Fast Path on rawQuery

**File:** `src/database/rawQuery.ts`

`rawQuery` now skips `logQuery()` entirely unless a query is actually slow or the UI logger is enabled.

```typescript
} else if (startTime) {
  const elapsed = performance.now() - startTime;
  if (elapsed >= mysql_slow_query_warning || mysql_ui)
    logQuery(invokingResource, query, elapsed, parameters);
}
```

This removes unnecessary hot-path work for the common case.

---

### Log Trim Amortized

**File:** `src/logger/index.ts`

Instead of `splice(0, 1)` on every insert after capacity is reached, logs now grow to a trim factor and then get sliced in chunks.

```typescript
const LOG_TRIM_FACTOR = 2;
else if (logStorage[resource].length >= mysql_log_size * LOG_TRIM_FACTOR) {
  logStorage[resource] = logStorage[resource].slice(mysql_log_size);
}
```

This turns repeated O(n) work into amortized trimming.

---

### Adaptive Batch Concurrency Cap

**File:** `src/database/pool.ts`

The static `getBatchLimit()` (computed once, never updated) has been replaced by `getLiveBatchLimit(paramCount)`, which reads the pool's live idle-connection count before each batch starts.

```typescript
export function getLiveBatchLimit(paramCount: number): number {
  // mysql2:  pool._freeConnections.length  (internal field)
  // mariadb: pool.idleConnections()        (public API)
  const idleCount = /* live read per connector */;
  return Math.min(Math.max(4, Math.floor(idleCount * 0.6)), paramCount);
}
```

At full pool idle the result is identical to the old static cap. Under load (e.g. 22 of 25 connections busy) the cap shrinks automatically:

```
pool idle=3  + batch(50 rows) → 4 workers  (was: 15 — would queue 12 behind busy pool)
pool idle=25 + batch(50 rows) → 15 workers (same as before)
```

---

### Early Connection Release Before Lua Callback

**Files:** `src/database/rawQuery.ts`, `src/database/rawExecute.ts`, `src/database/connection.ts`

`release()` on both connection classes is now idempotent (guarded by `this.id in activeConnections`). `rawQuery` and the `rawExecute` sequential path call `connection.release()` **before** invoking the Lua callback. The `using`-scope disposal at function exit becomes a no-op.

The `cb()` call crosses the JS → Lua bridge synchronously — the pool slot was previously held idle for the entire duration of Lua execution. With early release, the connection returns to the pool as soon as the result is ready.

---

### `setImmediate` Before Lua Callback

**Files:** `src/database/rawQuery.ts`, `src/database/rawExecute.ts`

All three callback dispatch points (`rawQuery`, `rawExecute` parallel path, `rawExecute` sequential path) now schedule `cb(result)` via `setImmediate` instead of calling it synchronously. Under concurrent query load this allows other pending query completions (queued as microtasks in the same tick) to run before any one of them crosses into Lua.

```
Before: query1 done → cb1() blocks Lua → query2 done → cb2() blocks Lua → ...
After:  query1 done → setImmediate(cb1)
        query2 done → setImmediate(cb2)
        [all 30 completions queued] → cb1() → cb2() → cb3() → ...
```

---

### Tick-Batched Write API: `MySQL.deferUpdate` / `MySQL.deferInsert`

**Files:** `src/database/tickBatcher.ts`, `src/database/rawDefer.ts`, `src/index.ts`

**Problem:**
On a server with 64 players, every resource that saves state on each game tick fires individual write calls. Five resources × 64 players = 320 pool acquisitions every 50 ms, all competing with SELECT queries for pool slots.

**Solution:**
Two opt-in exports that defer execution to a tick batcher instead of acquiring a connection immediately:

- `MySQL.deferUpdate(sql, params, cb)` — same API as `MySQL.update`, tick-batched
- `MySQL.deferInsert(sql, params, cb)` — same API as `MySQL.insert`, tick-batched

Writes with the same SQL string that arrive within the same event-loop tick are grouped in a `Map<sql, BatchEntry[]>`, flushed on `setImmediate`, then dispatched as a parallel worker pool using `getLiveBatchLimit()`.

```
64 × MySQL.deferUpdate("UPDATE players SET pos=? WHERE id=?")

Without:  64 pool acquisitions (immediate, competing with SELECT queries)
With:     0 acquisitions at call time
          setImmediate flush → 15 workers (60% of idle pool)
          64 DB executes across those 15 connections
          each callback dispatched individually via setImmediate
```

**When to use:**
Fire-and-forget saves where execution order relative to concurrent SELECT queries is not required — player position, health, hunger, job metadata, dirty money. Each result (affectedRows / insertId) is still delivered to its own callback.

**When NOT to use:**
If you fire a SELECT on the same row in the same tick without waiting for the write callback, use `MySQL.update` / `MySQL.insert` instead. The deferred write will reach the DB one macrotask later than the read.

```lua
-- Safe: result of write is used inside the callback (chained)
MySQL.deferUpdate("UPDATE players SET money=?", {money, id}, function(rows)
    if rows > 0 then giveItem(id, item) end
end)

-- Safe: pure fire-and-forget
MySQL.deferUpdate("UPDATE players SET pos=?", {pos, id})

-- Unsafe: read fires in same tick without waiting for write
MySQL.deferUpdate("UPDATE players SET money=?", {money, id})
MySQL.single("SELECT money FROM players WHERE id=?", {id}, cb) -- may read stale value
```

---

## Parallel Query API: `MySQL.parallel`

**Files:** `src/database/rawParallel.ts`, `src/index.ts`

Run multiple heterogeneous queries simultaneously — each query gets its own connection from the read (for SELECT) or write (for INSERT/UPDATE/DELETE) pool. Total wall-clock time equals the slowest individual query, not the sum of all queries.

```lua
-- Run 4 queries in parallel: 2 SELECTs + 2 INSERTs
MySQL.parallel({
    { type = "query", query = "SELECT * FROM users WHERE identifier = ?", params = { identifier } },
    { type = "single", query = "SELECT * FROM banlist WHERE identifier = ?", params = { identifier } },
    { type = "insert", query = "INSERT INTO log_auth (identifier, time) VALUES (?, ?)", params = { identifier, os.time() } },
    { type = "update", query = "UPDATE users SET lastlogin = ? WHERE identifier = ?", params = { os.time(), identifier } }
}, function(results)
    -- results[0] = all users (array)
    -- results[1] = ban info (single row or nil)
    -- results[2] = insertId
    -- results[3] = affectedRows
end)

-- Async version
local results = exports.reoxmysql:parallel_async(queries)
```

**Query types:**

| Type     | Result         | Pool used |
| -------- | -------------- | --------- |
| `query`  | Full row array | readPool   |
| `single` | First row      | readPool   |
| `scalar` | First column   | readPool   |
| `insert` | insertId       | writePool  |
| `update` | affectedRows   | writePool  |

Omitting `type` defaults to `query` (full result set).

---

## Available API

Use `exports.reoxmysql` for all calls:

| Export                             | Description                                               |
| ---------------------------------- | --------------------------------------------------------- |
| `query(sql, params, cb)`           | SELECT - return all rows                                  |
| `single(sql, params, cb)`          | SELECT - return the first row                             |
| `scalar(sql, params, cb)`          | SELECT - return first column from the first row           |
| `update(sql, params, cb)`          | UPDATE/DELETE - return `affectedRows`                     |
| `insert(sql, params, cb)`          | INSERT - return `insertId`                                |
| `transaction(queries, params, cb)` | Run multiple queries in a single transaction              |
| `startTransaction(fn)`             | Async function-based transaction (experimental)           |
| `prepare(sql, params, cb)`         | Batch execute with prepared statements, response unpacked |
| `rawExecute(sql, params, cb)`      | Batch execute without unpacking the response              |
| `parallel(queries, cb)`           | Run multiple heterogeneous queries simultaneously         |
| `deferUpdate(sql, params, cb)`     | UPDATE/DELETE - tick-batched, returns `affectedRows`      |
| `deferInsert(sql, params, cb)`     | INSERT - tick-batched, returns `insertId`                 |
| `isReady()`                        | Check whether the pool is ready (boolean)                 |
| `awaitConnection()`                | Promise that resolves when the pool is ready              |
| `*_async(...)`                     | Promise version of all exports above                      |
| `parallel_async(queries)`          | Promise version of `parallel`                             |

---

## Usage in Scripts

```lua
-- server.cfg
set re_mysql_connection_string "mysql://user:pass@127.0.0.1/database"
ensure reoxmysql

-- Lua (callback style)
exports.reoxmysql:query('SELECT * FROM players WHERE identifier = ?', {identifier}, function(result)
    print(#result .. ' players found')
end)

-- Lua (async)
local result = exports.reoxmysql:query_async('SELECT * FROM players WHERE identifier = ?', {identifier})
```

```js
// JavaScript / TypeScript (FiveM server-side)
const result = await exports.reoxmysql.query_async('SELECT * FROM players WHERE identifier = ?', [identifier]);
```
