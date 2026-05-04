import type { CFXCallback } from '../types';
import { getConnection } from './connection';
import { getLiveBatchLimit } from './pool';
import { logQuery, logError } from '../logger';
import { parseResponse } from '../utils/parseResponse';
import { getExecuteMeta } from '../utils/parseExecute';
import validateResultSet from 'utils/validateResultSet';
import { performance } from 'perf_hooks';
import { mysql_slow_query_warning, mysql_ui } from 'config';

interface BatchEntry {
  values: any[];
  cb?: CFXCallback;
  isPromise?: boolean;
  invokingResource: string;
}

// Writes are grouped by SQL string. All entries that arrive in the same
// event-loop tick share one queueMicrotask flush — they are then dispatched
// as a parallel worker pool so each row gets its own pool connection while
// the concurrency cap (getLiveBatchLimit) keeps SELECT headroom intact.
const _pending = new Map<string, BatchEntry[]>();
let _flushScheduled = false;

export function enqueueWrite(
  invokingResource: string,
  query: string,
  values: any[],
  cb?: CFXCallback,
  isPromise?: boolean
): void {
  let bucket = _pending.get(query);
  if (!bucket) { bucket = []; _pending.set(query, bucket); }
  bucket.push({ values, cb, isPromise, invokingResource });

  if (!_flushScheduled) {
    _flushScheduled = true;
    queueMicrotask(flushAll);
  }
}

function flushAll(): void {
  _flushScheduled = false;
  for (const [query, entries] of _pending) {
    _pending.delete(query);
    runBatch(query, entries).catch(() => {});
  }
}

async function runBatch(query: string, entries: BatchEntry[]): Promise<void> {
  const { type } = getExecuteMeta(query);
  const concurrency = getLiveBatchLimit(entries.length);
  let idx = 0;

  const runWorker = async () => {
    while (idx < entries.length) {
      const i = idx++;
      const e = entries[i];
      const conn = await getConnection(undefined, 'write');
      try {
        const startTime = performance.now();
        const result = await conn.execute(query, e.values);
        const elapsed = performance.now() - startTime;
        validateResultSet(e.invokingResource, query, result);
        if (elapsed >= mysql_slow_query_warning || mysql_ui)
          logQuery(e.invokingResource, query, elapsed, e.values);
        conn.release();
        if (e.cb) {
          const parsed = parseResponse(type, result);
          try { e.cb!(parsed); } catch {}
        }
      } catch (err: any) {
        conn.release();
        logError(e.invokingResource, e.cb, e.isPromise, err, query, e.values, true);
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, runWorker));
}
