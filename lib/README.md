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

// Parallel queries (multiple heterogeneous queries run simultaneously)
const results = await oxmysql.parallel_async([
  { type: 'query',  query: 'SELECT * FROM users WHERE id = ?', params: [userId] },
  { type: 'single', query: 'SELECT * FROM bans WHERE identifier = ?', params: [identifier] },
  { type: 'insert', query: 'INSERT INTO log_auth (identifier, time) VALUES (?, ?)', params: [identifier, Date.now()] },
]);
console.log(results[0], results[1], results[2]);
```

## Documentation

See the main docs:

- [`docs/CHANGES.md`](../docs/CHANGES.md) — Full changelog and API reference
- [`docs/RECOMENDED_CONF.md`](../docs/RECOMENDED_CONF.md) — Configuration guide
- [`docs/PROCONS.md`](../docs/PROCONS.md) — mysql2 vs mariadb comparison

## License

LGPL-3.0-or-later
