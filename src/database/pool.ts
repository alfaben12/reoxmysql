import { getConnectionOptions, mysql_connector, mysql_transaction_isolation_level } from 'config';
import { createPool } from 'mysql2/promise';
import type { RowDataPacket } from 'mysql2/promise';

export let readPool: any;
export let writePool: any;
// keep `pool` export for any consumer that still references it directly
export { writePool as pool };
export let dbVersion = '';
export let readLimit = 0;
export let writeLimit = 0;

let _poolReadyResolve: (() => void) | null = null;
export const poolReady = new Promise<void>((resolve) => {
  _poolReadyResolve = resolve;
});

// Pre-open `count` connections and release them immediately.  This forces the
// TCP handshake + MySQL auth to happen at startup so the first real query hits
// an already-warm connection instead of paying the 50-150 ms cold-start cost.
async function warmUpPool(pool: any, count: number): Promise<void> {
  if (count <= 0) return;
  const conns = await Promise.all(Array.from({ length: count }, () => pool.getConnection()));
  for (const c of conns) c.release();
}

function attachIsolationListener(dbPool: any) {
  dbPool.on('connection', (conn: any) => {
    conn.query(mysql_transaction_isolation_level).catch(() => {});
  });
}

export async function createConnectionPool() {
  const config      = getConnectionOptions();
  const queueLimit  = GetConvarInt('re_mysql_queue_limit', 0);
  const maxIdle     = GetConvarInt('re_mysql_max_idle_connections', 0);
  const idleTimeout = GetConvarInt('re_mysql_idle_timeout', 60000);

  // re_mysql_read_connections / re_mysql_write_connections are the only pool-size
  // convars. Default 0 = no connection limit (driver-unlimited). Operators SHOULD
  // set these for production — without them the pool grows unbounded under load.
  readLimit  = GetConvarInt('re_mysql_read_connections',  0);
  writeLimit = GetConvarInt('re_mysql_write_connections', 0);

  const readStr  = readLimit  === 0 ? 'unlimited' : String(readLimit);
  const writeStr = writeLimit === 0 ? 'unlimited' : String(writeLimit);

  // Warm-up count: for limited pools cap below pool size; for unlimited pools
  // pre-open a fixed small count so first real queries hit warm connections.
  const warmRead  = readLimit  === 0 ? 3 : Math.min(3, readLimit  - 1);
  const warmWrite = writeLimit === 0 ? 2 : Math.min(2, writeLimit);

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

      // connectionLimit: 0 = unlimited in mariadb
      readPool  = mariadb.createPool({ ...mariadbBase, connectionLimit: readLimit });
      writePool = mariadb.createPool({ ...mariadbBase, connectionLimit: writeLimit });

      attachIsolationListener(readPool);
      attachIsolationListener(writePool);

      const testConn = await readPool.getConnection();
      const rows = await testConn.query('SELECT VERSION() as version');
      await testConn.release();
      dbVersion = `^5[${rows[0].version}]`;

      console.log(`${dbVersion} ^2Database server connection established!^0`);
      console.log(
        `^2Pool: read=${readStr} write=${writeStr}, idleTimeout: ${idleTimeout}ms, maxStmt: ${mariadbBase.prepareCacheSize}, [mariadb]^0`
      );

      await warmUpPool(readPool,  warmRead);
      await warmUpPool(writePool, warmWrite);

      if ((config as any).multipleStatements) {
        console.warn(`multipleStatements is enabled. Used incorrectly, this option may cause SQL injection.`);
      }
    } else {
      // connectionLimit: 0 = unlimited in mysql2
      // maxIdle: omit (pass undefined) when 0 so mysql2 uses its own default
      const baseConfig: any = {
        ...config,
        waitForConnections: true,
        queueLimit,
        idleTimeout,
        enableKeepAlive:       true,
        keepAliveInitialDelay: 0,
      };

      readPool  = createPool({ ...baseConfig, connectionLimit: readLimit,  ...(maxIdle > 0 && { maxIdle: Math.ceil(maxIdle * 0.6) }) });
      writePool = createPool({ ...baseConfig, connectionLimit: writeLimit, ...(maxIdle > 0 && { maxIdle: maxIdle - Math.ceil(maxIdle * 0.6) }) });

      attachIsolationListener(readPool);
      attachIsolationListener(writePool);

      const [result] = (await readPool.query('SELECT VERSION() as version')) as RowDataPacket[];
      dbVersion = `^5[${result[0].version}]`;

      console.log(`${dbVersion} ^2Database server connection established!^0`);
      console.log(
        `^2Pool: read=${readStr} write=${writeStr}, queue: ${queueLimit === 0 ? 'unlimited' : queueLimit}, idleTimeout: ${idleTimeout}ms, maxStmt: ${config.maxPreparedStatements ?? 500}, gracefulEnd: ${config.gracefulEnd ?? true}^0`
      );

      await warmUpPool(readPool,  warmRead);
      await warmUpPool(writePool, warmWrite);

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

// Adaptive batch concurrency cap — uses module-level writeLimit (set once at
// pool init from re_mysql_write_connections) so no convar re-read per call.
export function getLiveBatchLimit(paramCount: number): number {
  // Unlimited write pool — spawn one worker per param set.
  if (writeLimit === 0) return paramCount;

  // Full batch: use the entire write pool — no need to check idle count.
  if (paramCount >= writeLimit) return writeLimit;

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

  // No hard floor — pool handles backpressure via waitForConnections:true.
  return Math.min(Math.max(1, Math.floor(idleCount * 0.8)), paramCount);
}
