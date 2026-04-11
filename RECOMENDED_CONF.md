# ReoxMySQL — Recommended Configuration

All convars use the `re_` prefix to avoid collision with oxmysql or other MySQL resources.
Set them in your `server.cfg` **before** `ensure reoxmysql`.

---

## Minimal (Development / Single Server)

```cfg
# Required
set re_mysql_connection_string "mysql://user:password@localhost/database"
```

Everything else falls back to safe defaults. Suitable for local dev or a small server (<50 concurrent players).

---

## Standard (50–150 players)

```cfg
set re_mysql_connection_string "mysql://user:password@localhost/database"

# Pool — default 25 is fine; bump to 30-35 if you see pool-wait latency
set re_mysql_connection_limit  "30"

# Warn when a single query takes longer than 150 ms
set re_mysql_slow_query_warning "150"

# Warn when a result set exceeds 500 rows (catches N+1 query bugs early)
set re_mysql_resultset_warning  "500"

# READ COMMITTED — prevents phantom reads without the overhead of REPEATABLE READ
# 1 = REPEATABLE READ | 2 = READ COMMITTED | 3 = READ UNCOMMITTED | 4 = SERIALIZABLE
set re_mysql_transaction_isolation_level "2"
```

---

## High QPS (150–500 players)

```cfg
set re_mysql_connection_string "mysql://user:password@localhost/database?charset=utf8mb4&multipleStatements=false"

# ─── Pool ────────────────────────────────────────────────────────────────────
# Rule of thumb: (vCPUs on DB host × 2) + effective_spindle_count
# For a 8-core DB host with SSD: ~20-25 is optimal. Going above 50 rarely helps
# and adds scheduler overhead. Never exceed the MySQL max_connections setting.
set re_mysql_connection_limit  "40"

# 0 = unlimited queue (requests wait indefinitely — safe for bursts)
# Set a positive value only if you want hard-fail under extreme overload
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

---

## Ultra High QPS (2000+ players)

> **Penting:** Di scale ini bottleneck BUKAN di pool size atau reoxmysql — bottleneck ada di MySQL server itu sendiri (RAM, CPU, I/O). Config di bawah hanya optimal kalau hardware DB-nya juga memadai. Lihat bagian MySQL server tuning di bawah.

```cfg
# ─── Connection String ────────────────────────────────────────────────────────
# Gunakan IP langsung (bukan hostname) untuk menghindari DNS lookup per-connection
# namedPlaceholders=false: skip parsing jika semua query pakai ? bukan :name
set re_mysql_connection_string "mysql://user:password@127.0.0.1/database?charset=utf8mb4&namedPlaceholders=false&multipleStatements=false&connectTimeout=10000"

# ─── Pool Size ───────────────────────────────────────────────────────────────
# JANGAN naikan ke 200+ hanya karena player 2000.
# MySQL BUKAN designed untuk ratusan koneksi simultan — ada global mutex di InnoDB
# yang justru MELAMBAT saat koneksi terlalu banyak.
#
# Rumus optimal (dari riset Percona & HikariCP):
#   pool_size = (jumlah_CPU_core_di_DB_server × 2) + jumlah_disk_efektif
#
# Contoh hardware DB server:
#   8-core  + NVMe SSD  → 60  koneksi
#   16-core + NVMe SSD  → 75  koneksi
#   32-core + NVMe SSD  → 100 koneksi (hampir tidak perlu lebih)
#
# Di 2000 player dengan query rata-rata 2-5ms:
#   500 QPS × 0.003s rata² = 1.5 koneksi simultan yang AKTIF
#   Burst 2000 QPS × 0.003s = 6 koneksi aktif
#   Sisa pool = buffer untuk antrian burst tanpa drop
set re_mysql_connection_limit "75"

# Antrian tak terbatas — request tunggu dapat koneksi, tidak pernah hard-fail
# Jika queue menumpuk > 1 detik, itu sinyal DB server perlu upgrade hardware
set re_mysql_queue_limit "0"

# ─── Diagnostics ─────────────────────────────────────────────────────────────
# Di 2000 player, target query time < 50ms. Lebih dari itu ada yang salah.
set re_mysql_slow_query_warning "50"

# Result set besar = red flag (missing WHERE clause, no LIMIT, dll)
set re_mysql_resultset_warning "300"

# READ COMMITTED: terbaik untuk OLTP game server — isolasi cukup, throughput optimal
set re_mysql_transaction_isolation_level "2"

