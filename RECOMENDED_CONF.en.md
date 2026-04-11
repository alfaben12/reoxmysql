# ReoxMySQL — Recommended Config

All convars use the `re_` prefix so they do not clash with oxmysql or other MySQL resources.
Put them in `server.cfg` **before** `ensure reoxmysql`.

---

## Minimal (Development / Small Server)

```cfg
# Required
set re_mysql_connection_string "mysql://user:password@localhost/database"
```

If this is just for local dev or a small server (<50 concurrent players), this is enough. Everything else can stay on the safe defaults.

---

## Standard (50-150 players)

```cfg
set re_mysql_connection_string "mysql://user:password@localhost/database"

# Pool — default 25 is already fine; bump it to 30-35 if you start seeing pool wait time
set re_mysql_connection_limit  "30"

# Warn if a single query takes longer than 150 ms
set re_mysql_slow_query_warning "150"

# Warn if a result set goes over 500 rows
# Handy for catching N+1 query issues early
set re_mysql_resultset_warning  "500"

# READ COMMITTED — safe and light for most game servers
# 1 = REPEATABLE READ | 2 = READ COMMITTED | 3 = READ UNCOMMITTED | 4 = SERIALIZABLE
set re_mysql_transaction_isolation_level "2"
```

This is usually the sweet spot for a decently active server that is not doing anything too extreme yet.

---

## High QPS (150-500 players)

```cfg
set re_mysql_connection_string "mysql://user:password@localhost/database?charset=utf8mb4&multipleStatements=false"

# ─── Pool ────────────────────────────────────────────────────────────────────
# Easy rule of thumb: (DB host vCPU count × 2) + effective spindle count
# On an 8-core DB host with SSD, 20-25 is usually already solid.
# Going above 50 rarely helps and can add extra scheduler overhead.
# Do not go above MySQL's max_connections.
set re_mysql_connection_limit  "40"

# 0 = unlimited queue
# Requests wait instead of failing immediately during spikes
set re_mysql_queue_limit "0"

# ─── Diagnostics ─────────────────────────────────────────────────────────────
set re_mysql_slow_query_warning "100"
set re_mysql_resultset_warning  "500"
set re_mysql_transaction_isolation_level "2"

# ─── UI / Logging ────────────────────────────────────────────────────────────
set re_mysql_ui       "false"
set re_mysql_log_size "200"
set re_mysql_debug    "false"
```

Use this when the server is getting busy and you want a more performance-focused setup.

---

## Very High QPS (2000+ players)

> **Important:** At this scale, the bottleneck is usually not reoxmysql or the pool size. It is the MySQL server itself: CPU, RAM, and I/O. This config only shines if the database machine is strong enough too.

```cfg
# ─── Connection String ───────────────────────────────────────────────────────
# Use a direct IP instead of a hostname so you avoid DNS lookup per connection
# namedPlaceholders=false: good if all your queries use ? instead of :name
set re_mysql_connection_string "mysql://user:password@127.0.0.1/database?charset=utf8mb4&namedPlaceholders=false&multipleStatements=false&connectTimeout=10000"

# ─── Pool Size ───────────────────────────────────────────────────────────────
# Do not jump to 200+ just because you have 2000 players.
# MySQL does not like a huge amount of simultaneous connections.
# Too many connections can actually slow things down because of lock contention and context switching.
#
# Common rule of thumb:
#   pool_size = (DB CPU core count × 2) + effective_spindle_count
#
# Rough examples:
#   8-core  + NVMe SSD  → 60 connections
#   16-core + NVMe SSD  → 75 connections
#   32-core + NVMe SSD  → 100 connections
#
# At 2000 players with average query time around 2-5ms:
#   500 QPS × 0.003s = 1.5 active concurrent connections on average
#   Burst 2000 QPS × 0.003s = 6 active connections
# The rest is just buffer for bursts
set re_mysql_connection_limit "75"

# Unlimited queue
# If the queue starts stacking for more than 1 second, your DB server is probably the real problem
set re_mysql_queue_limit "0"

# ─── Diagnostics ─────────────────────────────────────────────────────────────
# At this scale, query time should ideally stay under 50ms
set re_mysql_slow_query_warning "50"

# Big result sets are usually a sign that a query needs cleanup
set re_mysql_resultset_warning "300"

# READ COMMITTED is the most sensible choice for game server OLTP workloads
set re_mysql_transaction_isolation_level "2"

# ─── Production settings ─────────────────────────────────────────────────────
set re_mysql_ui       "false"   # Keep it off in production
set re_mysql_log_size "0"       # Not used if ui=false
set re_mysql_debug    "false"   # Do not enable in production
set re_mysql_versioncheck "false" # Optional, saves an outbound check
```

### Why not 200 connections?

```
Example: Pool 200 vs Pool 75 at 2000 players

Pool 200:
  - MySQL has to manage 200 active threads
  - Lock contention goes up
  - OS context switching goes up
  - Memory usage is higher just for thread stacks

Pool 75:
  - Fewer threads = less lock contention
  - Queued requests usually still move quickly
  - Memory overhead is much lower
  - Query latency can actually be better

Real benchmark (Percona, 16-core server):
  Pool 512 connections → 42,000 TPS
  Pool  64 connections → 71,000 TPS
```

So yeah, more connections does not automatically mean more performance.

---

## MySQL Server Tuning for 2000+ Players

### Hardware that actually makes sense

| Component        | Minimum | Recommended                |
| ---------------- | ------- | -------------------------- |
| CPU              | 8 core  | 16 dedicated cores         |
| RAM              | 16 GB   | 32 GB                      |
| Storage          | SSD     | NVMe SSD (< 0.1ms latency) |
| Network to FiveM | 1 Gbps  | 10 Gbps or localhost       |

