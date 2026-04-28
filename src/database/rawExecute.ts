import { logError, logQuery } from '../logger';
import { CFXCallback, CFXParameters, QueryType } from '../types';
import { parseResponse } from '../utils/parseResponse';
import { getExecuteMeta, parseExecute } from '../utils/parseExecute';
import { getConnection } from './connection';
import { getLiveBatchLimit } from './pool';
import { setCallback } from '../utils/setCallback';
import { performance } from 'perf_hooks';
import validateResultSet from 'utils/validateResultSet';
import { RowDataPacket } from 'mysql2';
import { profileBatchStatements, runProfiler } from 'profiler';
import { mysql_debug, mysql_slow_query_warning, mysql_ui } from 'config';

function padValues(values: any, placeholders: number) {
  if (values && placeholders > values.length) {
    for (let i = values.length; i < placeholders; i++) {
      values[i] = null;
    }
  }
  return values;
}

function buildResponse(result: any, type: QueryType, unpack: boolean | undefined) {
  if (Array.isArray(result) && result.length > 1) {
    return result.map((value) => (unpack ? parseResponse(type, value as RowDataPacket[]) : value));
  }
  return [unpack ? parseResponse(type, result) : result];
}

function invokeCallback(
  cb: CFXCallback,
  response: any[],
  type: QueryType,
  unpack: boolean | undefined,
  invokingResource: string
) {
  try {
    if (response.length === 1) {
      if (unpack && type === null) {
        if (response[0][0] && Object.keys(response[0][0]).length === 1) {
          cb(Object.values(response[0][0])[0]);
        } else cb(response[0][0]);
      } else {
        cb(response[0]);
      }
    } else {
      cb(response);
    }
  } catch (err) {
    if (typeof err === 'string') {
      if (err.includes('SCRIPT ERROR:')) return console.log(err);
      console.log(`^1SCRIPT ERROR in invoking resource ${invokingResource}: ${err}^0`);
    }
  }
}

export const rawExecute = async (
  invokingResource: string,
  query: string,
  parameters: CFXParameters,
  cb?: CFXCallback,
  isPromise?: boolean,
  unpack?: boolean,
  connectionId?: number
) => {
  cb = setCallback(parameters, cb);

  let type: QueryType;
  let placeholders: number;

  try {
    ({ type, placeholders } = getExecuteMeta(query));
    parameters = parseExecute(placeholders, parameters);
  } catch (err: any) {
    return logError(invokingResource, cb, isPromise, err, query, parameters);
  }

  // null type = SELECT-style execute → read pool; insert/update/execute → write pool
  const poolType = type === null ? 'read' : 'write';

  // ── Parallel batch path ──────────────────────────────────────────────────
  // When debug/profiler is off and there is no pinned connection, execute each
  // parameter set concurrently using its own pool connection.  Concurrency is
  // capped by getLiveBatchLimit() — 60% of currently idle connections — so the
  // cap shrinks automatically under load and SELECT queries always have headroom.
  if (!mysql_debug && !connectionId && parameters.length > 1) {
    try {
      const concurrency = getLiveBatchLimit(parameters.length);
      const results: any[] = new Array(parameters.length);
      let batchIndex = 0;

      // Worker pool: each worker claims the next unclaimed parameter slot.
      // Single-threaded JS makes the batchIndex++ increment atomic.
      const runBatch = async () => {
        while (batchIndex < parameters.length) {
          const i = batchIndex++;
          const values = parameters[i];
          padValues(values, placeholders);

          const conn = await getConnection(undefined, poolType);
          try {
            const startTime = performance.now();
            const result = await conn.execute(query, values);
            const elapsed = performance.now() - startTime;
            if (elapsed >= mysql_slow_query_warning || mysql_ui) logQuery(invokingResource, query, elapsed, values);
            validateResultSet(invokingResource, query, result);
            results[i] = buildResponse(result, type, unpack);
          } finally {
            conn.release();
          }
        }
      };

      await Promise.all(Array.from({ length: concurrency }, runBatch));

      const response = results.flat();

      if (!cb) return response.length === 1 ? response[0] : response;

      invokeCallback(cb!, response, type, unpack, invokingResource);
    } catch (err: any) {
      logError(invokingResource, cb, isPromise, err, query, parameters);
    }
    return;
  }

  // ── Sequential path ──────────────────────────────────────────────────────
  // Used when: profiler is active (debug), a specific connection is pinned
  // (connectionId), or there is only a single parameter set.
  using connection = await getConnection(connectionId, poolType);

  if (!connection) return;

  try {
    const hasProfiler = mysql_debug && (await runProfiler(connection, invokingResource));
    const parametersLength = parameters.length == 0 ? 1 : parameters.length;
    const response = [] as any[];

    for (let index = 0; index < parametersLength; index++) {
      const values = parameters[index];

      padValues(values, placeholders);

      const startTime = !hasProfiler && performance.now();
      const result = await connection.execute(query, values);

      if (Array.isArray(result) && result.length > 1) {
        for (const value of result) {
          response.push(unpack ? parseResponse(type, value as RowDataPacket[]) : value);
        }
      } else response.push(unpack ? parseResponse(type, result) : result);

      if (hasProfiler && ((index > 0 && index % 100 === 0) || index === parametersLength - 1)) {
        await profileBatchStatements(connection, invokingResource, query, parameters, index < 100 ? 0 : index);
      } else if (startTime) {
        const elapsed = performance.now() - startTime;
        if (elapsed >= mysql_slow_query_warning || mysql_ui) logQuery(invokingResource, query, elapsed, values);
      }

      validateResultSet(invokingResource, query, result);
    }

    connection.release();

    if (!cb) return response.length === 1 ? response[0] : response;

    invokeCallback(cb!, response, type, unpack, invokingResource);
  } catch (err: any) {
    logError(invokingResource, cb, isPromise, err, query, parameters);
  }
};