# ─── Production settings ─────────────────────────────────────────────────────
set re_mysql_ui       "false"   # Matikan di production — ada overhead logging
set re_mysql_log_size "0"       # Tidak dipakai kalau ui=false
set re_mysql_debug    "false"   # JANGAN aktifkan di production — memblokir parallel batch
set re_mysql_versioncheck "false" # Matikan di production (hemat koneksi keluar)
```

### Kenapa bukan 200 koneksi?

```
Simulasi: Pool 200 vs Pool 75 dengan 2000 players

Pool 200 koneksi:
  - MySQL harus maintain 200 thread simultan
  - InnoDB row-lock manager dikunci setiap thread contest
  - Context switching OS: 200 thread × overhead = latency naik
  - Memory: 200 × ~1MB per thread = 200MB hanya untuk thread stack

Pool 75 koneksi:
  - MySQL thread count rendah = lock contention rendah
  - Request yang antri: rata-rata tunggu < 1ms (query selesai cepat)
  - Memory overhead 3× lebih hemat
  - Latency per-query lebih RENDAH meski pool lebih kecil

Perbandingan nyata (Percona benchmark, 16-core server):
  Pool 512 koneksi → 42,000 TPS
  Pool  64 koneksi → 71,000 TPS  (69% lebih cepat dengan pool LEBIH KECIL)
```

---

## MySQL Server Tuning untuk 2000+ Players

### Hardware minimum yang dibutuhkan

| Komponen | Minimum | Recommended |
|----------|---------|-------------|
| CPU | 8 core | 16 core dedicated |
| RAM | 16 GB | 32 GB |
| Storage | SSD | NVMe SSD (< 0.1ms latency) |
| Network ke FiveM | 1 Gbps | 10 Gbps atau localhost |

> Kalau DB server dan FiveM di mesin yang sama: gunakan `127.0.0.1` di connection string. Loopback menghindari network stack sepenuhnya.

### my.cnf / my.ini (MySQL 8.0+)

```ini
[mysqld]
# ─── Connections ────────────────────────────────────────────────────────────
# Harus > re_mysql_connection_limit + headroom untuk monitoring tools
max_connections        = 300
thread_cache_size      = 100    # Cache thread OS supaya tidak recreate setiap koneksi baru
thread_stack           = 256K   # Default 1MB terlalu boros untuk game server queries

# ─── InnoDB Buffer Pool (SETTING TERPENTING) ─────────────────────────────────
# Set ke 70-75% dari total RAM server.
# Ini adalah cache untuk seluruh data + index — makin besar, makin sedikit disk I/O.
#
# Contoh:
#   16 GB RAM → innodb_buffer_pool_size = 11G
#   32 GB RAM → innodb_buffer_pool_size = 22G
#   64 GB RAM → innodb_buffer_pool_size = 45G
innodb_buffer_pool_size     = 22G

# 1 instance per ~1GB buffer pool, max 64. Mengurangi mutex contention antar thread.
innodb_buffer_pool_instances = 16

# ─── InnoDB I/O ──────────────────────────────────────────────────────────────
# O_DIRECT: bypass OS page cache untuk write (data sudah di InnoDB buffer pool)
# Hanya untuk Linux. Windows: pakai innodb_flush_method = async_unbuffered
innodb_flush_method     = O_DIRECT

# NVMe SSD: capacity 8000-16000. SATA SSD: 2000-4000. HDD: 200-400.
innodb_io_capacity      = 8000
innodb_io_capacity_max  = 16000

# Thread untuk background read/write I/O (optimal: jumlah CPU core / 2)
innodb_read_io_threads  = 8
innodb_write_io_threads = 8

# ─── InnoDB Redo Log ─────────────────────────────────────────────────────────
# Log besar = checkpoint lebih jarang = lebih sedikit I/O stall
# MySQL 8.0.30+: ini auto-managed, tidak perlu diset
innodb_log_file_size   = 2G
innodb_log_buffer_size = 256M

# ─── Durability (tradeoff: performa vs data safety) ─────────────────────────
# Nilai 2: flush ke OS buffer setiap commit, fsync ke disk setiap 1 detik.
# Risiko: kehilangan max 1 detik data jika server crash (acceptable untuk game).
# Nilai 1 (default MySQL): fsync setiap commit — paling aman tapi 3-10× lebih lambat.
innodb_flush_log_at_trx_commit = 2

# Jika tidak pakai MySQL replication, matikan binlog untuk menghilangkan overhead:
# skip_log_bin
# Jika pakai replication, gunakan:
sync_binlog = 0

# ─── InnoDB Concurrency ──────────────────────────────────────────────────────
# 0 = InnoDB manage sendiri (terbaik untuk most cases)
innodb_thread_concurrency = 0

# ─── Prepared Statement Cache ────────────────────────────────────────────────
# reoxmysql menggunakan execute() (prepared statements) untuk rawExecute
# Naikkan dari default 16384 ke 65536 untuk server dengan banyak resource
max_prepared_stmt_count = 65536

