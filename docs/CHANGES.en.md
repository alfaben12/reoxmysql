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

### Connection Keep-Alive and Pool Idle Tuning

**File:** `src/database/pool.ts`

The pool now supports:

- `enableKeepAlive: true`
- `keepAliveInitialDelay: 0`
- `re_mysql_max_idle_connections`
- `re_mysql_idle_timeout`

This gives better control over idle sockets, faster dead-socket detection, and lower reconnect overhead during burst traffic.

```typescript
const maxIdle = GetConvarInt('re_mysql_max_idle_connections', connectionLimit);
const idleTimeout = GetConvarInt('re_mysql_idle_timeout', 60000);

createPool({
  ...config,
  connectionLimit,
  waitForConnections: true,
  queueLimit,
  maxIdle,
  idleTimeout,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
});
```

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
