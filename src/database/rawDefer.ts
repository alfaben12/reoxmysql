import { parseArguments } from '../utils/parseArguments';
import { setCallback } from '../utils/setCallback';
import { logError } from '../logger';
import type { CFXCallback, CFXParameters } from '../types';
import { enqueueWrite } from './tickBatcher';

// Entry point for MySQL.defer_update() and MySQL.defer_insert().
// Parses arguments identically to rawQuery, then hands off to the tick batcher
// instead of acquiring a connection immediately.  Writes with the same SQL that
// arrive in the same event-loop tick are coalesced into one parallel batch,
// reducing pool pressure without changing any existing call paths.
export const rawDefer = (
  invokingResource: string,
  query: string,
  parameters: CFXParameters,
  cb?: CFXCallback,
  isPromise?: boolean
): void => {
  cb = setCallback(parameters, cb);

  try {
    [query, parameters] = parseArguments(query, parameters);
  } catch (err: any) {
    logError(invokingResource, cb, isPromise, err, query, parameters);
    return;
  }

  enqueueWrite(invokingResource, query, parameters as any[], cb, isPromise);
};
