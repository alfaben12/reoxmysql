const resourceName = GetCurrentResourceName();

export function scheduleTick() {
  ScheduleResourceTick(resourceName);
}
