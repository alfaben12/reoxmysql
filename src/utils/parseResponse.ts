import { ResultSetHeader, RowDataPacket } from 'mysql2';
import type { QueryResponse, QueryType } from '../types';

export const parseResponse = (type: QueryType, result: QueryResponse): any => {
  switch (type) {
    case 'insert':
      return (result as ResultSetHeader)?.insertId ?? null;

    case 'update':
      return (result as ResultSetHeader)?.affectedRows ?? null;

    case 'single':
      return (result as RowDataPacket[])?.[0] ?? null;

    case 'scalar':
      const row = (result as RowDataPacket[])?.[0];
      if (!row) return null;
      for (const key in row) return row[key]; // first value without allocating an array
      return null;

    default:
      return result ?? null;
  }
};
