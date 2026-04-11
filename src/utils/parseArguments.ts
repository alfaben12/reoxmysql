import type { CFXParameters } from '../types';
import { convertNamedPlaceholders } from '../config';

// Cache per query-string to avoid re-running the regex + two .includes() scans
// on every call.  Both counts are pure functions of the query text, so once
// seen they never need re-computing.  Clear-on-full keeps memory bounded.
interface QueryMeta {
  placeholders: number;
  hasNamed: boolean;
}
const _queryMetaCache = new Map<string, QueryMeta>();
const QUERY_META_CACHE_MAX = 500;

function getQueryMeta(query: string): QueryMeta {
  let meta = _queryMetaCache.get(query);
  if (meta !== undefined) return meta;

  meta = {
    placeholders: query.match(/\?(?!\?)/g)?.length ?? 0,
    hasNamed: query.indexOf(':') !== -1 || query.indexOf('@') !== -1,
  };
  if (_queryMetaCache.size >= QUERY_META_CACHE_MAX) _queryMetaCache.clear();
  _queryMetaCache.set(query, meta);
  return meta;
}

export const parseArguments = (query: string, parameters?: CFXParameters): [string, CFXParameters] => {
  if (typeof query !== 'string') throw new Error(`Expected query to be a string but received ${typeof query} instead.`);

  const meta = getQueryMeta(query);
  let placeholders = meta.placeholders;

  if (
    convertNamedPlaceholders &&
    meta.hasNamed &&
    parameters &&
    typeof parameters === 'object' &&
    !Array.isArray(parameters)
  ) {
    [query, parameters] = convertNamedPlaceholders(query, parameters);
    // Recount after rewriting — the rewritten query no longer matches the
    // cache key.  Named-placeholder queries are the slow path; the common
    // `?` path hits the cached count directly above.
    placeholders = query.match(/\?(?!\?)/g)?.length ?? 0;
  }

  if (!parameters || typeof parameters === 'function') parameters = [];

  if (parameters && !Array.isArray(parameters)) {
    let arr: unknown[] = [];

    for (let i = 0; i < placeholders; i++) {
      arr[i] = parameters[i + 1] ?? null;
    }

    parameters = arr;
  } else {
    if (placeholders) {
      if (parameters.length === 0) {
        for (let i = 0; i < placeholders; i++) parameters[i] = null;
        return [query, parameters];
      }

      const diff = placeholders - parameters.length;

      if (diff > 0) {
        for (let i = 0; i < diff; i++) parameters[placeholders + i] = null;
      } else if (diff < 0) {
        throw new Error(`Expected ${placeholders} parameters, but received ${parameters.length}.`);
      }
    }
  }

  return [query, parameters];
};
