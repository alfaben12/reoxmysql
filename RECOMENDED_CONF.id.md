# ReoxMySQL — Konfigurasi Rekomendasi

Semua convar pakai prefix `re_` biar tidak bentrok sama oxmysql atau resource MySQL lain.
Pasangnya di `server.cfg` **sebelum** `ensure reoxmysql`.

---

## Minimal (Development / Server Kecil)

```cfg
# Wajib
set re_mysql_connection_string "mysql://user:password@localhost/database"
```

Kalau cuma buat dev lokal atau server kecil (<50 player barengan), ini sudah cukup. Sisanya biarkan pakai default yang aman.

---

## Standar (50-150 player)

```cfg
set re_mysql_connection_string "mysql://user:password@localhost/database"

# Pool — default 25 sebenarnya sudah oke; naikkan ke 30-35 kalau mulai ada wait di pool
set re_mysql_connection_limit  "30"

# Idle pool: biarkan semua koneksi tetap warm (= connection_limit).
# Kalau server kamu sering sepi di jam tertentu dan ingin MySQL lebih longgar,
# turunin angka ini (contoh 10) supaya koneksi idle di-recycle.
set re_mysql_max_idle_connections "30"

# Koneksi idle yang lewat ambang ini (ms) akan ditutup.
set re_mysql_idle_timeout "60000"

# Kasih warning kalau ada query yang lebih dari 150 ms
set re_mysql_slow_query_warning "150"

# Kasih warning kalau hasil query lebih dari 500 baris
# Ini bagus buat nangkep bug N+1 query lebih cepat
set re_mysql_resultset_warning  "500"

# READ COMMITTED — aman dan ringan buat kebanyakan server game
# 1 = REPEATABLE READ | 2 = READ COMMITTED | 3 = READ UNCOMMITTED | 4 = SERIALIZABLE
set re_mysql_transaction_isolation_level "2"
```

Kalau server kamu sudah lumayan rame tapi belum level hardcore, config ini biasanya paling pas.

---

## QPS Tinggi (150-500 player)

```cfg
set re_mysql_connection_string "mysql://user:password@localhost/database?charset=utf8mb4&multipleStatements=false"

# ─── Pool ────────────────────────────────────────────────────────────────────
# Patokan gampangnya: (jumlah vCPU di host DB × 2) + jumlah disk efektif
# Kalau DB host 8 core pakai SSD, biasanya 20-25 sudah mantep.
# Di atas 50 biasanya tidak terlalu ngaruh, malah bisa nambah overhead.
# Jangan sampai lewat dari max_connections milik MySQL.
set re_mysql_connection_limit  "40"

# Samakan dengan connection_limit biar semua koneksi tetap hangat (hot pool).
set re_mysql_max_idle_connections "40"

# 60 detik: koneksi idle yang lebih lama dari ini akan ditutup MySQL side.
# Naikkan jadi 300000 (5 menit) kalau ada burst pattern di waktu tertentu.
set re_mysql_idle_timeout "60000"

# 0 = antrean tanpa batas
# Jadi request akan nunggu, bukan langsung gagal saat ada lonjakan beban
set re_mysql_queue_limit "0"

# ─── Diagnostik ──────────────────────────────────────────────────────────────
set re_mysql_slow_query_warning "100"
set re_mysql_resultset_warning  "500"
set re_mysql_transaction_isolation_level "2"

# ─── UI / Logging ────────────────────────────────────────────────────────────
set re_mysql_ui       "false"
set re_mysql_log_size "200"
set re_mysql_debug    "false"
```

Bagian ini cocok kalau server sudah cukup sibuk dan kamu mulai peduli performa lebih serius.

---

## QPS Sangat Tinggi (2000+ player)

> **Penting:** Di skala segini, bottleneck biasanya bukan di reoxmysql atau ukuran pool, tapi di server MySQL itu sendiri: CPU, RAM, dan I/O. Jadi config ini cuma terasa maksimal kalau mesin database kamu memang kuat.

