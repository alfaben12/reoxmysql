import type { CFXCallback, CFXParameters, TransactionQuery } from './types';
import { rawQuery, rawExecute, rawTransaction, readPool, poolReady } from './database';
import { startTransaction } from 'database/startTransaction';
import { rawDefer } from 'database/rawDefer';
import { rawParallel, type ParallelEntry } from 'database/rawParallel';
import('./update');

const MySQL = {} as Record<string, Function>;

MySQL.isReady = () => {
  return readPool ? true : false;
};

MySQL.awaitConnection = async () => {
  if (!readPool) await poolReady;

  return true;
};

MySQL.query = (
  query: string,
  parameters: CFXParameters,
  cb: CFXCallback,
  invokingResource = GetInvokingResource(),
  isPromise?: boolean
) => {
  rawQuery(null, invokingResource, query, parameters, cb, isPromise);
};

MySQL.single = (
  query: string,
  parameters: CFXParameters,
  cb: CFXCallback,
  invokingResource = GetInvokingResource(),
  isPromise?: boolean
) => {
  rawQuery('single', invokingResource, query, parameters, cb, isPromise);
};

MySQL.scalar = (
  query: string,
  parameters: CFXParameters,
  cb: CFXCallback,
  invokingResource = GetInvokingResource(),
  isPromise?: boolean
) => {
  rawQuery('scalar', invokingResource, query, parameters, cb, isPromise);
};

MySQL.update = (
  query: string,
  parameters: CFXParameters,
  cb: CFXCallback,
  invokingResource = GetInvokingResource(),
  isPromise?: boolean
) => {
  rawQuery('update', invokingResource, query, parameters, cb, isPromise);
};

MySQL.insert = (
  query: string,
  parameters: CFXParameters,
  cb: CFXCallback,
  invokingResource = GetInvokingResource(),
  isPromise?: boolean
) => {
  rawQuery('insert', invokingResource, query, parameters, cb, isPromise);
};

MySQL.transaction = (
  queries: TransactionQuery,
  parameters: CFXParameters,
  cb: CFXCallback,
  invokingResource = GetInvokingResource(),
  isPromise?: boolean
) => {
  rawTransaction(invokingResource, queries, parameters, cb, isPromise);
};

MySQL.startTransaction = (
  transactions: () => Promise<boolean>,
  invokingResource = GetInvokingResource()
) => {
  console.warn(`MySQL.startTransaction is "experimental" and may receive breaking changes.`)
  return startTransaction(invokingResource, transactions, undefined, true);
};

MySQL.prepare = (
  query: string,
  parameters: CFXParameters,
  cb: CFXCallback,
  invokingResource = GetInvokingResource(),
  isPromise?: boolean
) => {
  rawExecute(invokingResource, query, parameters, cb, isPromise, true);
};

MySQL.rawExecute = (
  query: string,
  parameters: CFXParameters,
  cb: CFXCallback,
  invokingResource = GetInvokingResource(),
  isPromise?: boolean
) => {
  rawExecute(invokingResource, query, parameters, cb, isPromise);
};

// Tick-batched write variants — identical API to MySQL.update / MySQL.insert but
// coalesce writes to the same SQL within one event-loop tick into a single parallel
// batch.  Use for fire-and-forget saves (player position, health, stats) where
// immediate execution order relative to other queries is not required.
MySQL.deferUpdate = (
  query: string,
  parameters: CFXParameters,
  cb: CFXCallback,
  invokingResource = GetInvokingResource(),
  isPromise?: boolean
) => {
  rawDefer(invokingResource, query, parameters, cb, isPromise);
};

MySQL.deferInsert = (
  query: string,
  parameters: CFXParameters,
  cb: CFXCallback,
  invokingResource = GetInvokingResource(),
  isPromise?: boolean
) => {
  rawDefer(invokingResource, query, parameters, cb, isPromise);
};

for (const key in MySQL) {
  const exp = MySQL[key];

  const async_exp = (query: string, parameters: CFXParameters, invokingResource = GetInvokingResource()) => {
    return new Promise((resolve, reject) => {
      MySQL[key](
        query,
        parameters,
        (result: unknown, err: string) => {
          if (err) return reject(new Error(err));
          resolve(result);
        },
        invokingResource,
        true
      );
    });
  };

  global.exports(key, exp);
  global.exports(`${key}_async`, async_exp);
}

// MySQL.parallel is registered outside the loop because its signature differs
// from the standard (query, params, cb, resource, isPromise) pattern.
// It accepts an array of query descriptors and runs all of them simultaneously
// via Promise.all — total time equals the slowest query, not the sum of all.
global.exports('parallel', (
  queries: ParallelEntry[],
  cb: CFXCallback,
  invokingResource = GetInvokingResource(),
  isPromise?: boolean
) => {
  rawParallel(invokingResource, queries, cb, isPromise);
});

global.exports('parallel_async', (
  queries: ParallelEntry[],
  invokingResource = GetInvokingResource()
) => {
  return new Promise((resolve, reject) => {
    rawParallel(invokingResource, queries, (results: any, err?: string) => {
      if (err) return reject(new Error(err));
      resolve(results);
    }, true);
  });
});
