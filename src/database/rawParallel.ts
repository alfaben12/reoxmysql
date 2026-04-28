import { rawQuery } from './rawQuery';
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

// Dispatch every entry simultaneously — each gets its own connection from
// the appropriate pool (reads → readPool, writes → writePool) — then collect
// all results with Promise.all.  Total wall-clock time equals the slowest
// individual query, not the sum of all queries.
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

  const promises = queries.map((entry) =>
    new Promise<any>((resolve, reject) => {
      rawQuery(
        resolveType(entry.type),
        invokingResource,
        entry.query,
        entry.params ?? [],
        // isPromise=true ensures errors arrive as cb(null, errMsg) so we can reject.
        (result: any, err?: string) => {
          if (err) return reject(new Error(err));
          resolve(result);
        },
        true,
      );
    })
  );

  try {
    const results = await Promise.all(promises);

    if (cb) try { cb(results); } catch {}
    return results;
  } catch (err: any) {
    console.error(`^1[reoxmysql] MySQL.parallel failed in ${invokingResource}: ${err.message}^0`);
    if (cb) {
      try {
        if (isPromise) cb(null, err.message);
        else cb(null);
      } catch {}
    }
  }
};
