# ReoxMySQL — Recommended Config

All convars use the `re_` prefix so they do not clash with oxmysql or other MySQL resources.
Put them in `server.cfg` **before** `ensure reoxmysql`.

---

## Minimal (Development / Small Server)

```cfg
# Required
set re_mysql_connection_string "mysql://user:password@localhost/database"
```

If this is only for local dev or a small server (<50 concurrent players), this is enough. Leave the rest on the safe defaults.

---

## Standard (50-150 players)

```cfg
set re_mysql_connection_string "mysql://user:password@localhost/database"

# Pool — the default 25 is already fine; raise it to 30-35 if you start seeing pool wait time
set re_mysql_connection_limit  "30"

# Idle pool: keep all connections warm (= connection_limit).
# If your server is often quiet during certain hours and you want MySQL to relax a bit,
# lower this number (for example 10) so idle connections get recycled.
set re_mysql_max_idle_connections "30"

# Idle connections past this threshold (ms) will be closed.
set re_mysql_idle_timeout "60000"

# Warn if a query takes longer than 150 ms
set re_mysql_slow_query_warning "150"

# Warn if a query returns more than 500 rows
# Good for catching N+1 query bugs earlier
set re_mysql_resultset_warning  "500"

# READ COMMITTED — safe and light for most game servers
# 1 = REPEATABLE READ | 2 = READ COMMITTED | 3 = READ UNCOMMITTED | 4 = SERIALIZABLE
set re_mysql_transaction_isolation_level "2"
```

If your server is fairly active but not at hardcore scale yet, this config is usually the best fit.

---

## High QPS (150-500 players)

```cfg
set re_mysql_connection_string "mysql://user:password@localhost/database?charset=utf8mb4&multipleStatements=false"

# ─── Pool ────────────────────────────────────────────────────────────────────
# Easy rule of thumb: (DB host vCPU count × 2) + effective disk count
# If the DB host has 8 cores with SSD, 20-25 is usually already solid.
# Going above 50 usually does not help much and can add overhead instead.
# Do not go beyond MySQL's max_connections.
set re_mysql_connection_limit  "40"

# Match connection_limit so every connection stays warm (hot pool).
set re_mysql_max_idle_connections "40"

# 60 seconds: idle connections older than this get closed on the MySQL side.
# Raise it to 300000 (5 minutes) if you have burst traffic at certain times.
set re_mysql_idle_timeout "60000"

# 0 = unlimited queue
# Requests will wait instead of failing immediately during load spikes
set re_mysql_queue_limit "0"

# ─── Diagnostics ──────────────────────────────────────────────────────────────
set re_mysql_slow_query_warning "100"
set re_mysql_resultset_warning  "500"
set re_mysql_transaction_isolation_level "2"

# ─── Connection behavior ─────────────────────────────────────────────────────
# gracefulEnd: send COM_QUIT before closing idle connections (keeps MySQL processlist clean)
set re_mysql_graceful_end "1"

# Per-connection prepared statement LRU cache (mysql2 default = 16000, 500 is enough for FiveM)
set re_mysql_max_prepared_statements "500"

# ─── UI / Logging ────────────────────────────────────────────────────────────
set re_mysql_ui       "false"
set re_mysql_log_size "200"
set re_mysql_debug    "false"
```

This section fits when the server is busy enough that you are starting to care more seriously about performance.

---

## Very High QPS (2000+ players)

> **Important:** At this scale, the bottleneck is usually not reoxmysql or pool size, but the MySQL server itself: CPU, RAM, and I/O. This config only pays off fully if your database machine is actually strong enough.

