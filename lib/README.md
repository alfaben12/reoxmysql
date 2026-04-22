# ReoxMySQL Library Exports

TypeScript/JavaScript library for FiveM server-side scripts that use `reoxmysql`.

## Installation

```yaml
# With pnpm
pnpm add reoxmysql

# With Yarn
yarn add reoxmysql

# With npm
npm install reoxmysql
```

## Usage

Import as module:

```js
import { oxmysql } from 'reoxmysql';
```

Import with require:

```js
const { oxmysql } = require('reoxmysql');
```

## Example

```js
// Callback style
oxmysql
  .scalar('SELECT username FROM users', (result) => {
    console.log(result);
  })
  .catch(console.error);

// Promise style
oxmysql
  .scalar('SELECT username FROM users')
  .then((result) => {
    console.log(result);
  })
  .catch(console.error);

// Async/await
const result = await oxmysql.scalar('SELECT username FROM users').catch(console.error);
console.log(result);
```

## Documentation

See the main docs:

- [`docs/CHANGES.md`](../docs/CHANGES.md) — Full changelog and API reference
- [`docs/RECOMENDED_CONF.md`](../docs/RECOMENDED_CONF.md) — Configuration guide
- [`docs/PROCONS.md`](../docs/PROCONS.md) — mysql2 vs mariadb comparison

## License

LGPL-3.0-or-later
