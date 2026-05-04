# ReoxMySQL — mysql2 vs mariadb Connector

This document helps you choose between the two supported connectors.

| Connector | Package                                                                      | Version          |
| --------- | ---------------------------------------------------------------------------- | ---------------- |
| `mysql2`  | [`mysql2`](https://github.com/sidorares/node-mysql2)                         | 3.22.2 (patched) |
| `mariadb` | [`mariadb`](https://github.com/mariadb-corporation/mariadb-connector-nodejs) | 3.5.2            |

Switch at any time with a single convar — no script changes needed.

```cfg
# server.cfg
set re_mysql_connector "mysql2"    # default
set re_mysql_connector "mariadb"   # alternative
```

---

## Quick Decision

| Your situation                                      | Use                     |
| --------------------------------------------------- | ----------------------- |
| Running **MySQL Server** (Oracle/Percona/AWS RDS)   | `mysql2`                |
| Running **MariaDB Server** (self-hosted or managed) | `mariadb`               |
| Running **Galera Cluster** or **MariaDB Xpand**     | `mariadb`               |
| Not sure which DB server you have                   | `mysql2` (safe default) |
| Need fine-grained idle pool control                 | `mysql2`                |
| Need the MariaDB-specific `timeout` query hint      | `mariadb`               |
| Using AWS Aurora (MySQL-compatible)                 | `mysql2`                |
| Using AWS Aurora (MariaDB-compatible)               | `mariadb`               |

---

## mysql2

### Pros

**More pool control options.**
mysql2 exposes `queueLimit`, `maxIdle` (separate from `connectionLimit`), `gracefulEnd`, `enableKeepAlive`, and `keepAliveInitialDelay`. You can tune exactly how many idle connections to keep warm and how they are recycled. mariadb does not have an equivalent of `maxIdle`.

**`gracefulEnd` keeps your MySQL processlist clean.**
When an idle connection closes, mysql2 sends `COM_QUIT` first so MySQL removes the thread immediately. Without this, MySQL marks it `Aborted_clients` and you may see ghost threads in `SHOW PROCESSLIST`. mariadb does not have this option.

**Keep-alive detects dead connections proactively.**
`enableKeepAlive: true` + `keepAliveInitialDelay: 0` sends TCP keep-alive packets from the first second. Dead connections (network drop, firewall timeout) are found before a query tries to use them. mariadb relies on the OS-level TCP keep-alive instead, which is typically much slower to fire.

**`typeCast` runs at the field level — zero post-processing overhead.**
Type conversions (DATETIME → ms, TINYINT(1) → bool, BLOB → byte array) happen column-by-column as the wire protocol is decoded. There is no second pass over the result rows.

**More production time in this fork.**
mysql2 is the original connector this resource was built on. It has more field testing time and all edge cases (auth plugin errors, connection retry logic, convar mapping) are well-exercised.

**Works with MySQL 8.0+ caching_sha2_password by default.**
No extra authentication plugin setup needed for modern MySQL deployments.

### Cons

**Not the native driver for MariaDB Server.**
mysql2 speaks the MySQL wire protocol, which MariaDB is compatible with. But MariaDB-specific features (e.g. `SET STATEMENT max_statement_time=… FOR`, Galera-specific status variables, MariaDB 10.x JSON functions) may behave subtly differently or require workarounds.

**No per-query timeout hint on MariaDB.**
MariaDB's `SET STATEMENT max_statement_time=X FOR <query>` syntax (native timeout per query) is not triggered by mysql2 because mysql2 does not know it is talking to a MariaDB server.

**`queueLimit = 0` (unlimited) can mask pool exhaustion.**
When the pool is saturated, mysql2 queues requests indefinitely instead of rejecting them. This is configurable (`re_mysql_queue_limit`), but the default lets problems hide.

---

## mariadb

### Pros

**Official MariaDB Corporation driver.**
Written and maintained by MariaDB themselves. Understands MariaDB-specific protocol extensions, authentication methods (ed25519, PAM, Parsec), and server capabilities that mysql2 does not.

**Per-query timeout on MariaDB is supported natively.**
The mariadb connector can prepend `SET STATEMENT max_statement_time=X FOR` automatically when you pass a `timeout` option, which works only on MariaDB 10.1.2+. mysql2 cannot do this.

**`insertIdAsNumber` and `bigIntAsNumber` are explicit pool-level options.**
Both are set to `true` in this implementation, so `INSERT` results always return a JavaScript `Number` for `insertId` and `BIGINT` SELECT columns never return a `BigInt`. The behavior is identical to mysql2 without any extra typeCast logic.

**`prepareCacheSize` maps directly to MariaDB's prepared statement cache.**
The cache is built into the mariadb driver; no patch-package override is needed like mysql2 requires.

**Better for Galera Cluster.**
The mariadb connector understands Galera-specific server status bits and handles replication-aware routing better than mysql2.

### Cons

**Result normalization adds a post-query pass.**
mariadb does not support `typeCast` callbacks. Instead, after every query, `normalizeMariaDbResult()` checks whether any column type needs conversion and, if so, rebuilds every row as a plain object. For queries that return many rows with DATETIME, TINYINT(1), BIT, or BLOB columns, this is a measurable extra allocation. Queries returning only VARCHAR/INT/FLOAT skip the rebuild (fast path), but the `meta.some()` scan still runs.

**Fewer pool options.**
mariadb has no equivalent of `maxIdle` (separate from `connectionLimit`), `queueLimit`, `gracefulEnd`, or `enableKeepAlive`/`keepAliveInitialDelay`. You cannot limit how many idle connections to keep warm independently of the connection cap. If pool tuning is critical to you, mysql2 gives more levers.

**`idleTimeout` is in seconds (not ms).**
This is handled automatically internally (`Math.round(idleTimeout / 1000)`), but it means the minimum effective idle timeout is 1 second, not 1 ms. If you set `re_mysql_idle_timeout` to a value under 1000, it rounds to 0 (no timeout).

**Less testing time in this specific fork.**
The mariadb connector path was added after mysql2. If you encounter an edge case, there is less prior evidence to draw from.

**Pool event model is non-obvious.**
The mariadb pool's `'connection'` event passes a `ConnectionPromise` wrapper (not a raw connection), fired via `setImmediate` after a new physical connection is established. The `'acquire'` event passes a raw callback-style connection — do not call `.query(sqlString)` on it. This matters only if you extend or debug the pool code.

---

## Side-by-Side Feature Comparison

| Feature                                          | mysql2                        | mariadb                           |
| ------------------------------------------------ | ----------------------------- | --------------------------------- |
| MySQL Server support                             | Full                          | Compatible (wire protocol)        |
| MariaDB Server support                           | Compatible (wire protocol)    | Full (native)                     |
| MariaDB per-query timeout (`max_statement_time`) | No                            | Yes (10.1.2+)                     |
| Galera Cluster awareness                         | No                            | Yes                               |
| `typeCast` callback (field-level)                | Yes                           | No (post-process instead)         |
| Result normalization pass                        | No                            | Yes (skipped for simple types)    |
| `maxIdle` separate from `connectionLimit`        | Yes                           | No                                |
| `queueLimit`                                     | Yes                           | No                                |
| `gracefulEnd` (COM_QUIT on idle close)           | Yes                           | No                                |
| TCP keep-alive control                           | Yes (`keepAliveInitialDelay`) | OS-level only                     |
| `insertIdAsNumber`                               | Via typeCast                  | Pool option                       |
| `bigIntAsNumber`                                 | Via typeCast                  | Pool option                       |
| Named placeholder support                        | Via patch                     | Pool option (`namedPlaceholders`) |
| Ed25519 / PAM authentication                     | No                            | Yes                               |
| `re_mysql_queue_limit` convar                    | Works                         | Not applicable (ignored)          |
| `re_mysql_max_idle_connections` convar           | Works                         | Not applicable (ignored)          |
| `re_mysql_graceful_end` convar                   | Works                         | Not applicable (ignored)          |

---

## Performance Notes

### Connector difference: where type conversion happens

Both connectors produce **identical results** to Lua scripts. The difference is where the work happens:

- **mysql2**: type conversion runs field-by-field at the protocol decode layer via `typeCast`. There is no second pass over the result rows — cost is O(columns), paid once per row during wire read.
- **mariadb**: type conversion is a post-query pass (`normalizeMariaDbResult`). It first scans column metadata; if no column needs conversion (pure VARCHAR/INT/FLOAT result) it returns the original array unchanged. If any column needs conversion it rebuilds every row as a plain object. Cost is O(rows × columns), paid after the full result is in memory.

For a typical FiveM server (`SELECT identifier, money, job FROM players`) the rows contain only strings and integers — mariadb hits the fast path and the difference is negligible. For large result sets with DATETIME, TINYINT(1), BIT, or BLOB columns, mysql2 has a measurable edge.

---

### Shared improvements vs OxMySQL (apply to both connectors)

The following optimizations are active regardless of which connector you use. They are listed here because they affect the numbers you will see on a profiler or slow-query log.

**Batch execute: worker pool with 60% concurrency cap**
OxMySQL runs batch `rawExecute` calls through an unbounded `Promise.all`. With 50 parameter sets on a 25-connection pool, one batch can consume the entire pool, starving `SELECT` queries from other resources.

```
OxMySQL:   batch(50 params) + pool(25) → 25 connections taken, 0 left for SELECT
ReoxMySQL: batch(50 params) + pool(25) → cap(15) for batch, ≥10 left for SELECT
```

ReoxMySQL uses a worker-pool pattern: `Math.max(4, floor(poolSize × 0.6))` workers run concurrently. Each worker claims the next unclaimed parameter slot until the batch is done. This keeps part of the pool always available for normal queries.

---

**Pool ready: Promise replaces busy-wait**
OxMySQL spins `while (!pool) await sleep(0)` in every consumer during startup, burning CPU with repeated microtasks.

ReoxMySQL resolves a single `poolReady` Promise once the pool is assigned. Consumers that arrive before the pool is ready simply `await poolReady` — zero CPU until the connection is established.

---

**typeCast applied to text-protocol `query()` as well as `execute()`**
OxMySQL only applied `typeCast` to binary-protocol `execute()` calls. Text-protocol `query()` returned raw values: DATETIME as a string, TINYINT(1) as `0`/`1`.

ReoxMySQL passes `typeCast` to both `query()` and `execute()`, so `DATETIME → ms`, `TINYINT(1) → bool`, `BLOB → byte array` consistently regardless of which call path is used.

---

**Query meta cache: placeholder count + named scan cached together**
OxMySQL rescans every query string on every call: runs `/\?(?!\?)/g` and two `.includes()` checks per invocation.

ReoxMySQL caches `{ placeholders, hasNamed }` per query string in an LRU-bounded Map (max 500 entries). On a typical ESX/QB server with 50–200 unique query strings repeated thousands of times per minute, this removes thousands of regex runs and string scans from the hot loop entirely.

---

**`parseExecute` batch normalization: single pass**
OxMySQL classifies batch parameters using up to three `.every()` traversals plus `Object.entries()` allocations per call.

ReoxMySQL uses a single `for` loop that classifies shape (all-arrays / all-objects / flat) and builds the output in one pass, with `for...in` instead of `Object.entries()`.

---

**Scalar value extraction: zero allocation**
OxMySQL: `Object.values(row)[0]` — allocates a temporary array of all values to get just the first one.

ReoxMySQL: `for (const key in row) return row[key]` — returns the first property directly with no allocation.

---

**`scheduleTick` coalesced per tick**
OxMySQL calls `ScheduleResourceTick` (a FiveM JS-to-native round trip) once per query. At 500 QPS that is 500 native calls per second.

ReoxMySQL coalesces all calls within a single tick into one:

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

At any QPS, exactly one `ScheduleResourceTick` fires per event-loop tick.

---

**Convar refresh: event-driven instead of polling**
OxMySQL calls `setDebug()` (which reads convars and parses JSON) every 1 second via `setInterval`, running forever even when nothing changes.

ReoxMySQL uses `AddConvarChangeListener('re_mysql_*', setDebug)` — fires only when a convar actually changes. Falls back to `setInterval(setDebug, 5000)` on older server builds that do not expose the native.

---

**Logger fast path on `rawQuery`**
OxMySQL always calls `logQuery()` on the hot path regardless of whether slow-query logging is enabled.

ReoxMySQL gates the call inline: `if (elapsed >= mysql_slow_query_warning || mysql_ui)`. Fast queries (the vast majority on a healthy server) skip the full log function call entirely.

---

**Log trim: amortized instead of O(n) per insert**
OxMySQL trims the query log with `splice(0, 1)` on every insert after capacity is reached — O(n) cost on every query once the log fills up.

ReoxMySQL lets the log grow to `capacity × 2`, then slices off the oldest half in one call. The trim cost is amortized over `capacity` inserts rather than paid on every single one.

---

**Connection keep-alive and pool idle tuning**
OxMySQL does not configure TCP keep-alive; connections silently die after MySQL's `wait_timeout` elapses without detection.

ReoxMySQL sets `enableKeepAlive: true` + `keepAliveInitialDelay: 0` (mysql2 only) so dead sockets are detected immediately when they go idle rather than at the next query. Separately, `re_mysql_max_idle_connections` lets you cap idle connections during quiet hours without reducing the burst `connectionLimit`.

---

## Switching Between Connectors

1. Change the convar in `server.cfg`:
   ```cfg
   set re_mysql_connector "mariadb"
   ```
2. Restart the reoxmysql resource (`restart reoxmysql`) or the full server.
3. No other changes needed — the public API is identical.

> The pool startup log shows which connector is active:
>
> ```
> [10.11.1] Database server connection established!
> Pool: 25 max, idleTimeout: 60000ms, maxStmt: 500, [mariadb]
> ```
>
> The `[mariadb]` tag at the end confirms the active connector.
