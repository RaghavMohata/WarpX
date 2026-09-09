/* WarpX scheduled orders — when a delivery is asked for, and whether that's
   a time we can actually honour.

   Loaded both ways, like lib/fee.js: `require`d by server.js and served to the
   browser as <script src="lib/schedule.js">, so checkout refuses exactly the
   slots the server would refuse rather than letting someone pick a time only
   to be rejected after they hit Place order.

   Times are plain local wall-clock strings ("2026-09-10 19:00"), not UTC.
   The shop, the drivers and the customers are all in one town in one
   timezone, so storing local time removes an entire class of conversion bugs
   and costs nothing. A second town in another timezone would need this
   revisited — see the README. */

const SCHEDULE_OPEN_HOUR = 8;    // first slot of the day, 08:00
const SCHEDULE_CLOSE_HOUR = 22;  // last slot of the day, 22:00
const MIN_LEAD_MINUTES = 30;     // no "in five minutes" scheduling
const MAX_DAYS_AHEAD = 7;
const DISPATCH_LEAD_MINUTES = 45; // how early a scheduled order reaches drivers

function pad2(n) {
  return String(n).padStart(2, "0");
}

/* "YYYY-MM-DD HH:MM" -> Date in local time. Deliberately not `new Date(str)`:
   that parses some formats as UTC and some as local depending on the engine,
   which is exactly the ambiguity this module exists to avoid. */
function parseSchedule(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(String(value || "").trim());
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], 0, 0);
  return isNaN(d.getTime()) ? null : d;
}

function validateSchedule(dateStr, timeStr, now) {
  const today = now instanceof Date ? now : new Date();
  if (!dateStr || !timeStr) {
    return { ok: false, error: "Pick both a date and a time for your delivery." };
  }
  const when = parseSchedule(`${dateStr} ${timeStr}`);
  if (!when) return { ok: false, error: "That date or time doesn't look right." };

  const minutesOut = (when.getTime() - today.getTime()) / 60000;
  if (minutesOut < MIN_LEAD_MINUTES) {
    return {
      ok: false,
      error: `Schedule at least ${MIN_LEAD_MINUTES} minutes ahead — for anything sooner, order now instead.`,
    };
  }
  if (minutesOut / (60 * 24) > MAX_DAYS_AHEAD) {
    return { ok: false, error: `We only take orders up to ${MAX_DAYS_AHEAD} days ahead.` };
  }

  const hour = when.getHours() + when.getMinutes() / 60;
  if (hour < SCHEDULE_OPEN_HOUR || hour > SCHEDULE_CLOSE_HOUR) {
    return {
      ok: false,
      error: `We deliver between ${pad2(SCHEDULE_OPEN_HOUR)}:00 and ${pad2(SCHEDULE_CLOSE_HOUR)}:00. Pick a time in that window.`,
    };
  }

  return { ok: true, value: `${dateStr} ${timeStr}` };
}

/* "Today at 7:00 pm" reads better than a raw timestamp on an order card. */
function formatSchedule(value, now) {
  const when = parseSchedule(value);
  if (!when) return "";
  const today = now instanceof Date ? now : new Date();

  const midnight = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dayGap = Math.round((midnight(when) - midnight(today)) / 86400000);

  let h = when.getHours();
  const suffix = h >= 12 ? "pm" : "am";
  h = h % 12 || 12;
  const clock = `${h}:${pad2(when.getMinutes())} ${suffix}`;

  if (dayGap === 0) return `Today at ${clock}`;
  if (dayGap === 1) return `Tomorrow at ${clock}`;
  const day = when.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  return `${day} at ${clock}`;
}

/* A scheduled order sitting on the driver board all day is noise — worse, a
   driver can claim a 7pm delivery at 10am and then it just sits assigned.
   Scheduled orders only become claimable near their slot. */
function isDueForDispatch(value, now) {
  if (!value) return true; // an ASAP order is always due
  const when = parseSchedule(value);
  if (!when) return true;
  const today = now instanceof Date ? now : new Date();
  return (when.getTime() - today.getTime()) / 60000 <= DISPATCH_LEAD_MINUTES;
}

/* Bounds for the date input, so the picker can't even offer a bad day. */
function scheduleDateBounds(now) {
  const today = now instanceof Date ? now : new Date();
  const iso = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const max = new Date(today.getFullYear(), today.getMonth(), today.getDate() + MAX_DAYS_AHEAD);
  return { min: iso(today), max: iso(max) };
}

/* ---- Open / closed --------------------------------------------------------
   The same window bounds scheduled slots and walk-up ASAP orders. Before this
   existed only scheduled orders were checked, so someone could place an ASAP
   order at 3am and the ETA promise was broken before anyone saw it. */
function isOpenNow(now) {
  const today = now instanceof Date ? now : new Date();
  const hour = today.getHours() + today.getMinutes() / 60;
  return hour >= SCHEDULE_OPEN_HOUR && hour < SCHEDULE_CLOSE_HOUR;
}

/* The next moment the shop is open — today if it hasn't opened yet, otherwise
   tomorrow morning. Used to turn "we're closed" into an offer rather than a
   dead end. */
function nextOpeningSlot(now) {
  const today = now instanceof Date ? now : new Date();
  const hour = today.getHours() + today.getMinutes() / 60;
  const day = hour < SCHEDULE_OPEN_HOUR
    ? new Date(today.getFullYear(), today.getMonth(), today.getDate(), SCHEDULE_OPEN_HOUR, 0)
    : new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1, SCHEDULE_OPEN_HOUR, 0);
  return {
    date: `${day.getFullYear()}-${pad2(day.getMonth() + 1)}-${pad2(day.getDate())}`,
    time: `${pad2(SCHEDULE_OPEN_HOUR)}:00`,
    label: formatSchedule(`${day.getFullYear()}-${pad2(day.getMonth() + 1)}-${pad2(day.getDate())} ${pad2(SCHEDULE_OPEN_HOUR)}:00`, today),
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    validateSchedule, parseSchedule, formatSchedule, isDueForDispatch, scheduleDateBounds,
    isOpenNow, nextOpeningSlot,
    SCHEDULE_OPEN_HOUR, SCHEDULE_CLOSE_HOUR, MIN_LEAD_MINUTES, MAX_DAYS_AHEAD, DISPATCH_LEAD_MINUTES,
  };
}