```cfg
# ─── Connection String ───────────────────────────────────────────────────────
# Pakai IP langsung (127.0.0.1 kalau co-located, atau IP LAN internal).
# Jangan hostname biar tidak ada DNS lookup tiap koneksi.
# namedPlaceholders=false: wajib untuk performa maksimal kalau semua query
# pakai ? positional — fast path di parseArguments jadi zero-overhead.
# compress=false: CPU di kedua sisi lebih penting dari bandwidth localhost.
set re_mysql_connection_string "mysql://user:password@127.0.0.1/database?charset=utf8mb4&namedPlaceholders=false&multipleStatements=false&connectTimeout=10000&dateStrings=false&supportBigNumbers=true"

# ─── Pool Size ───────────────────────────────────────────────────────────────
# Jangan langsung naikin ke 200+ cuma karena player 2000.
# MySQL tidak suka koneksi simultan kebanyakan.
# Terlalu banyak koneksi malah bikin InnoDB makin berat gara-gara lock dan context switching.
#
# Rumus yang umum dipakai:
#   pool_size = (jumlah_core_CPU_DB × 2) + jumlah_disk_efektif
#
# Contoh kasar:
#   8-core  + NVMe SSD  → 60 koneksi
#   16-core + NVMe SSD  → 75 koneksi
#   32-core + NVMe SSD  → 100 koneksi
#
# Di 2000 player dengan query rata-rata 2-5ms:
#   500 QPS × 0.003s = 1.5 koneksi aktif rata-rata
#   Burst 2000 QPS × 0.003s = 6 koneksi aktif
# Sisanya cukup jadi buffer saat ada lonjakan.
#
# ReoxMySQL sudah cap batch execute ke 60% dari pool (= 45 dari 75).
# Jadi 30 koneksi sisanya selalu tersedia buat SELECT query, tidak pernah starved.
set re_mysql_connection_limit "75"

# Samakan dengan connection_limit: semua koneksi tetap hot, tidak ada reconnect
# overhead saat burst mendadak. Turunkan hanya kalau MySQL kamu sering kena
# batas max_connections dan kamu butuh kasih "nafas" ke resource lain.
set re_mysql_max_idle_connections "75"

# 5 menit: idle yang lebih lama dari ini ditutup. Keep-alive TCP packet
# tetap jalan tiap detik (keepAliveInitialDelay=0), jadi koneksi mati
# lebih cepat ketahuan jauh sebelum timeout ini.
set re_mysql_idle_timeout "300000"

# Antrean tanpa batas
# Kalau antrean sampai numpuk lebih dari 1 detik, itu tandanya DB server kamu mulai ngos-ngosan
set re_mysql_queue_limit "0"

# ─── Diagnostik ──────────────────────────────────────────────────────────────
# Di skala ini, target query sebaiknya < 50ms
set re_mysql_slow_query_warning "50"

# Result set besar biasanya tanda ada query yang kurang rapi
set re_mysql_resultset_warning "300"

# READ COMMITTED paling masuk akal buat game server
set re_mysql_transaction_isolation_level "2"

# ─── Production settings ─────────────────────────────────────────────────────
set re_mysql_ui       "false"   # Matikan di production biar lebih ringan
set re_mysql_log_size "0"       # Tidak kepakai kalau ui=false
set re_mysql_debug    "false"   # Jangan nyalakan di production — matikan profiler per-query
set re_mysql_versioncheck "false" # Boleh dimatikan biar hemat koneksi keluar
```

### Kenapa konfigurasi ini efisien buat 2000+ player

1. **Batch execute tidak monopoli pool.** `rawExecute` / `prepare` dengan banyak
   parameter di-cap ke 60% pool (`floor(75 × 0.6) = 45`). Sisanya (30) selalu
   bebas buat SELECT. Jadi query login/profile player tidak pernah nunggu batch
   besar selesai.

2. **`namedPlaceholders=false` ± fast-path.** Query parser skip scan `:` / `@`
   dan langsung pakai cache placeholder count. Di 5,000 QPS ini = ~5,000 regex
   + 10,000 `.includes()` call per detik yang hilang dari hot loop.

3. **Promise pool ready.** Saat server baru mulai, resource lain yang manggil
   query sebelum pool siap tidak bikin busy-wait loop — mereka langsung `await`
   Promise, CPU tidur.

4. **scheduleTick coalesced.** Berapa pun query yang kamu kirim di satu tick,
   cuma satu `ScheduleResourceTick` native yang dipanggil.

5. **Convar listener event-driven.** Tidak ada lagi `setInterval(setDebug, 1000)`
   yang jalan seumur hidup server. Convar refresh cuma fire saat nilainya
   benar-benar diubah pakai command.

6. **Keep-alive instant.** `keepAliveInitialDelay=0` bikin koneksi mati
   ketahuan sebelum ada user yang kena error.

