import type { Connection, PoolConnection } from 'mysql2/promise';
import { scheduleTick } from '../utils/scheduleTick';
import { pool, poolReady } from './pool';
import type { CFXParameters } from 'types';
import { typeCast, typeCastExecute } from 'utils/typeCast';

(Symbol as any).dispose ??= Symbol('Symbol.dispose');

const activeConnections: Record<string, MySql> = {};

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

export async function getConnection(connectionId?: number) {
  if (!pool) await poolReady;

  return connectionId
    ? activeConnections[connectionId]
    : new MySql((await pool.getConnection()) as unknown as PromisePoolConnection);
}