```cfg
# ─── Connection String ───────────────────────────────────────────────────────
# Use a direct IP (127.0.0.1 if co-located, or an internal LAN IP).
# Avoid hostnames so there is no DNS lookup on each connection.
# namedPlaceholders=false: required for maximum performance if all queries
# use positional ? placeholders — parseArguments gets the zero-overhead fast path.
# compress=false: CPU on both sides matters more than localhost bandwidth.
set re_mysql_connection_string "mysql://user:password@127.0.0.1/database?charset=utf8mb4&namedPlaceholders=false&multipleStatements=false&connectTimeout=10000&dateStrings=false&supportBigNumbers=true"

# ─── Pool Size ───────────────────────────────────────────────────────────────
# Do not jump straight to 200+ just because you have 2000 players.
# MySQL does not like too many simultaneous connections.
# Too many connections actually make InnoDB heavier because of lock contention and context switching.
#
# Common formula:
#   pool_size = (DB CPU core count × 2) + effective disk count
#
# Rough examples:
#   8-core  + NVMe SSD  → 60 connections
#   16-core + NVMe SSD  → 75 connections
#   32-core + NVMe SSD  → 100 connections
#
# At 2000 players with average query time around 2-5ms:
#   500 QPS × 0.003s = 1.5 active connections on average
#   Burst 2000 QPS × 0.003s = 6 active connections
# The rest only needs to be burst buffer.
#
# ReoxMySQL already caps batch execute to 60% of the pool (= 45 out of 75).
# So the other 30 connections are always available for SELECT queries and never starved.
set re_mysql_connection_limit "75"

# Match connection_limit: every connection stays hot, so there is no reconnect
# overhead during sudden bursts. Lower it only if MySQL often hits max_connections
# and you need to leave some breathing room for other resources.
set re_mysql_max_idle_connections "75"

# 5 minutes: anything idle longer than this gets closed. TCP keep-alive packets
# still run every second (keepAliveInitialDelay=0), so dead connections are
# detected much earlier than this timeout anyway.
set re_mysql_idle_timeout "300000"

# Unlimited queue
# If queue time stacks beyond 1 second, your DB server is starting to run out of breath
set re_mysql_queue_limit "0"

# ─── Diagnostics ──────────────────────────────────────────────────────────────
# At this scale, query target should be < 50ms
set re_mysql_slow_query_warning "50"

# Large result sets usually mean a query needs cleanup
set re_mysql_resultset_warning "300"

# READ COMMITTED is the most sensible option for game servers
set re_mysql_transaction_isolation_level "2"

# ─── Connection behavior ─────────────────────────────────────────────────────
# gracefulEnd: COM_QUIT on idle recycle. Keeps SHOW PROCESSLIST clean and Aborted_clients at 0.
set re_mysql_graceful_end "1"

# Prepared statement cache per connection. Default 16000 is excessive for FiveM.
# Typical server has < 200 unique execute() queries. 500 is more than enough.
set re_mysql_max_prepared_statements "500"

# compress: useful only if DB is on a DIFFERENT machine.
# On localhost (same machine) leave this at 0 — CPU cost > bandwidth savings.
set re_mysql_compress "0"

# ─── Production settings ─────────────────────────────────────────────────────
set re_mysql_ui       "false"   # Disable in production to keep it lighter
set re_mysql_log_size "0"       # Unused when ui=false
set re_mysql_debug    "false"   # Do not enable in production — disables per-query profiler
set re_mysql_versioncheck "false" # Optional to disable if you want fewer outbound checks
```

### Why this configuration is efficient for 2000+ players

1. **Batch execute does not monopolize the pool.** `rawExecute` / `prepare` with many
   parameters is capped to 60% of the pool (`floor(75 × 0.6) = 45`). The other 30 stay
   free for SELECT queries, so player login/profile lookups never wait behind giant batches.

2. **`namedPlaceholders=false` gives a fast path.** The query parser skips scanning `:` / `@`
   and directly uses cached placeholder counts. At 5,000 QPS that removes about 5,000 regex
   runs + 10,000 `.includes()` calls per second from the hot loop.

3. **Promise pool is ready.** When the server starts, other resources that issue queries
   before the pool is ready do not spin in a busy-wait loop — they just `await` the Promise,
   so CPU stays idle.

4. **scheduleTick is coalesced.** No matter how many queries you send in one tick,
   only one `ScheduleResourceTick` native gets called.

5. **Convar listener is event-driven.** There is no more `setInterval(setDebug, 1000)`
   running for the entire server lifetime. Convars refresh only when their value is
   actually changed by command.

6. **Keep-alive is instant.** `keepAliveInitialDelay=0` helps detect dead connections
   before users start seeing errors.

7. **Logger fast path.** In `rawQuery`, `logQuery()` only runs if the query is actually
   slow or the UI is enabled. Fast queries (99%+ on a healthy server) skip the full
   function call entirely.

### Why not 200 connections?

```
Example: Pool 200 vs Pool 75 at 2000 players

Pool 200 connections:
  - MySQL has to handle 200 simultaneous threads
  - Lock contention increases
  - OS context switching increases
  - More memory gets used just for thread stacks

Pool 75 connections:
  - Fewer threads = lower lock contention
  - Queued requests usually still move quickly
  - Much lower memory overhead
  - Query latency can actually be lower

Real benchmark (Percona, 16-core server):
  Pool 512 connections → 42,000 TPS
  Pool  64 connections → 71,000 TPS
```