7. **Logger fast-path.** Di rawQuery, `logQuery()` cuma dipanggil kalau query
   beneran lambat atau UI aktif. Query cepat (99%+ di server sehat) skip full
   function call sama sekali.

### Kenapa bukan 200 koneksi?

```
Simulasi: Pool 200 vs Pool 75 di 2000 player

Pool 200 koneksi:
  - MySQL harus urus 200 thread simultan
  - Lock contention naik
  - Context switching OS makin banyak
  - Memory kepakai lebih besar cuma buat thread stack

Pool 75 koneksi:
  - Thread lebih sedikit = kontestasi lock lebih rendah
  - Request yang antre biasanya tetap cepat lewat
  - Memori jauh lebih hemat
  - Latency query malah bisa lebih rendah

Benchmark nyata (Percona, server 16-core):
  Pool 512 koneksi → 42,000 TPS
  Pool  64 koneksi → 71,000 TPS
```

Intinya: koneksi lebih banyak belum tentu lebih cepat.

---

## Tuning MySQL Server untuk 2000+ Player

### Minimum hardware yang masuk akal

| Komponen         | Minimum | Rekomendasi                |
| ---------------- | ------- | -------------------------- |
| CPU              | 8 core  | 16 core dedicated          |
| RAM              | 16 GB   | 32 GB                      |
| Storage          | SSD     | NVMe SSD (< 0.1ms latency) |
| Network ke FiveM | 1 Gbps  | 10 Gbps atau localhost     |

> Kalau DB server dan FiveM ada di mesin yang sama, pakai `127.0.0.1` di connection string. Lebih simpel dan lebih cepat.

### my.cnf / my.ini (MySQL 8.0+)

```ini
[mysqld]
# ─── Connections ────────────────────────────────────────────────────────────
# Harus lebih besar dari re_mysql_connection_limit + cadangan buat tool monitoring
max_connections        = 300
thread_cache_size      = 100    # Simpan thread OS biar tidak bikin ulang terus
thread_stack           = 256K   # Default 1MB biasanya terlalu boros buat workload game server

# ─── InnoDB Buffer Pool (SETTING PALING PENTING) ────────────────────────────
# Set ke sekitar 70-75% dari total RAM server.
# Ini cache utama buat data dan index.
# Makin besar, makin kecil kemungkinan kena disk I/O.
#
# Contoh:
#   16 GB RAM → innodb_buffer_pool_size = 11G
#   32 GB RAM → innodb_buffer_pool_size = 22G
#   64 GB RAM → innodb_buffer_pool_size = 45G
innodb_buffer_pool_size     = 22G

# Kira-kira 1 instance per ~1GB buffer pool, maksimal 64
innodb_buffer_pool_instances = 16

# ─── InnoDB I/O ─────────────────────────────────────────────────────────────
# O_DIRECT: write langsung, tidak lewat OS page cache
# Linux only. Kalau Windows, pakai async_unbuffered
innodb_flush_method     = O_DIRECT

# NVMe SSD: 8000-16000. SATA SSD: 2000-4000. HDD: 200-400.
innodb_io_capacity      = 8000
innodb_io_capacity_max  = 16000

# Background thread untuk read/write I/O
innodb_read_io_threads  = 8
innodb_write_io_threads = 8

# ─── InnoDB Redo Log ────────────────────────────────────────────────────────
# Log besar = checkpoint lebih jarang = lebih sedikit stall
# MySQL 8.0.30+ biasanya sudah auto-manage
innodb_log_file_size   = 2G
innodb_log_buffer_size = 256M

# ─── Durability (tradeoff performa vs keamanan data) ────────────────────────
# Nilai 2: flush ke OS buffer tiap commit, fsync ke disk tiap 1 detik
# Buat game server biasanya masih oke
innodb_flush_log_at_trx_commit = 2

# Kalau tidak pakai replication, binlog bisa dimatikan:
# skip_log_bin
# Kalau pakai replication:
sync_binlog = 0

# ─── InnoDB Concurrency ─────────────────────────────────────────────────────
# 0 = biarkan InnoDB yang atur sendiri
innodb_thread_concurrency = 0

# ─── Prepared Statement Cache ───────────────────────────────────────────────
# reoxmysql pakai execute() untuk rawExecute
# Naikkan kalau resource di server banyak
max_prepared_stmt_count = 65536

# ─── Table & Sort Cache ─────────────────────────────────────────────────────
table_open_cache         = 8000
table_definition_cache   = 4000
open_files_limit         = 65535

# Temp table di RAM sebelum spill ke disk
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

### Cek buffer pool kamu cukup atau tidak

Jalankan setelah server hidup minimal 30 menit:

```sql
-- Buffer pool hit ratio — target aman > 99%, idealnya > 99.9%
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

