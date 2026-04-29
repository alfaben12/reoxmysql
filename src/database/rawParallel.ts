import { rawQuery } from './rawQuery';
import { readLimit, writeLimit } from './pool';
import type { CFXCallback, CFXParameters } from '../types';
import type { QueryType } from '../types';

export interface ParallelEntry {
  // Query type — controls result shaping and pool routing (read vs write).
  // Accepts the same values as the individual MySQL.* methods:
  //   'query'  → full row array (default)
  //   'single' → first row or null
  //   'scalar' → first column of first row
  //   'insert' → insertId
  //   'update' → affectedRows
  type?: 'query' | 'single' | 'scalar' | 'insert' | 'update';
  query: string;
  params?: CFXParameters;
}

function resolveType(t?: string): QueryType {
  switch (t) {
    case 'single': return 'single';
    case 'scalar': return 'scalar';
    case 'insert': return 'insert';
    case 'update': return 'update';
    default:       return null; // 'query' or omitted → full result set
  }
}

// Dispatch entries via two bounded worker pools — one per pool type — so reads
// and writes never compete for each other's connections.
//
// rawQuery routes: (insert|update) → writePool, everything else → readPool.
// We mirror that routing here: partition entries into read/write buckets, then
// run a separate worker pool for each bucket capped at its pool's connection
// limit.  Both pools run concurrently via Promise.all so total wall-clock time
// equals the slowest individual query, not their sum.
//
// allSettled semantics: a failed entry logs an error and resolves null so the
// remaining workers are not cancelled.
export const rawParallel = async (
  invokingResource: string,
  queries: ParallelEntry[],
  cb?: CFXCallback,
  isPromise?: boolean
): Promise<any[] | void> => {
  if (!Array.isArray(queries) || queries.length === 0) {
    if (cb) try { cb([]); } catch {}
    return [];
  }

  const results: any[] = new Array(queries.length);

  // Partition entries into read/write buckets, preserving original indices so
  // results are assembled back in the caller-supplied order.
  const readBucket:  Array<{ i: number; entry: ParallelEntry }> = [];
  const writeBucket: Array<{ i: number; entry: ParallelEntry }> = [];

  for (let i = 0; i < queries.length; i++) {
    const t = resolveType(queries[i].type);
    if (t === 'insert' || t === 'update') writeBucket.push({ i, entry: queries[i] });
    else                                  readBucket.push({ i, entry: queries[i] });
  }

  async function makeWorkerPool(
    bucket: Array<{ i: number; entry: ParallelEntry }>,
    cap: number
  ): Promise<void> {
    if (bucket.length === 0) return Promise.resolve();
    let idx = 0;
    const worker = async () => {
      while (idx < bucket.length) {
        const { i, entry } = bucket[idx++];
        results[i] = await new Promise<any>((resolve) => {
          rawQuery(
            resolveType(entry.type),
            invokingResource,
            entry.query,
            entry.params ?? [],
            (result: any, err?: string) => {
              if (err) {
                console.error(`^1[reoxmysql] parallel[${i}] failed in ${invokingResource}: ${err}^0`);
                resolve(null); // allSettled: keep other workers running
              } else {
                resolve(result);
              }
            },
            true,
          );
        });
      }
    };
    await Promise.all(Array.from({ length: Math.min(cap, bucket.length) }, worker));
  }

  try {
    await Promise.all([
      makeWorkerPool(readBucket,  readLimit),
      makeWorkerPool(writeBucket, writeLimit),
    ]);
    if (cb) try { cb(results); } catch {}
    return results;
  } catch (err: any) {
    // Worker itself threw (programming error, not a query error).
    console.error(`^1[reoxmysql] MySQL.parallel internal error in ${invokingResource}: ${err.message}^0`);
    if (cb) {
      try {
        if (isPromise) cb(null, err.message);
        else cb(null);
      } catch {}
    }
  }
};