> If the DB server and FiveM run on the same machine, use `127.0.0.1` in the connection string. Simple and fast.

### my.cnf / my.ini (MySQL 8.0+)

```ini
[mysqld]
# ─── Connections ────────────────────────────────────────────────────────────
# Must be larger than re_mysql_connection_limit + some headroom for monitoring tools
max_connections        = 300
thread_cache_size      = 100    # Reuse OS threads instead of rebuilding them constantly
thread_stack           = 256K   # 1MB default is often wasteful for game server workloads

# ─── InnoDB Buffer Pool (MOST IMPORTANT SETTING) ────────────────────────────
# Set this to around 70-75% of total RAM.
# This is the main cache for data and indexes.
# Bigger buffer pool = less disk I/O.
#
# Examples:
#   16 GB RAM → innodb_buffer_pool_size = 11G
#   32 GB RAM → innodb_buffer_pool_size = 22G
#   64 GB RAM → innodb_buffer_pool_size = 45G
innodb_buffer_pool_size     = 22G

# Roughly 1 instance per ~1GB of buffer pool, up to 64
innodb_buffer_pool_instances = 16

# ─── InnoDB I/O ─────────────────────────────────────────────────────────────
# O_DIRECT: bypass OS page cache for writes
# Linux only. On Windows, use async_unbuffered
innodb_flush_method     = O_DIRECT

# NVMe SSD: 8000-16000. SATA SSD: 2000-4000. HDD: 200-400.
innodb_io_capacity      = 8000
innodb_io_capacity_max  = 16000

# Background read/write I/O threads
innodb_read_io_threads  = 8
innodb_write_io_threads = 8

# ─── InnoDB Redo Log ────────────────────────────────────────────────────────
# Bigger logs = fewer checkpoints = fewer stalls
# MySQL 8.0.30+ usually auto-manages this well
innodb_log_file_size   = 2G
innodb_log_buffer_size = 256M

# ─── Durability (performance vs safety tradeoff) ────────────────────────────
# Value 2: flush to OS buffer on each commit, fsync to disk every 1 second
# Usually acceptable for game servers
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

# In-memory temp tables before spilling to disk
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

### Check whether your buffer pool is big enough

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

-- If hit_ratio < 99%: buffer pool is probably too small
-- If hit_ratio = 100% and you still have spare RAM: you can lower it a bit
```

### Queries that should absolutely be indexed in a game database

If things get slow at 2000 players, the issue is usually not pool size. It is almost always missing indexes or ugly queries.

```sql
-- Check slowest queries
SELECT sql_text, exec_count, avg_latency
FROM sys.statement_analysis
ORDER BY avg_latency DESC
LIMIT 20;

-- Check tables that are getting a lot of full scans
SELECT object_schema, object_name, count_read, count_fetch
FROM performance_schema.table_io_waits_summary_by_table
WHERE object_schema NOT IN ('mysql','performance_schema','information_schema','sys')
ORDER BY count_fetch DESC
LIMIT 20;
```

Common missing indexes on ESX/QB-Core servers:

```sql
ALTER TABLE players        ADD INDEX idx_identifier (identifier);
ALTER TABLE owned_vehicles ADD INDEX idx_owner (owner);
ALTER TABLE player_outfits ADD INDEX idx_citizenid (citizenid);
ALTER TABLE apartments     ADD INDEX idx_owner (owner);
-- and so on, depending on your scripts
```

---

## Convar Reference

| Convar                                 | Type      | Default | Description                                                             |
| -------------------------------------- | --------- | ------- | ----------------------------------------------------------------------- |
| `re_mysql_connection_string`           | string    | `""`    | MySQL URI or `key=value` connection string. **Required.**               |
| `re_mysql_connection_limit`            | int       | `25`    | Maximum concurrent MySQL connections                                    |
| `re_mysql_queue_limit`                 | int       | `0`     | Maximum queued connection requests (0 = unlimited)                      |
| `re_mysql_slow_query_warning`          | int       | `200`   | Threshold in ms for slow query warnings                                 |
| `re_mysql_resultset_warning`           | int       | `1000`  | Row threshold for large result set warnings                             |
| `re_mysql_transaction_isolation_level` | int       | `2`     | 1=REPEATABLE READ, 2=READ COMMITTED, 3=READ UNCOMMITTED, 4=SERIALIZABLE |
| `re_mysql_debug`                       | bool/json | `false` | Log all queries: `true` (all), or `["resource"]` (targeted)             |
| `re_mysql_ui`                          | bool      | `false` | Enable the in-game `/mysql` monitor UI                                  |
| `re_mysql_log_size`                    | int       | `100`   | Per-resource query log capacity in the UI                               |
| `re_mysql_logger_service`              | string    | `""`    | Path to a custom logger module                                          |
| `re_mysql_versioncheck`                | bool      | `true`  | Check GitHub for newer versions on startup                              |

---

## Connection String Formats

```cfg
# URI format (recommended)
set re_mysql_connection_string "mysql://user:password@127.0.0.1/database"

# Key-value format
set re_mysql_connection_string "host=127.0.0.1;user=user;password=password;database=database"
```

### Query string options (URI format)

| Option               | Example                           | Notes                                            |
| -------------------- | --------------------------------- | ------------------------------------------------ |
| `charset`            | `charset=utf8mb4`                 | Always use utf8mb4                               |
| `namedPlaceholders`  | `namedPlaceholders=false`         | Disable if all queries use `?`                   |
| `connectTimeout`     | `connectTimeout=10000`            | Connection timeout in ms (default 60000)         |
| `ssl`                | `ssl={"rejectUnauthorized":true}` | Enable TLS                                       |
| `multipleStatements` | `multipleStatements=false`        | Keep this off in production (SQL injection risk) |