-- Kalau hit_ratio < 99%: buffer pool kurang besar
-- Kalau hit_ratio = 100% dan RAM masih longgar: bisa sedikit diturunin
```

### Query yang wajib diindeks di database game

Kalau server mulai lambat di 2000 player, biasanya masalahnya bukan pool size. Hampir selalu karena index kurang atau query kurang rapi.

```sql
-- Cek query paling lambat
SELECT sql_text, exec_count, avg_latency
FROM sys.statement_analysis
ORDER BY avg_latency DESC
LIMIT 20;

-- Cek tabel yang sering full scan
SELECT object_schema, object_name, count_read, count_fetch
FROM performance_schema.table_io_waits_summary_by_table
WHERE object_schema NOT IN ('mysql','performance_schema','information_schema','sys')
ORDER BY count_fetch DESC
LIMIT 20;
```

Contoh index yang sering belum ada di server ESX/QB-Core:

```sql
ALTER TABLE players        ADD INDEX idx_identifier (identifier);
ALTER TABLE owned_vehicles ADD INDEX idx_owner (owner);
ALTER TABLE player_outfits ADD INDEX idx_citizenid (citizenid);
ALTER TABLE apartments     ADD INDEX idx_owner (owner);
-- dan seterusnya, sesuaikan sama script yang dipakai
```

---

## Referensi Convar

| Convar                                 | Tipe      | Default | Keterangan                                                              |
| -------------------------------------- | --------- | ------- | ----------------------------------------------------------------------- |
| `re_mysql_connection_string`           | string    | `""`    | URI koneksi MySQL atau format `key=value`. **Wajib diisi.**             |
| `re_mysql_connection_limit`            | int       | `25`    | Maksimal koneksi simultan ke MySQL                                      |
| `re_mysql_max_idle_connections`        | int       | `= limit` | Maksimal koneksi yang dipertahankan idle di pool                      |
| `re_mysql_idle_timeout`                | int       | `60000` | Idle timeout (ms) — koneksi idle lebih lama dari ini ditutup            |
| `re_mysql_queue_limit`                 | int       | `0`     | Maksimal antrean koneksi (0 = tanpa batas)                              |
| `re_mysql_slow_query_warning`          | int       | `200`   | Ambang batas (ms) untuk warning slow query                              |
| `re_mysql_resultset_warning`           | int       | `1000`  | Ambang batas jumlah baris untuk warning result set besar                |
| `re_mysql_transaction_isolation_level` | int       | `2`     | 1=REPEATABLE READ, 2=READ COMMITTED, 3=READ UNCOMMITTED, 4=SERIALIZABLE |
| `re_mysql_debug`                       | bool/json | `false` | Log semua query: `true` (semua), atau `["resource"]` (spesifik)         |
| `re_mysql_ui`                          | bool      | `false` | Nyalakan UI monitor in-game `/mysql`                                    |
| `re_mysql_log_size`                    | int       | `100`   | Kapasitas log query per-resource di UI                                  |
| `re_mysql_logger_service`              | string    | `""`    | Path ke custom logger module                                            |
| `re_mysql_versioncheck`                | bool      | `true`  | Cek versi terbaru dari GitHub saat startup                              |

---

## Format Connection String

```cfg
# Format URI (paling direkomendasikan)
set re_mysql_connection_string "mysql://user:password@127.0.0.1/database"

# Format key-value
set re_mysql_connection_string "host=127.0.0.1;user=user;password=password;database=database"
```

### Opsi query string (format URI)

| Opsi                 | Contoh                            | Keterangan                                             |
| -------------------- | --------------------------------- | ------------------------------------------------------ |
| `charset`            | `charset=utf8mb4`                 | Selalu pakai utf8mb4                                   |
| `namedPlaceholders`  | `namedPlaceholders=false`         | Matikan kalau semua query pakai `?`                    |
| `connectTimeout`     | `connectTimeout=10000`            | Timeout koneksi dalam ms (default 60000)               |
| `ssl`                | `ssl={"rejectUnauthorized":true}` | Aktifkan TLS                                           |
| `multipleStatements` | `multipleStatements=false`        | Jangan dinyalakan di production (risiko SQL injection) |
