import { getConnectionOptions, mysql_connector, mysql_transaction_isolation_level } from 'config';
import { createPool } from 'mysql2/promise';
import type { RowDataPacket } from 'mysql2/promise';

export let pool: any;
export let dbVersion = '';

// Resolved once the pool is ready — replaces busy-wait polling in consumers
let _poolReadyResolve: (() => void) | null = null;
export const poolReady = new Promise<void>((resolve) => {
  _poolReadyResolve = resolve;
});

export async function createConnectionPool() {
  const config = getConnectionOptions();
  const connectionLimit = GetConvarInt('re_mysql_connection_limit', 25);
  const queueLimit = GetConvarInt('re_mysql_queue_limit', 0);
  const maxIdle = GetConvarInt('re_mysql_max_idle_connections', connectionLimit);
  const idleTimeout = GetConvarInt('re_mysql_idle_timeout', 60000);

  try {
    if (mysql_connector === 'mariadb') {
      const mariadb = require('mariadb');

      const mariadbConfig: any = {
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
        connectionLimit,
        // mariadb uses seconds; re_mysql_idle_timeout is milliseconds
        idleTimeout:       Math.round(idleTimeout / 1000),
      };

      const dbPool = mariadb.createPool(mariadbConfig);

      // 'connection' event fires (via setImmediate) when a NEW physical connection
      // is established. conn is a ConnectionPromise — has promise-based query().
      // pool-promise wraps handler errors in try/catch so a throw here is safe.
      dbPool.on('connection', (conn: any) => {
        conn.query(mysql_transaction_isolation_level).catch(() => {});
      });

      // Verify connectivity with explicit connection management to avoid race
      // conditions. mariadb.getConnection() resolves after the TCP+auth handshake;
      // the 'connection' setImmediate fires after we release.
      const testConn = await dbPool.getConnection();
      const rows = await testConn.query('SELECT VERSION() as version');
      await testConn.release();
      dbVersion = `^5[${rows[0].version}]`;

      console.log(`${dbVersion} ^2Database server connection established!^0`);
      console.log(
        `^2Pool: ${connectionLimit} max, idleTimeout: ${idleTimeout}ms, maxStmt: ${mariadbConfig.prepareCacheSize}, [mariadb]^0`
      );

      if ((config as any).multipleStatements) {
        console.warn(`multipleStatements is enabled. Used incorrectly, this option may cause SQL injection.`);
      }

      pool = dbPool;
      _poolReadyResolve?.();
      _poolReadyResolve = null;
    } else {
      const dbPool = createPool({
        ...config,
        connectionLimit,
        waitForConnections: true,
        queueLimit,
        maxIdle,
        idleTimeout,
        enableKeepAlive: true,
        keepAliveInitialDelay: 0,
      });

      dbPool.on('connection', (connection) => {
        connection.query(mysql_transaction_isolation_level);
      });

      const [result] = (await dbPool.query('SELECT VERSION() as version')) as RowDataPacket[];
      dbVersion = `^5[${result[0].version}]`;

      console.log(`${dbVersion} ^2Database server connection established!^0`);
      console.log(
        `^2Pool: ${connectionLimit} max, ${maxIdle} idle, queue: ${queueLimit === 0 ? 'unlimited' : queueLimit}, idleTimeout: ${idleTimeout}ms, maxStmt: ${config.maxPreparedStatements ?? 500}, gracefulEnd: ${config.gracefulEnd ?? true}^0`
      );

      if (config.multipleStatements) {
        console.warn(`multipleStatements is enabled. Used incorrectly, this option may cause SQL injection.`);
      }

      pool = dbPool;
      _poolReadyResolve?.();
      _poolReadyResolve = null;
    }
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
