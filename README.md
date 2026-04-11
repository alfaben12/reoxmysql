# ReoxMySQL

A FiveM resource to communicate with a MySQL database using [node-mysql2](https://github.com/sidorares/node-mysql2).

This repository is a custom project based on [oxmysql](https://github.com/communityox/oxmysql), updated for this community's needs. It keeps the general purpose of oxmysql, but some compatibility layers and behavior are intentionally different in `reoxmysql`.

## Links

- [CHANGES.md](CHANGES.md)
  - Changelog and detailed differences from oxmysql.
- [RECOMENDED_CONF.en.md](RECOMENDED_CONF.en.md)
  - Recommended configuration in English.
- [RECOMENDED_CONF.id.md](RECOMENDED_CONF.id.md)
  - Recommended configuration in Indonesian.

## Features

- Promises / async query handling allowing for non-blocking and awaitable responses.
- Improved performance and stability for the custom `reoxmysql` implementation.
- Support for named and unnamed placeholders, improving performance and security.
- Support for URI connection strings and semicolon separated values.
- Improved parameter checking and error handling.

## Important Notes

- This resource name is `reoxmysql`, not `oxmysql`.
- All convars use the `re_mysql_*` prefix.
- Legacy compatibility for `mysql-async` and `ghmattimysql` is not included.
- If a feature or behavior is specific to this fork, check `CHANGES.md` first.

## Lua Language Server

- Install [Lua Language Server](https://marketplace.visualstudio.com/items?itemName=sumneko.lua) to ease development with annotations, type checking, diagnostics, and more.
- See [ox_types](https://github.com/communityox/ox_types) for Lua type definitions that may still be useful for development.
