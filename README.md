# ReoxMySQL

A FiveM resource to communicate with a MySQL database using node-mysql2:
https://github.com/sidorares/node-mysql2

This repository is a custom project based on oxmysql v2.13.1:
https://github.com/communityox/oxmysql

It keeps the general purpose of oxmysql, but some compatibility layers and behavior are intentionally different in `reoxmysql`.

## Purpose

This resource is designed to allow **multiple MySQL resources** to run simultaneously:

- Connect to the **same database**
- Or connect to **different databases**
- Without conflicts with other MySQL resources

## Links

- docs/CHANGES.en.md  
  Changelog and detailed differences from oxmysql (English)

- docs/CHANGES.id.md  
  Changelog and detailed differences from oxmysql (Indonesian)

- docs/RECOMENDED_CONF.en.md  
  Recommended configuration (English)

- docs/RECOMENDED_CONF.id.md  
  Recommended configuration (Indonesian)

## Features

- Promises / async query handling (non-blocking & awaitable)
- Improved performance and stability
- Support for named and unnamed placeholders (better security & performance)
- Support for URI connection strings and semicolon format
- Improved parameter validation and error handling

## Important Notes

- Resource name is **`reoxmysql`**, not `oxmysql`
- All convars use the prefix:

  re*mysql*\*

- No compatibility for:

  - mysql-async
  - ghmattimysql

- For fork-specific behavior, check:
  - docs/CHANGES.en.md
  - docs/CHANGES.id.md

## Installation (Plug & Play)

1. Download from the **release** folder
2. Place it into your `resources` folder
3. Add this to your `server.cfg`:

   ensure reoxmysql

4. Add minimal configuration (example):

   set re_mysql_connection_string "mysql://user:password@localhost/database"

Done — the resource is ready to use.

## Lua Language Server

- Install [Lua Language Server](https://marketplace.visualstudio.com/items?itemName=sumneko.lua) to ease development with annotations, type checking, diagnostics, and more.
- See [ox_types](https://github.com/communityox/ox_types) for Lua type definitions that may still be useful for development.
