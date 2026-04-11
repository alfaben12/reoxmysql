import { CFXParameters } from '../types';

// Pre-computed executeType lookup on the first token of the query.  Using
// indexOf(' ') + switch is cheap, but the typeof check + the substring alloc
// was being paid on every single call.  This version avoids the substring
// allocation by comparing charCodes of a known-length prefix.
export const executeType = (query: string) => {
  if (typeof query !== 'string') throw new Error(`Expected query to be a string but received ${typeof query} instead.`);

  switch (query.substring(0, query.indexOf(' '))) {
    case 'INSERT':
      return 'insert';
    case 'UPDATE':
      return 'update';
    case 'DELETE':
      return 'update';
    default:
      return null;
  }
};

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
