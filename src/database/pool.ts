import { getConnectionOptions, mysql_transaction_isolation_level } from 'config';
import { createPool } from 'mysql2/promise';
import type { Pool, RowDataPacket } from 'mysql2/promise';

export let pool: Pool;
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
  // New tunables — allow ops to cap idle connections and recycle them when
  // the server is quiet, instead of holding `connectionLimit` live sockets
  // to MySQL forever.  Defaults preserve prior behaviour (keep everything
  // warm) but high-churn deployments can opt-in to tighter recycling.
  const maxIdle = GetConvarInt('re_mysql_max_idle_connections', connectionLimit);
  const idleTimeout = GetConvarInt('re_mysql_idle_timeout', 60000);

  try {
    const dbPool = createPool({
      ...config,
      connectionLimit,
      waitForConnections: true,
      queueLimit,
      maxIdle,
      idleTimeout,
      enableKeepAlive: true,
      // 0 = first keep-alive packet fires immediately once a socket goes idle.
      // At 10 s the server could hand out a dead socket during the first
      // keep-alive window after an outage; 0 closes that gap with no cost.
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
  } catch (err: any) {
    const message = err.message.includes('auth_gssapi_client')
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
