import type { Connection, PoolConnection } from 'mysql2/promise';
import { scheduleTick } from '../utils/scheduleTick';
import { pool, poolReady } from './pool';
import type { CFXParameters } from 'types';
import { typeCast, typeCastExecute } from 'utils/typeCast';
import { mysql_connector } from 'config';

(Symbol as any).dispose ??= Symbol('Symbol.dispose');

const activeConnections: Record<number, any> = {};

// ── mariadb wire-protocol ColumnType constants ────────────────────────────────
const T_TINY = 1, T_TIMESTAMP = 7, T_DATE = 10, T_DATETIME = 12, T_NEWDATE = 14;
const T_BIT = 16;
const T_TINYBLOB = 249, T_MEDIUMBLOB = 250, T_LONGBLOB = 251, T_BLOB = 252;
const BINARY_FLAG = 128, BINARY_CHARSET = 63;

function needsNorm(t: number): boolean {
  return t === T_TINY || t === T_TIMESTAMP || t === T_DATE ||
         t === T_DATETIME || t === T_NEWDATE || t === T_BIT ||
         t === T_TINYBLOB || t === T_MEDIUMBLOB || t === T_LONGBLOB || t === T_BLOB;
}

function normalizeField(value: any, field: any): any {
  if (value === null || value === undefined) return null;
  switch (field.columnType) {
    case T_TIMESTAMP: case T_DATETIME: case T_NEWDATE:
      return value instanceof Date ? value.getTime() : null;
    case T_DATE:
      return value instanceof Date ? value.getTime() : null;
    case T_TINY:
      return field.columnLength === 1 ? (value === 1 || value === true) : value;
    case T_BIT:
      return Buffer.isBuffer(value)
        ? (field.columnLength === 1 ? value[0] === 1 : value[0])
        : value;
    case T_TINYBLOB: case T_MEDIUMBLOB: case T_LONGBLOB: case T_BLOB: {
      const isBinary = !!(field.flags & BINARY_FLAG) || field.collation?.index === BINARY_CHARSET;
      if (isBinary) return Buffer.isBuffer(value) ? [...value] : null;
      return Buffer.isBuffer(value) ? value.toString('utf8') : value;
    }
    default:
      return value;
  }
}

function normalizeMariaDbResult(result: any): any {
  if (!result) return result;
  if (!Array.isArray(result)) return result;

  const meta: any[] = (result as any).meta;
  if (!meta?.length) return result;
  if (!meta.some((f) => needsNorm(f.columnType))) return result;

  return result.map((row: any) => {
    const out: any = {};
    for (const f of meta) { const k = f.name(); out[k] = normalizeField(row[k], f); }
    return out;
  });
}
// ─────────────────────────────────────────────────────────────────────────────

interface PromisePoolConnection extends Connection {
  connection: PoolConnection;
  release: PoolConnection['release'];
}

export class MySql {
  id: number;
  connection: PromisePoolConnection;
  transaction?: boolean;

  constructor(connection: PromisePoolConnection) {
    this.id = connection.connection.threadId;
    this.connection = connection;
    activeConnections[this.id] = this;
  }

  async query(query: string, values: CFXParameters = []) {
    scheduleTick();

    const [result] = await this.connection.query({ sql: query, values, typeCast });
    return result;
  }

  async execute(query: string, values: CFXParameters = []) {
    scheduleTick();

    const [result] = await this.connection.execute({
      sql: query,
      values: values,
      typeCast: typeCastExecute,
    });
    return result;
  }

  beginTransaction() {
    this.transaction = true;
    return this.connection.beginTransaction();
  }

  rollback() {
    delete this.transaction;
    return this.connection.rollback();
  }

  commit() {
    delete this.transaction;
    return this.connection.commit();
  }

  // Explicit release without transaction semantics — used by parallel batch execute
  release() {
    delete activeConnections[this.id];
    this.connection.release();
  }

  [Symbol.dispose]() {
    if (this.transaction) this.commit();

    delete activeConnections[this.id];
    this.connection.release();
  }
}

class MariaDbConnection {
  id: number;
  connection: any;
  transaction?: boolean;

  constructor(connection: any) {
    this.id = connection.threadId;
    this.connection = connection;
    activeConnections[this.id] = this;
  }

  async query(query: string, values: CFXParameters = []) {
    scheduleTick();
    return normalizeMariaDbResult(await this.connection.query(query, values));
  }

  async execute(query: string, values: CFXParameters = []) {
    scheduleTick();
    return normalizeMariaDbResult(await this.connection.execute(query, values));
  }

  beginTransaction() { this.transaction = true;  return this.connection.beginTransaction(); }
  rollback()         { delete this.transaction;  return this.connection.rollback(); }
  commit()           { delete this.transaction;  return this.connection.commit(); }

  release() {
    delete activeConnections[this.id];
    this.connection.release();
  }

  [Symbol.dispose]() {
    if (this.transaction) this.commit();
    delete activeConnections[this.id];
    this.connection.release();
  }
}

export async function getConnection(connectionId?: number) {
  if (!pool) await poolReady;

  if (connectionId) return activeConnections[connectionId];

  const conn = await (pool as any).getConnection();
  return mysql_connector === 'mariadb'
    ? new MariaDbConnection(conn)
    : new MySql(conn as unknown as PromisePoolConnection);
}
