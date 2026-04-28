import { getConnectionOptions, mysql_connector, mysql_transaction_isolation_level } from 'config';
import { createPool } from 'mysql2/promise';
import type { RowDataPacket } from 'mysql2/promise';

export let readPool: any;
export let writePool: any;
// keep `pool` export for any consumer that still references it directly
export { writePool as pool };
export let dbVersion = '';

let _poolReadyResolve: (() => void) | null = null;
export const poolReady = new Promise<void>((resolve) => {
  _poolReadyResolve = resolve;
});

function attachIsolationListener(dbPool: any) {
  dbPool.on('connection', (conn: any) => {
    conn.query(mysql_transaction_isolation_level).catch(() => {});
  });
}

export async function createConnectionPool() {
  const config = getConnectionOptions();
  const connectionLimit = GetConvarInt('re_mysql_connection_limit', 25);
  const queueLimit      = GetConvarInt('re_mysql_queue_limit', 0);
  const maxIdle         = GetConvarInt('re_mysql_max_idle_connections', connectionLimit);
  const idleTimeout     = GetConvarInt('re_mysql_idle_timeout', 60000);

  // Read pool gets 60% of connections, write pool gets the rest.
  // Both limits are tunable via convars so operators can adjust the ratio.
  const readLimit  = GetConvarInt('re_mysql_read_connections',  Math.ceil(connectionLimit * 0.6));
  const writeLimit = GetConvarInt('re_mysql_write_connections', connectionLimit - readLimit);

  try {
    if (mysql_connector === 'mariadb') {
      const mariadb = require('mariadb');

      const mariadbBase: any = {
        host:              config.host,
        port:              config.port,
        user:              config.user,
        password:          config.password,
        database:          config.database,
        ...(config.ssl && { ssl: config.ssl }),
        connectTimeout:    (config as any).connectTimeout ?? 60000,
        compress:          (config as any).compress ?? false,
        namedPlaceholders: false,
        insertIdAsNumber:  true,
        bigIntAsNumber:    true,
        prepareCacheSize:  (config as any).maxPreparedStatements ?? 500,
        idleTimeout:       Math.round(idleTimeout / 1000),
      };

      readPool  = mariadb.createPool({ ...mariadbBase, connectionLimit: readLimit });
      writePool = mariadb.createPool({ ...mariadbBase, connectionLimit: writeLimit });

      attachIsolationListener(readPool);
      attachIsolationListener(writePool);

      // Verify connectivity once via read pool
      const testConn = await readPool.getConnection();
      const rows = await testConn.query('SELECT VERSION() as version');
      await testConn.release();
      dbVersion = `^5[${rows[0].version}]`;

      console.log(`${dbVersion} ^2Database server connection established!^0`);
      console.log(
        `^2Pool: read=${readLimit} write=${writeLimit}, idleTimeout: ${idleTimeout}ms, maxStmt: ${mariadbBase.prepareCacheSize}, [mariadb]^0`
      );

      if ((config as any).multipleStatements) {
        console.warn(`multipleStatements is enabled. Used incorrectly, this option may cause SQL injection.`);
      }
    } else {
      const baseConfig = {
        ...config,
        waitForConnections: true,
        queueLimit,
        idleTimeout,
        enableKeepAlive: true,
        keepAliveInitialDelay: 0,
      };

      readPool  = createPool({ ...baseConfig, connectionLimit: readLimit,  maxIdle: Math.ceil(maxIdle * 0.6) });
      writePool = createPool({ ...baseConfig, connectionLimit: writeLimit, maxIdle: maxIdle - Math.ceil(maxIdle * 0.6) });

      attachIsolationListener(readPool);
      attachIsolationListener(writePool);

      const [result] = (await readPool.query('SELECT VERSION() as version')) as RowDataPacket[];
      dbVersion = `^5[${result[0].version}]`;

      console.log(`${dbVersion} ^2Database server connection established!^0`);
      console.log(
        `^2Pool: read=${readLimit} write=${writeLimit}, queue: ${queueLimit === 0 ? 'unlimited' : queueLimit}, idleTimeout: ${idleTimeout}ms, maxStmt: ${config.maxPreparedStatements ?? 500}, gracefulEnd: ${config.gracefulEnd ?? true}^0`
      );

      if (config.multipleStatements) {
        console.warn(`multipleStatements is enabled. Used incorrectly, this option may cause SQL injection.`);
      }
    }

    _poolReadyResolve?.();
    _poolReadyResolve = null;
  } catch (err: any) {
    const message = err.message?.includes('auth_gssapi_client')
      ? `Requested authentication using unknown plugin auth_gssapi_client.`
      : err.message;

    console.log(
      `^3Unable to establish a connection to the database (${err.code})!\n^1Error${
        err.errno ? ` ${err.errno}` : ''
      }: ${message}^0`
    );

    console.log(`See https://github.com/overextended/oxmysql/issues/154 for more information.`);

    if (config.password) config.password = '******';
    console.log(config);
  }
}

// Adaptive batch concurrency cap — reads live idle count from the write pool
// because batch operations (rawExecute parallel, tickBatcher) are always writes.
export function getLiveBatchLimit(paramCount: number): number {
  const writeLimit = GetConvarInt('re_mysql_write_connections',
    Math.ceil(GetConvarInt('re_mysql_connection_limit', 25) * 0.4));

  let idleCount: number;
  try {
    if (!writePool) {
      idleCount = writeLimit;
    } else if (mysql_connector === 'mariadb') {
      idleCount = typeof (writePool as any).idleConnections === 'function'
        ? (writePool as any).idleConnections()
        : writeLimit;
    } else {
      idleCount = Array.isArray((writePool as any)._freeConnections)
        ? (writePool as any)._freeConnections.length
        : writeLimit;
    }
  } catch {
    idleCount = writeLimit;
  }

  return Math.min(Math.max(4, Math.floor(idleCount * 0.6)), paramCount);
}