The point: more connections are not automatically faster.

---

## MySQL Server Tuning for 2000+ Players

### Minimum hardware that still makes sense

| Component        | Minimum | Recommended                |
| ---------------- | ------- | -------------------------- |
| CPU              | 8 core  | 16 dedicated cores         |
| RAM              | 16 GB   | 32 GB                      |
| Storage          | SSD     | NVMe SSD (< 0.1ms latency) |
| Network to FiveM | 1 Gbps  | 10 Gbps or localhost       |

> If the DB server and FiveM are on the same machine, use `127.0.0.1` in the connection string. Simpler and faster.

### my.cnf / my.ini (MySQL 8.0+)

```ini
[mysqld]
# ─── Connections ────────────────────────────────────────────────────────────
# Must be larger than re_mysql_connection_limit + headroom for monitoring tools
max_connections        = 300
thread_cache_size      = 100    # Keep OS threads cached instead of recreating them constantly
thread_stack           = 256K   # The 1MB default is usually too wasteful for game server workloads

# ─── InnoDB Buffer Pool (MOST IMPORTANT SETTING) ────────────────────────────
# Set this to around 70-75% of total server RAM.
# This is the main cache for data and indexes.
# The bigger it is, the lower the chance of disk I/O.
#
# Examples:
#   16 GB RAM → innodb_buffer_pool_size = 11G
#   32 GB RAM → innodb_buffer_pool_size = 22G
#   64 GB RAM → innodb_buffer_pool_size = 45G
innodb_buffer_pool_size     = 22G

# Roughly 1 instance per ~1GB of buffer pool, up to 64
innodb_buffer_pool_instances = 16

# ─── InnoDB I/O ─────────────────────────────────────────────────────────────
# O_DIRECT: direct writes, bypassing OS page cache
# Linux only. On Windows, use async_unbuffered
innodb_flush_method     = O_DIRECT

# NVMe SSD: 8000-16000. SATA SSD: 2000-4000. HDD: 200-400.
innodb_io_capacity      = 8000
innodb_io_capacity_max  = 16000

# Background threads for read/write I/O
innodb_read_io_threads  = 8
innodb_write_io_threads = 8

# ─── InnoDB Redo Log ────────────────────────────────────────────────────────
# Larger logs = fewer checkpoints = fewer stalls
# MySQL 8.0.30+ usually auto-manages this already
innodb_log_file_size   = 2G
innodb_log_buffer_size = 256M

# ─── Durability (performance vs data safety tradeoff) ───────────────────────
# Value 2: flush to OS buffer on each commit, fsync to disk every 1 second
# Usually still acceptable for game servers
innodb_flush_log_at_trx_commit = 2

# If you do not use replication, binlog can be disabled:
# skip_log_bin
# If you do use replication:
sync_binlog = 0

# ─── InnoDB Concurrency ─────────────────────────────────────────────────────
# 0 = let InnoDB manage it automatically
innodb_thread_concurrency = 0

# ─── Prepared Statement Cache ───────────────────────────────────────────────
# reoxmysql uses execute() for rawExecute
# Raise this if your server runs a lot of resources
max_prepared_stmt_count = 65536

# ─── Table & Sort Cache ─────────────────────────────────────────────────────
table_open_cache         = 8000
table_definition_cache   = 4000
open_files_limit         = 65535

# Temp tables kept in RAM before spilling to disk
tmp_table_size      = 256M
max_heap_table_size = 256M

# ─── Slow Query Log ─────────────────────────────────────────────────────────
slow_query_log     = 1
long_query_time    = 0.05
log_queries_not_using_indexes = 0

# ─── Character Set ──────────────────────────────────────────────────────────
character_set_server = utf8mb4
collation_server     = utf8mb4_unicode_ci
```

### Check whether your buffer pool is large enough

Run this after the server has been up for at least 30 minutes:

```sql
-- Buffer pool hit ratio — safe target > 99%, ideal target > 99.9%
SELECT
  FORMAT((1 - (Innodb_buffer_pool_reads / Innodb_buffer_pool_read_requests)) * 100, 4) AS hit_ratio_pct
FROM (
  SELECT
    variable_value AS Innodb_buffer_pool_reads
  FROM performance_schema.global_status
  WHERE variable_name = 'Innodb_buffer_pool_reads'
) r,
(
  SELECT
    variable_value AS Innodb_buffer_pool_read_requests
  FROM performance_schema.global_status
  WHERE variable_name = 'Innodb_buffer_pool_read_requests'
) rr;

-- If hit_ratio < 99%: buffer pool is too small
-- If hit_ratio = 100% and RAM is still roomy: you can lower it a bit
```

