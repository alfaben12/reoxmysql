const resourceName = GetCurrentResourceName();

// Coalesce ScheduleResourceTick calls within the same event-loop tick.
// At high QPS (thousands of queries/sec) many queries land in the same tick,
// and each `ScheduleResourceTick` crosses the JS ↔ native boundary.  We only
// need to wake the resource tick once — subsequent calls in the same tick are
// no-ops until the next microtask drain resets the flag.
let _scheduled = false;

export function scheduleTick() {
  if (_scheduled) return;
  _scheduled = true;
  ScheduleResourceTick(resourceName);
  // setImmediate runs after the current microtask queue drains, i.e. after
  // every query issued "synchronously" from the same handler has been queued.
  setImmediate(() => {
    _scheduled = false;
  });
}
