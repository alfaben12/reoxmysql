# ReoxMySQL — Changelog & Perbedaan dari OxMySQL

> Fork dari [oxmysql](https://github.com/CommunityOx/oxmysql) v2.13.1  
> Fokus: performa tinggi, isolasi nama konvar, tanpa lapisan kompatibilitas warisan.

---

## Ringkasan Perbedaan dari OxMySQL

| Aspek                         | OxMySQL                        | ReoxMySQL                         |
| ----------------------------- | ------------------------------ | --------------------------------- |
| Nama resource                 | `oxmysql`                      | `reoxmysql`                       |
| Prefix konvar                 | `mysql_*`                      | `re_mysql_*`                      |
| Kompatibilitas `mysql-async`  | Ya (`provide`)                 | **Tidak**                         |
| Kompatibilitas `ghmattimysql` | Ya (`provide`)                 | **Tidak**                         |
| Batch execute                 | Unbounded `Promise.all`        | Worker-pool dengan cap 60% pool   |
| Busy-wait pool                | `while (!pool) await sleep(0)` | `await poolReady` (Promise)       |
| `typeCast` pada `query()`     | Tidak                          | Ya                                |
| Cache regex placeholder       | Tidak                          | Ya (Map, max 200 entry)           |
| Scalar value extraction       | `Object.values(row)[0]`        | `for...in` (zero alloc)           |
| Log trim strategy             | `splice(0,1)` per insert O(n)  | `slice()` per N inserts amortized |
| Koneksi keep-alive            | Tidak dikonfigurasi            | `enableKeepAlive: true, 10s`      |
| Dokumentasi konfigurasi       | Tidak ada                      | `RECOMENDED_CONF.md`              |

---

## Breaking Changes

### 1. Konvar Wajib Diganti

Semua konvar menggunakan prefix `re_` sekarang. Script yang masih set konvar lama tidak akan dibaca.

| Konvar Lama                         | Konvar Baru                            |
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

**Cara migrasi di `server.cfg`:**

```diff
- set mysql_connection_string "mysql://user:pass@localhost/db"
+ set re_mysql_connection_string "mysql://user:pass@localhost/db"
```

### 2. Kompatibilitas mysql-async dan ghmattimysql Dihapus

`provide 'mysql-async'` dan `provide 'ghmattimysql'` dihapus dari manifest. Script yang memanggil `exports['mysql-async'].*` atau `exports['ghmattimysql'].*` akan error.

**Migrasi:**

```lua
-- Sebelum (mysql-async)
MySQL.Async.fetchAll('SELECT * FROM players WHERE identifier = ?', {identifier}, function(result) end)

-- Setelah (reoxmysql)
exports.reoxmysql:query('SELECT * FROM players WHERE identifier = ?', {identifier}, function(result) end)

-- atau async:
local result = exports.reoxmysql:query_async('SELECT * FROM players WHERE identifier = ?', {identifier})
```

### 3. Export yang Dihapus

| Export          | Alasan                                  |
| --------------- | --------------------------------------- |
| `MySQL.store`   | Shim kompatibilitas ghmatti/mysql-async |
| `MySQL.execute` | Alias usang dari `MySQL.query`          |
| `MySQL.fetch`   | Alias usang dari `MySQL.query`          |
| `${key}Sync`    | Alias usang — gunakan `${key}_async`    |

---

## Perubahan Performa

### Batch Execute: Worker-Pool dengan Concurrency Cap

**File:** `src/database/rawExecute.ts`

**Masalah di OxMySQL:**
Ketika `rawExecute` dipanggil dengan banyak parameter (batch insert/update), seluruh batch dieksekusi sekaligus via `Promise.all` tanpa batasan. Dengan 50 parameter dan pool 25 koneksi, seluruh pool bisa terpakai oleh satu batch — tidak ada koneksi tersisa untuk `SELECT` query dari resource lain sehingga query SELECT mengantri dan latency melonjak.

```
OxMySQL:   batch(50 param) + pool(25) = 25 koneksi dikuasai batch, 0 untuk SELECT
ReoxMySQL: batch(50 param) + pool(25) = cap(15) untuk batch, ≥10 untuk SELECT
```

**Solusi di ReoxMySQL:**
Worker-pool pattern dengan cap maksimum 60% dari ukuran pool:

```typescript
// Cap lazily dihitung: maks 60% pool untuk satu batch call
function getBatchLimit(): number {
  if (!_batchConcurrencyLimit) {
    _batchConcurrencyLimit = Math.max(4, Math.floor(GetConvarInt('re_mysql_connection_limit', 25) * 0.6));
  }
  return _batchConcurrencyLimit;
}

// Worker pool — setiap worker ambil slot berikutnya secara atomik (JS single-threaded)
const runBatch = async () => {
  while (batchIndex < parameters.length) {
    const i = batchIndex++;
    const conn = await getConnection();
    try {
      results[i] = await conn.execute(query, parameters[i]);
    } finally {
      conn.release(); // lepas koneksi segera, bukan di akhir batch
    }
  }
};
await Promise.all(Array.from({ length: concurrency }, runBatch));
```

Selain itu, `invokeCallback()` dan `buildResponse()` diekstrak sebagai fungsi tersendiri dan dipakai bersama antara parallel path dan sequential path.

---

### Pool Ready: Promise Menggantikan Busy-Wait

**File:** `src/database/pool.ts`, `src/database/connection.ts`, `src/index.ts`

**Masalah di OxMySQL:**

```typescript
while (!pool) await sleep(0); // busy-wait — ratusan microtask tick saat startup
```

**Solusi di ReoxMySQL:**

```typescript
// pool.ts — resolve sekali saat pool siap
export const poolReady = new Promise<void>((resolve) => {
  _poolReadyResolve = resolve;
});
// setelah pool berhasil dibuat:
_poolReadyResolve?.();

// connection.ts / index.ts — tunggu tanpa polling
if (!pool) await poolReady;
```

Zero CPU wasted saat menunggu koneksi database pertama.

---

### Keep-Alive Koneksi

**File:** `src/database/pool.ts`

Pool kini dibuat dengan `enableKeepAlive: true` dan delay 10 detik. Mencegah koneksi di-drop MySQL setelah periode idle (`wait_timeout`), menghilangkan overhead reconnect saat server sedang sepi lalu tiba-tiba ramai.

```typescript
const dbPool = createPool({
  ...config,
  connectionLimit,
  waitForConnections: true,
  queueLimit,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
});
```

---

### typeCast pada Text Protocol (`query()`)

**File:** `src/database/connection.ts`

**Masalah di OxMySQL:**
`typeCast` hanya aktif pada `execute()` (binary protocol). `query()` yang dipakai oleh `MySQL.query / single / scalar / update / insert` mengembalikan tipe raw — DATETIME sebagai string, TINYINT(1) sebagai `0`/`1` bukan boolean, BLOB sebagai buffer mentah.

**Solusi di ReoxMySQL:**
`typeCast` diterapkan pada kedua path:

```diff
- const [result] = await this.connection.query(query, values);
+ const [result] = await this.connection.query({ sql: query, values, typeCast });
```

Hasil: DATETIME → Unix timestamp, TINYINT(1) → boolean, BIT → boolean, konsisten untuk semua jenis query.

---

### MySql.release() — Explicit Connection Release

**File:** `src/database/connection.ts`

Method `release()` eksplisit ditambahkan tanpa semantik transaksi. Digunakan oleh parallel batch path untuk melepas koneksi segera setelah setiap parameter set selesai, bukan menunggu `[Symbol.dispose]` yang baru berjalan di akhir `using` scope.

---

### Cache Regex Placeholder

**File:** `src/utils/parseArguments.ts`

**Masalah di OxMySQL:**
Setiap pemanggilan `parseArguments` menjalankan regex `/\?(?!\?)/g` dari awal. Di server dengan ribuan query per detik yang memanggil query string yang sama berulang (seperti `SELECT * FROM players WHERE identifier = ?`), ini membuang CPU untuk hasil yang selalu sama.

**Solusi di ReoxMySQL:**

```typescript
const _placeholderCache = new Map<string, number>(); // query → jumlah placeholder
const PLACEHOLDER_CACHE_MAX = 200;

let placeholders = _placeholderCache.get(query);
if (placeholders === undefined) {
  placeholders = query.match(/\?(?!\?)/g)?.length ?? 0;
  if (_placeholderCache.size >= PLACEHOLDER_CACHE_MAX) _placeholderCache.clear();
  _placeholderCache.set(query, placeholders);
}
```

Query yang sering diulang hanya di-regex sekali seumur hidup proses.

---

### Scalar Value — Zero Allocation

**File:** `src/utils/parseResponse.ts`

**Masalah di OxMySQL:**

```typescript
return (row && Object.values(row)[0]) ?? null;
// Object.values() mengalokasikan array hanya untuk dibuang segera
```

**Solusi di ReoxMySQL:**

```typescript
if (!row) return null;
for (const key in row) return row[key]; // keluar di iterasi pertama, tidak ada array
return null;
```

Tidak ada alokasi memory per scalar query.

---

### Log Trim Amortized

**File:** `src/logger/index.ts`

**Masalah di OxMySQL:**

```typescript
// O(n) setiap kali satu entry ditambahkan saat array sudah penuh
else if (logStorage[resource].length > mysql_log_size) logStorage[resource].splice(0, 1);
```

`splice(0, 1)` menggeser seluruh array ke kiri — O(n) per insert saat log penuh.

**Solusi di ReoxMySQL:**

```typescript
const LOG_TRIM_FACTOR = 2;
// Biarkan array tumbuh ke 2× kapasitas, lalu potong sekali ke 1× kapasitas
else if (logStorage[resource].length >= mysql_log_size * LOG_TRIM_FACTOR) {
  logStorage[resource] = logStorage[resource].slice(mysql_log_size);
}
```

Cost O(n) dibayar sekali setiap `mysql_log_size` insert — bukan setiap insert.

## API yang Tersedia

Gunakan `exports.reoxmysql` untuk semua panggilan:

| Export                             | Deskripsi                                                |
| ---------------------------------- | -------------------------------------------------------- |
| `query(sql, params, cb)`           | SELECT — kembalikan semua baris                          |
| `single(sql, params, cb)`          | SELECT — kembalikan baris pertama                        |
| `scalar(sql, params, cb)`          | SELECT — kembalikan nilai kolom pertama baris pertama    |
| `update(sql, params, cb)`          | UPDATE/DELETE — kembalikan `affectedRows`                |
| `insert(sql, params, cb)`          | INSERT — kembalikan `insertId`                           |
| `transaction(queries, params, cb)` | Jalankan beberapa query dalam satu transaksi             |
| `startTransaction(fn)`             | Transaksi berbasis fungsi async (eksperimental)          |
| `prepare(sql, params, cb)`         | Batch execute dengan prepared statement, hasil di-unpack |
| `rawExecute(sql, params, cb)`      | Batch execute tanpa unpack hasil                         |
| `isReady()`                        | Cek apakah pool sudah siap (boolean)                     |
| `awaitConnection()`                | Promise yang resolve saat pool siap                      |
| `*_async(...)`                     | Versi Promise dari semua export di atas                  |

---

## Cara Pakai di Script

```lua
-- server.cfg
set re_mysql_connection_string "mysql://user:pass@127.0.0.1/database"
ensure reoxmysql

-- Lua (callback style)
exports.reoxmysql:query('SELECT * FROM players WHERE identifier = ?', {identifier}, function(result)
    print(#result .. ' players found')
end)

-- Lua (async — butuh Lua coroutine / ox_lib promise)
local result = exports.reoxmysql:query_async('SELECT * FROM players WHERE identifier = ?', {identifier})
```

```js
// JavaScript / TypeScript (FiveM server-side)
const result = await exports.reoxmysql.query_async('SELECT * FROM players WHERE identifier = ?', [identifier]);
```