# ─── Table & Sort Cache ──────────────────────────────────────────────────────
table_open_cache         = 8000   # File descriptor cache untuk tabel yang sering diakses
table_definition_cache   = 4000   # Cache metadata tabel (CREATE TABLE info)
open_files_limit         = 65535  # Harus > table_open_cache × 2

# In-memory temp table sebelum spill ke disk (untuk GROUP BY, ORDER BY kompleks)
tmp_table_size    = 256M
max_heap_table_size = 256M

# ─── Slow Query Log ──────────────────────────────────────────────────────────
slow_query_log     = 1
long_query_time    = 0.05   # Log query > 50ms (sejajar dengan re_mysql_slow_query_warning)
log_queries_not_using_indexes = 0  # Matikan di production (terlalu verbose)

# ─── Character Set ───────────────────────────────────────────────────────────
character_set_server = utf8mb4
collation_server     = utf8mb4_unicode_ci
```

### Verifikasi buffer pool sudah cukup

Jalankan setelah server berjalan 30+ menit:

```sql
-- Buffer pool hit ratio — harus > 99% idealnya > 99.9%
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

-- Jika hit_ratio < 99%: naikkan innodb_buffer_pool_size
-- Jika hit_ratio = 100% dan RAM masih sisa: bisa turunkan sedikit
```

### Query yang WAJIB diindex di database game

Query lambat di 2000 player hampir selalu karena missing index, bukan karena pool size:

```sql
-- Cek query paling lambat (aktifkan slow_query_log dulu)
SELECT sql_text, exec_count, avg_latency
FROM sys.statement_analysis
ORDER BY avg_latency DESC
LIMIT 20;

-- Cek tabel yang sering full-scan (tidak pakai index)
SELECT object_schema, object_name, count_read, count_fetch
FROM performance_schema.table_io_waits_summary_by_table
WHERE object_schema NOT IN ('mysql','performance_schema','information_schema','sys')
ORDER BY count_fetch DESC
LIMIT 20;
```

Index yang biasa missing di server ESX/QB-Core:

```sql
-- Identifier kolom paling sering di-WHERE
ALTER TABLE players     ADD INDEX idx_identifier (identifier);
ALTER TABLE owned_vehicles ADD INDEX idx_owner (owner);
ALTER TABLE player_outfits ADD INDEX idx_citizenid (citizenid);
ALTER TABLE apartments   ADD INDEX idx_owner (owner);
-- dst. sesuai script yang dipakai
```

---

## Convar Reference

| Convar | Type | Default | Description |
|--------|------|---------|-------------|
| `re_mysql_connection_string` | string | `""` | MySQL connection URI atau key=value string. **Wajib diisi.** |
| `re_mysql_connection_limit` | int | `25` | Max koneksi simultan ke MySQL |
| `re_mysql_queue_limit` | int | `0` | Max antrian koneksi (0 = unlimited) |
| `re_mysql_slow_query_warning` | int | `200` | Ambang batas (ms) untuk log slow query |
| `re_mysql_resultset_warning` | int | `1000` | Ambang batas baris untuk peringatan result set besar |
| `re_mysql_transaction_isolation_level` | int | `2` | 1=REPEATABLE READ, 2=READ COMMITTED, 3=READ UNCOMMITTED, 4=SERIALIZABLE |
| `re_mysql_debug` | bool/json | `false` | Log semua query: `true` (semua), atau `["resource"]` (targeted) |
| `re_mysql_ui` | bool | `false` | Aktifkan in-game `/mysql` monitor UI |
| `re_mysql_log_size` | int | `100` | Kapasitas log query per-resource di UI |
| `re_mysql_logger_service` | string | `""` | Path ke custom logger module |
| `re_mysql_versioncheck` | bool | `true` | Cek GitHub untuk versi terbaru saat startup |

---

## Connection String Formats

```cfg
# URI format (recommended)
set re_mysql_connection_string "mysql://user:password@127.0.0.1/database"

# Key-value format
set re_mysql_connection_string "host=127.0.0.1;user=user;password=password;database=database"
```

### Query string options (URI format)

| Option | Contoh | Keterangan |
|--------|--------|------------|
| `charset` | `charset=utf8mb4` | Selalu gunakan utf8mb4 |
| `namedPlaceholders` | `namedPlaceholders=false` | Matikan jika semua query pakai `?` |
| `connectTimeout` | `connectTimeout=10000` | Timeout koneksi dalam ms (default 60000) |
| `ssl` | `ssl={"rejectUnauthorized":true}` | Aktifkan TLS |
| `multipleStatements` | `multipleStatements=false` | Jangan aktifkan di production (SQL injection risk) |
