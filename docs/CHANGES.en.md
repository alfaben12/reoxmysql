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
| Batch execute                | Unbounded `Promise.all`        | Worker pool capped to 60% of pool                         |
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
| mysql2 version               | Patched 3.11.3                 | Patched 3.22.0                                            |
| named-placeholders version   | Patched 1.1.3                  | Patched 1.1.6 (LRU cache via `lru.min`)                   |
| Config documentation         | None                           | `RECOMENDED_CONF.id.md` / `RECOMENDED_CONF.en.md`         |

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

### mysql2: 3.11.3 → 3.22.0

Patch files renamed from `patches/mysql2+3.11.3.patch` to `patches/mysql2+3.22.0.patch`.

Changes applied to mysql2@3.22.0 (structure changed from 3.x — `lib/connection.js` split into `lib/base/connection.js` + `lib/packets/encode_parameter.js`):

| File | Change | Reason |
|------|--------|--------|
| `lib/parsers/binary_parser.js` | `readLengthCodedBuffer()` → `[...readLengthCodedBuffer()]` | Lua cannot receive a `Buffer`; spread to plain array |
| `lib/parsers/binary_parser.js` | Add `charset: field.characterSet` to `wrap()` | Expose charset so `typeCast` can detect BINARY columns |
| `lib/parsers/text_parser.js` | Add `charset: field.characterSet` to `wrap()` | Same as above for text (query) protocol |
| `lib/packets/encode_parameter.js` | `undefined` → `''` + `Types.NULL` instead of throw | Prevents crash on unexpected undefined parameters |
| `typings/.../typeCast.d.ts` | Add `charset: number` to `Field` | TypeScript type for the new `field.charset` usage |

### named-placeholders: 1.1.3 → 1.1.6

Patch files renamed from `patches/named-placeholders+1.1.3.patch` to `patches/named-placeholders+1.1.6.patch`.

named-placeholders@1.1.6 uses `lru.min` for its internal parse-tree cache (same LRU library as mysql2). The named-placeholders factory now accepts `{ cache: N }` to size it:

```typescript
// config.ts — aligned to 500 entries, matching parseArguments meta cache
require('named-placeholders')({ cache: 500 })
```

Custom patch still applied to 1.1.6:
- `RE_PARAM` regex extended to match `@param` in addition to `:param`, with negative lookbehind to skip matches inside quoted strings
- Key prefix stripping (`@key` / `:key` → `key`) before token lookup
- `undefined` param values fall back to `null` instead of being pushed as-is

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

mysql2@3.22.0 `text_parser.js` calls `typeCast` for **all** fields including NULL ones. In the text protocol (`query()`), `field.buffer()` returns `null` for a NULL column:

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

### Connection Keep-Alive, Pool Idle Tuning, and New mysql2@3.22.0 Options

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

**`maxPreparedStatements`:** mysql2@3.22.0 creates one `lru.min` LRU per connection with `max: 16000` by default. A typical FiveM server has fewer than 200 unique `execute()` queries, so 500 is more than sufficient and lowers memory overhead per connection.

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

## Available API

Use `exports.reoxmysql` for all calls:

| Export                             | Description                                               |
| ---------------------------------- | --------------------------------------------------------- |
| `query(sql, params, cb)`           | SELECT - return all rows                                  |
| `single(sql, params, cb)`          | SELECT - return the first row                             |
| `scalar(sql, params, cb)`          | SELECT - return the first column from the first row       |
| `update(sql, params, cb)`          | UPDATE/DELETE - return `affectedRows`                     |
| `insert(sql, params, cb)`          | INSERT - return `insertId`                                |
| `transaction(queries, params, cb)` | Run multiple queries in a single transaction              |
| `startTransaction(fn)`             | Async function-based transaction (experimental)           |
| `prepare(sql, params, cb)`         | Batch execute with prepared statements, response unpacked |
| `rawExecute(sql, params, cb)`      | Batch execute without unpacking the response              |
| `isReady()`                        | Check whether the pool is ready (boolean)                 |
| `awaitConnection()`                | Promise that resolves when the pool is ready              |
| `*_async(...)`                     | Promise version of all exports above                      |

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