### Queries that must be indexed in a game database

If your server starts slowing down at 2000 players, the issue is usually not pool size. It is almost always missing indexes or messy queries.

```sql
-- Check the slowest queries
SELECT sql_text, exec_count, avg_latency
FROM sys.statement_analysis
ORDER BY avg_latency DESC
LIMIT 20;

-- Check tables that get frequent full scans
SELECT object_schema, object_name, count_read, count_fetch
FROM performance_schema.table_io_waits_summary_by_table
WHERE object_schema NOT IN ('mysql','performance_schema','information_schema','sys')
ORDER BY count_fetch DESC
LIMIT 20;
```

Examples of indexes that are often missing on ESX/QB-Core servers:

```sql
ALTER TABLE players        ADD INDEX idx_identifier (identifier);
ALTER TABLE owned_vehicles ADD INDEX idx_owner (owner);
ALTER TABLE player_outfits ADD INDEX idx_citizenid (citizenid);
ALTER TABLE apartments     ADD INDEX idx_owner (owner);
-- and so on, depending on the scripts you use
```

---

## Convar Reference

| Convar                                 | Type      | Default   | Description                                                             |
| -------------------------------------- | --------- | --------- | ----------------------------------------------------------------------- |
| `re_mysql_connection_string`           | string    | `""`      | MySQL connection URI or `key=value` format. **Required.**               |
| `re_mysql_connection_limit`            | int       | `25`      | Maximum concurrent MySQL connections                                    |
| `re_mysql_max_idle_connections`        | int       | `= limit` | Maximum idle connections kept alive in the pool                         |
| `re_mysql_idle_timeout`                | int       | `60000`   | Idle timeout (ms) — idle connections longer than this get closed        |
| `re_mysql_graceful_end`                | int       | `1`       | `1` = send COM_QUIT before closing idle connections; `0` = destroy()    |
| `re_mysql_max_prepared_statements`     | int       | `500`     | Per-connection LRU cache size for prepared statements                   |
| `re_mysql_compress`                    | int       | `0`       | `1` = enable MySQL protocol compression (remote DB only)                |
| `re_mysql_queue_limit`                 | int       | `0`       | Maximum connection queue size (0 = unlimited)                           |
| `re_mysql_slow_query_warning`          | int       | `200`     | Threshold in ms for slow query warnings                                 |
| `re_mysql_resultset_warning`           | int       | `1000`    | Row threshold for large result set warnings                             |
| `re_mysql_transaction_isolation_level` | int       | `2`       | 1=REPEATABLE READ, 2=READ COMMITTED, 3=READ UNCOMMITTED, 4=SERIALIZABLE |
| `re_mysql_debug`                       | bool/json | `false`   | Log all queries: `true` (all), or `["resource"]` (specific)             |
| `re_mysql_ui`                          | bool      | `false`   | Enable the in-game `/mysql` monitor UI                                  |
| `re_mysql_log_size`                    | int       | `100`     | Per-resource query log capacity in the UI                               |
| `re_mysql_logger_service`              | string    | `""`      | Path to a custom logger module                                          |
| `re_mysql_versioncheck`                | bool      | `true`    | Check GitHub for a newer version on startup                             |

---

## Connection String Formats

```cfg
# URI format (most recommended)
set re_mysql_connection_string "mysql://user:password@127.0.0.1/database"

# Key-value format
set re_mysql_connection_string "host=127.0.0.1;user=user;password=password;database=database"
```

### Query string options (URI format)

| Option               | Example                           | Description                                      |
| -------------------- | --------------------------------- | ------------------------------------------------ |
| `charset`            | `charset=utf8mb4`                 | Always use utf8mb4                               |
| `namedPlaceholders`  | `namedPlaceholders=false`         | Disable it if all queries use `?`                |
| `connectTimeout`     | `connectTimeout=10000`            | Connection timeout in ms (default 60000)         |
| `ssl`                | `ssl={"rejectUnauthorized":true}` | Enable TLS                                       |
| `multipleStatements` | `multipleStatements=false`        | Do not enable in production (SQL injection risk) |
| `compress`           | `compress=true`                   | Network compression — remote DB only, not localhost |
