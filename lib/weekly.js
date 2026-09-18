/* WarpX weekly vegetable plans — the shape of a week, the delivery slots, and
   whether a window is still taking plans.

   Loaded both ways, like lib/fee.js and lib/schedule.js: `require`d by
   server.js and dropped into the browser as <script src="lib/weekly.js">, so
   the planner page and the server agree on which day is which and what a slot
   means. In the browser lib/schedule.js MUST be loaded first — it's a plain
   script, so parseSchedule is already a global by the time this runs. */

const _schedule = (typeof module !== "undefined" && module.exports) ? require("./schedule") : null;
function _parse(value) { return _schedule ? _schedule.parseSchedule(value) : parseSchedule(value); }

/* Hard-coded English on purpose. A day's label has to be derived from its real
   date — a week starting on a Saturday would otherwise show "Monday" over
   Saturday's card — but it must NOT come from toLocaleDateString(), because
   these labels are also the key tying a cart line to a day. A customer whose
   phone is set to Hindi would otherwise write notes that checkout can't map
   back. So: real weekday, fixed spelling. The date shown beside the label is
   localised; the label itself never is. */
const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/* Four bands, all inside the 08:00-22:00 service window lib/schedule.js
   already enforces for every other order. Four is enough for a town this size
   and keeps a per-slot capacity number meaningful — twenty slots of two
   customers each would just be per-person slots wearing a hat. */
const DELIVERY_SLOTS = [
  { id: "morning-early", start: "08:00", end: "10:00", label: "8 – 10 am" },
  { id: "morning-late", start: "10:00", end: "12:00", label: "10 am – 12 pm" },
  { id: "evening-early", start: "16:00", end: "18:00", label: "4 – 6 pm" },
  { id: "evening-late", start: "18:00", end: "20:00", label: "6 – 8 pm" },
];

function slotById(id) {
  return DELIVERY_SLOTS.find((s) => s.id === id) || null;
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

/* "YYYY-MM-DD" + n days -> "YYYY-MM-DD", via the explicit Date constructor
   rather than new Date(str) — same reason lib/schedule.js spells its parsing
   out: the string form parses as UTC in some engines and local in others, and
   a day-boundary bug here would deliver someone's veg on the wrong day. */
function addDays(dateStr, n) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || "").trim());
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3] + n);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/* The seven days of a window: index (what travels on the wire), real date, and
   the weekday it actually falls on. One call powers the planner's day cards,
   checkout's grouping, the admin day picker and the day tag stored on each
   item — so all four agree by construction. */
function weekDates(weekStart) {
  const out = [];
  for (let index = 0; index < 7; index++) {
    const date = addDays(weekStart, index);
    if (!date) return [];
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    const label = WEEKDAY_NAMES[new Date(+m[1], +m[2] - 1, +m[3]).getDay()];
    out.push({ index, date, label });
  }
  return out;
}

// The day tag stored on an item, and shown on its card. Derived from the real
// date so a week can start on any weekday without mislabelling itself.
function dayLabelFor(weekStart, index) {
  const day = weekDates(weekStart)[Number(index)];
  return day ? day.label : null;
}

// What goes in orders.scheduled_for: the day's date at the slot's start time,
// in exactly the format parseSchedule() consumes.
function scheduledForDay(weekStart, dayIndex, slotId) {
  const date = addDays(weekStart, Number(dayIndex));
  const slot = slotById(slotId);
  if (!date || !slot) return null;
  return `${date} ${slot.start}`;
}

// "Monday 21 Sep" — the one date formatter for this feature, replacing the
// copies that had started accumulating on four separate pages.
function formatDayDate(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || "").trim());
  if (!m) return dateStr || "";
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" });
}

/* Whether a window is still accepting plans: the owner hasn't closed it AND
   the cutoff hasn't passed. Two independent gates on purpose — the cutoff is
   the hard deadline, "closed" is the owner's early-stop button. */
function isWindowOpen(window, now) {
  if (!window || window.status !== "open") return false;
  const cutoff = _parse(window.cutoff_at);
  if (!cutoff) return false;
  const today = now instanceof Date ? now : new Date();
  return today.getTime() < cutoff.getTime();
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    WEEKDAY_NAMES, DELIVERY_SLOTS,
    slotById, addDays, weekDates, dayLabelFor, scheduledForDay, formatDayDate, isWindowOpen,
  };
}
