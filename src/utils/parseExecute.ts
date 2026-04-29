import { CFXParameters } from '../types';
import type { QueryType } from '../types';

interface ExecuteMeta { type: QueryType; placeholders: number; }
const _executeMetaCache = new Map<string, ExecuteMeta>();
const EXECUTE_META_CACHE_MAX = 500;

// Combined cache for query type + placeholder count, keyed by query string.
// Replaces the per-call substring allocation from executeType() and the
// query.split('?') array allocation from the placeholder count.
// Both values are pure functions of the query text and never need re-computing
// for the same string.
export function getExecuteMeta(query: string): ExecuteMeta {
  if (typeof query !== 'string') throw new Error(`Expected query to be a string but received ${typeof query} instead.`);

  let meta = _executeMetaCache.get(query);
  if (meta !== undefined) {
    _executeMetaCache.delete(query);
    _executeMetaCache.set(query, meta);
    return meta;
  }

  const spaceIdx = query.indexOf(' ');
  let type: QueryType;
  switch (spaceIdx === -1 ? query : query.substring(0, spaceIdx)) {
    case 'INSERT': type = 'insert'; break;
    case 'UPDATE':
    case 'DELETE': type = 'update'; break;
    default: type = null;
  }

  // Count '?' characters — equivalent to query.split('?').length - 1 without
  // the intermediate array allocation.
  let placeholders = 0;
  for (let i = 0; i < query.length; i++) {
    if (query[i] === '?') placeholders++;
  }

  meta = { type, placeholders };
  if (_executeMetaCache.size >= EXECUTE_META_CACHE_MAX) {
    _executeMetaCache.delete(_executeMetaCache.keys().next().value!);
  }
  _executeMetaCache.set(query, meta);
  return meta;
}

export const parseExecute = (placeholders: number, parameters: CFXParameters) => {
  if (!parameters || typeof parameters !== 'object') return [];

  // Object (record) at the top level → convert to flat positional array.
  if (!Array.isArray(parameters)) {
    const record = parameters as Record<string, unknown>;
    const arr: unknown[] = [];
    for (const key in record) {
      arr[parseInt(key) - 1] = record[key];
    }
    parameters = arr;
  }

  // Fast path: caller already gave us batched arrays.  Single pass classifies
  // the shape — allArrays vs allObjects — without two `.every()` iterations.
  const len = parameters.length;
  let allArrays = true;
  let allObjects = true;

  for (let i = 0; i < len; i++) {
    const item = parameters[i];
    if (!Array.isArray(item)) allArrays = false;
    if (typeof item !== 'object' || item === null) {
      allObjects = false;
      break; // mixed-primitive payload — falls through to the single-row path
    }
  }

  if (allArrays) return parameters; // already well-formed batch

  if (allObjects) {
    // Batch of records → batch of positional arrays, one allocation pass.
    const arr: unknown[][] = new Array(len);
    for (let index = 0; index < len; index++) {
      const value = parameters[index];
      const row = new Array(placeholders);
      if (Array.isArray(value)) {
        for (let i = 0; i < placeholders; i++) row[i] = value[i] !== undefined ? value[i] : null;
      } else {
        for (const key in value) {
          row[parseInt(key) - 1] = value[key];
        }
        for (let i = 0; i < placeholders; i++) {
          if (row[i] === undefined) row[i] = null;
        }
      }
      arr[index] = row;
    }
    return arr;
  }

  // Flat parameter list — wrap as single-row batch.
  return [[...parameters]];
};

export const parseValues = (placeholders: number, parameters: CFXParameters) => {
  if (!Array.isArray(parameters)) {
    if (typeof parameters === 'object') {
      const arr: unknown[] = [];
      Object.entries(parameters).forEach((entry) => (arr[parseInt(entry[0]) - 1] = entry[1]));
      parameters = arr;
    } else throw new Error(`Parameters expected an array but received ${typeof parameters} instead`);
  } else if (placeholders > parameters.length) {
    for (let i = parameters.length; i < placeholders; i++) {
      parameters[i] = null;
    }
  }

  return parameters;
};
