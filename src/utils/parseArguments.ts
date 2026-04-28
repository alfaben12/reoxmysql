import type { CFXParameters } from '../types';
import { convertNamedPlaceholders } from '../config';

// Cache per query-string to avoid re-running the regex + two .includes() scans
// on every call.  Both counts are pure functions of the query text, so once
// seen they never need re-computing.
//
// LRU eviction (Map insertion-order): on get, delete+re-insert to move to tail;
// on set when full, delete the head (least recently used) entry.
// This keeps hot queries in cache permanently — unlike the old clear-on-full
// strategy that flushed all 500 entries at once on the 501st unique query.
interface QueryMeta {
  placeholders: number;
  hasNamed: boolean;
}

const QUERY_META_CACHE_MAX = 500;
// Static RegExp — reuse a single object instead of allocating a new one per
// cache miss.  The 'g' flag makes lastIndex stateful, so reset before each use.
const PLACEHOLDER_RE = /\?(?!\?)/g;

const _queryMetaCache = new Map<string, QueryMeta>();

function getQueryMeta(query: string): QueryMeta {
  const cached = _queryMetaCache.get(query);
  if (cached !== undefined) {
    // LRU: move to tail so it is the last to be evicted
    _queryMetaCache.delete(query);
    _queryMetaCache.set(query, cached);
    return cached;
  }

  PLACEHOLDER_RE.lastIndex = 0;
  const meta: QueryMeta = {
    placeholders: query.match(PLACEHOLDER_RE)?.length ?? 0,
    hasNamed: query.indexOf(':') !== -1 || query.indexOf('@') !== -1,
  };

  // LRU eviction: delete the oldest entry (Map head) when at capacity
  if (_queryMetaCache.size >= QUERY_META_CACHE_MAX) {
    _queryMetaCache.delete(_queryMetaCache.keys().next().value!);
  }
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
    PLACEHOLDER_RE.lastIndex = 0;
    placeholders = query.match(PLACEHOLDER_RE)?.length ?? 0;
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
