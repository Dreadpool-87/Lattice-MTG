const brusselsClock = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Brussels",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  hourCycle: "h23",
});

// Represent Brussels wall-clock fields as UTC so calendar arithmetic is independent of the visitor.
function brusselsWallTime(instant) {
  const fields = Object.fromEntries(brusselsClock.formatToParts(instant).map(
    ({ type, value }) => [type, Number(value)]
  ));
  return new Date(Date.UTC(fields.year, fields.month - 1, fields.day, fields.hour, fields.minute));
}

export function nextScheduledUpdate(now = new Date()) {
  const sunday = brusselsWallTime(now);
  sunday.setUTCDate(sunday.getUTCDate() + (7 - sunday.getUTCDay()) % 7);
  sunday.setUTCHours(7, 15, 0, 0);

  // At 07:15 both this guess and the true instant are after the Brussels DST transition.
  const toInstant = wallTime => new Date(2 * wallTime.getTime() - brusselsWallTime(wallTime).getTime());
  const candidate = toInstant(sunday);
  if (candidate > now) return candidate;
  sunday.setUTCDate(sunday.getUTCDate() + 7);
  return toInstant(sunday);
}

const schedule = document.getElementById("next-data-update");
if (schedule) {
  const next = nextScheduledUpdate();
  const localTime = new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
  const time = document.createElement("time");
  time.dateTime = next.toISOString();
  time.textContent = localTime.format(next);
  schedule.replaceChildren("Next scheduled data check: ", time, " (your local time).");
}
