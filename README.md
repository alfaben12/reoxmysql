# ReoxMySQL

<p align="center">
  <img src="docs/REOX.png" alt="ReoxMySQL logo" width="160">
</p>

`reoxmysql` is a FiveM resource for MySQL access. It supports two database engines — **mysql2** and **mariadb** — selectable at runtime via a single convar.

This project is a custom fork based on [`oxmysql` v2.13.1](https://github.com/communityox/oxmysql). It keeps the same general purpose, but some compatibility layers and runtime behavior are intentionally different.

## Overview

This resource is designed so **multiple MySQL resources** can run at the same time:

- connected to the **same database**
- or connected to **different databases**
- without conflicting with other MySQL resources

### Dual Database Engine

ReoxMySQL ships with both [`mysql2`](https://github.com/sidorares/node-mysql2) and [`mariadb`](https://github.com/mariadb-corporation/mariadb-connector-nodejs) connectors. You choose which one to use in `server.cfg`:

```cfg
set re_mysql_connector "mysql2"    # default — mysql2@3.22.2
set re_mysql_connector "mariadb"   # alternative — mariadb@3.5.2
```

No script changes are needed when switching. See [`docs/PROCONS.md`](docs/PROCONS.md) for a detailed comparison to help you decide.

## Documentation

### Main docs

| File                                                 | Description                                       |
| ---------------------------------------------------- | ------------------------------------------------- |
| [`docs/CHANGES.md`](docs/CHANGES.md)                 | Changelog and detailed differences from `oxmysql` |
| [`docs/RECOMENDED_CONF.md`](docs/RECOMENDED_CONF.md) | Recommended configuration for all server sizes    |
| [`docs/PROCONS.md`](docs/PROCONS.md)                 | mysql2 vs mariadb connector comparison            |
| [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md)         | Build instructions for contributors               |

### Additional docs

- [`lib/README.md`](lib/README.md) — Library exports for TypeScript/JavaScript consumers

## Features

- **Dual database engine** — choose `mysql2` or `mariadb` at runtime via `re_mysql_connector`
- Promise-based and async query handling
- Improved performance and stability
- Support for named (`@param` / `:param`) and unnamed (`?`) placeholders
- Support for URI connection strings and semicolon-style connection strings
- Improved parameter validation and error handling
- `typeCast` applied consistently across both `query()` (text protocol) and `execute()` (binary protocol)
- Batch execute worker-pool with adaptive concurrency cap (prevents pool starvation)
- Tick-batched write API: `deferUpdate` / `deferInsert` for high-frequency saves
- Prepared statement LRU cache tunable via `re_mysql_max_prepared_statements`
- Graceful idle connection recycling via `re_mysql_graceful_end`
- Optional network compression via `re_mysql_compress`
- Built on **mysql2@3.22.2**, **mariadb@3.5.2**, and **named-placeholders@1.1.6** with custom patches

## Important Notes

- Resource name must be **`reoxmysql`**, not `oxmysql`
- All convars use the `re_mysql_` prefix
- There is no compatibility layer for `mysql-async`
- There is no compatibility layer for `ghmattimysql`
- For fork-specific behavior, see [`docs/CHANGES.md`](docs/CHANGES.md)

## Installation

1. Download the resource from the release package.
2. Place it inside your `resources` folder.
3. Add these lines to `server.cfg`:

```cfg
set re_mysql_connection_string "mysql://user:password@localhost/database"
ensure reoxmysql
```

4. (Optional) Choose your database engine:

```cfg
set re_mysql_connector "mysql2"
```

After that, the resource is ready to use.

## Quick Usage

```lua
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

## Available API

Use `exports.reoxmysql` for all calls:

| Export                             | Description                                               |
| ---------------------------------- | --------------------------------------------------------- |
| `query(sql, params, cb)`           | SELECT — return all rows                                  |
| `single(sql, params, cb)`          | SELECT — return the first row                             |
| `scalar(sql, params, cb)`          | SELECT — return first column of first row                 |
| `update(sql, params, cb)`          | UPDATE/DELETE — return `affectedRows`                     |
| `insert(sql, params, cb)`          | INSERT — return `insertId`                                |
| `transaction(queries, params, cb)` | Run multiple queries in a single transaction              |
| `startTransaction(fn)`             | Async function-based transaction (experimental)           |
| `prepare(sql, params, cb)`         | Batch execute with prepared statements, response unpacked |
| `rawExecute(sql, params, cb)`      | Batch execute without unpacking the response              |
| `deferUpdate(sql, params, cb)`     | UPDATE/DELETE — tick-batched, returns `affectedRows`      |
| `deferInsert(sql, params, cb)`     | INSERT — tick-batched, returns `insertId`                 |
| `isReady()`                        | Check whether the pool is ready (boolean)                 |
| `awaitConnection()`                | Promise that resolves when the pool is ready              |
| `*_async(...)`                     | Promise version of all exports above                      |

## Development Tools

- Install [Lua Language Server](https://marketplace.visualstudio.com/items?itemName=sumneko.lua) for annotations, diagnostics, and type checking.
- See [ox_types](https://github.com/communityox/ox_types) for Lua type definitions that may still be useful during development.

## License

LGPL-3.0-or-later
