import { setDebug } from '../config';
import { sleep } from '../utils/sleep';
import { pool, createConnectionPool } from './pool';

setTimeout(async () => {
  setDebug();

  while (!pool) {
    await createConnectionPool();

    if (!pool) await sleep(30000);
  }
});

// Event-driven convar refresh.  `AddConvarChangeListener` is a FiveM native that
// only fires when a matching convar actually changes — replacing the old
// `setInterval(setDebug, 1000)` polling loop that did GetConvar + JSON.parse
// every second forever, even when nothing changed.
if (typeof (globalThis as any).AddConvarChangeListener === 'function') {
  (globalThis as any).AddConvarChangeListener('re_mysql_*', () => setDebug());
} else {
  // Fallback for older server builds that don't expose the native.
  // 5 s is plenty — debug flags are tuned manually, not per-frame.
  setInterval(setDebug, 5000);
}

export * from './connection';
export * from './rawQuery';
export * from './rawExecute';
export * from './rawTransaction';
export * from './pool';
