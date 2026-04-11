# ReoxMySQL

`reoxmysql` is a FiveM resource for MySQL access built on top of [`node-mysql2`](https://github.com/sidorares/node-mysql2).

This project is a custom fork based on [`oxmysql` v2.13.1](https://github.com/communityox/oxmysql). It keeps the same general purpose, but some compatibility layers and runtime behavior are intentionally different.

## Overview

This resource is designed so **multiple MySQL resources** can run at the same time:

- connected to the **same database**
- or connected to **different databases**
- without conflicting with other MySQL resources

## Documentation

### Main docs

- [`docs/CHANGES.en.md`](docs/CHANGES.en.md) - Changelog and detailed differences from `oxmysql` (English)
- [`docs/CHANGES.id.md`](docs/CHANGES.id.md) - Changelog and detailed differences from `oxmysql` (Indonesian)
- [`docs/RECOMENDED_CONF.en.md`](docs/RECOMENDED_CONF.en.md) - Recommended configuration (English)
- [`docs/RECOMENDED_CONF.id.md`](docs/RECOMENDED_CONF.id.md) - Recommended configuration (Indonesian)

### Additional docs

- [`lib/README.md`](lib/README.md) - Additional library notes

## Features

- Promise-based and async query handling
- Improved performance and stability
- Support for named and unnamed placeholders
- Support for URI connection strings and semicolon-style connection strings
- Improved parameter validation and error handling

## Important Notes

- Resource name must be **`reoxmysql`**, not `oxmysql`
- All convars use the `re_mysql_` prefix
- There is no compatibility layer for `mysql-async`
- There is no compatibility layer for `ghmattimysql`
- For fork-specific behavior, see [`docs/CHANGES.en.md`](docs/CHANGES.en.md) or [`docs/CHANGES.id.md`](docs/CHANGES.id.md)

## Installation

1. Download the resource from the release package.
2. Place it inside your `resources` folder.
3. Add this line to `server.cfg`:

```cfg
ensure reoxmysql
```

4. Add a minimal connection string, for example:

```cfg
set re_mysql_connection_string "mysql://user:password@localhost/database"
```

After that, the resource is ready to use.

## Development Tools

- Install [Lua Language Server](https://marketplace.visualstudio.com/items?itemName=sumneko.lua) for annotations, diagnostics, and type checking.
- See [ox_types](https://github.com/communityox/ox_types) for Lua type definitions that may still be useful during development.
