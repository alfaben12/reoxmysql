import { parseArguments } from '../utils/parseArguments';
import { setCallback } from '../utils/setCallback';
import { parseResponse } from '../utils/parseResponse';
import { logQuery, logError } from '../logger';
import type { CFXCallback, CFXParameters } from '../types';
import type { QueryType } from '../types';
import { getConnection } from './connection';
import { RowDataPacket } from 'mysql2';
import { performance } from 'perf_hooks';
import validateResultSet from 'utils/validateResultSet';
import { runProfiler } from 'profiler';
import { mysql_debug, mysql_slow_query_warning, mysql_ui } from 'config';

export const rawQuery = async (
  type: QueryType,
  invokingResource: string,
  query: string,
  parameters: CFXParameters,
  cb?: CFXCallback,
  isPromise?: boolean,
  connectionId?: number
) => {
  cb = setCallback(parameters, cb);
  try {
    [query, parameters] = parseArguments(query, parameters);
  } catch (err: any) {
    return logError(invokingResource, cb, isPromise, err, query, parameters);
  }

  // Route to the correct pool: writes (INSERT/UPDATE) go to writePool so they
  // never block reads. Everything else (SELECT, scalar, single) goes to readPool.
  const poolType = (type === 'insert' || type === 'update') ? 'write' : 'read';
  using connection = await getConnection(connectionId, poolType);

  if (!connection) return;

  try {
    const hasProfiler = mysql_debug && (await runProfiler(connection, invokingResource));
    // Only measure time when something will actually consume it: profiler,
    // slow-query warning, or the in-game UI.  Skipping performance.now() on
    // the fast path removes a per-query call pair at high QPS.
    const needTiming = hasProfiler || mysql_ui || mysql_slow_query_warning > 0;
    const startTime = needTiming && !hasProfiler ? performance.now() : 0;
    const result = await connection.query(query, parameters);

    if (hasProfiler) {
      const profiler = <RowDataPacket[]>(
        await connection.query('SELECT FORMAT(SUM(DURATION) * 1000, 4) AS `duration` FROM INFORMATION_SCHEMA.PROFILING')
      );

      if (profiler[0]) logQuery(invokingResource, query, parseFloat(profiler[0].duration), parameters);
    } else if (startTime) {
      const elapsed = performance.now() - startTime;
      // Inline gate: skip the logQuery call entirely on the fast path so we
      // don't pay function-call + argument-marshal overhead on every SELECT.
      if (elapsed >= mysql_slow_query_warning || mysql_ui) logQuery(invokingResource, query, elapsed, parameters);
    }

    validateResultSet(invokingResource, query, result);

    const parsed = parseResponse(type, result);

    // Release back to pool before crossing into Lua. cb() is synchronous across
    // the JS→Lua bridge — the connection would otherwise sit idle for the entire
    // duration of Lua execution. release() is idempotent; using-dispose is a no-op.
    connection.release();

    if (!cb) return parsed;

    try {
      cb!(parsed);
    } catch (err) {
      if (typeof err === 'string') {
        if (err.includes('SCRIPT ERROR:')) return console.log(err);
        console.log(`^1SCRIPT ERROR in invoking resource ${invokingResource}: ${err}^0`);
      }
    }
  } catch (err: any) {
    logError(invokingResource, cb, isPromise, err, query, parameters, true);
  }
};
