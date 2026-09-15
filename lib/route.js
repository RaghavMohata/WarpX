/* WarpX weekly route sequencing — turns a flat set of weekly grocery orders
   into per-driver stop lists that run geographically straight, one stop
   after another, instead of scattering a driver across town in signup
   order.

   Deliberately NOT a real TSP solver: at the scale this runs at (a week's
   worth of orders, capped per driver — typically 10-20 stops total) a
   simple nearest-neighbor walk from the dark store is close enough, instant,
   and stays understandable. Known flaw: because it never looks ahead, it can
   leave one or two out-of-the-way stops for last, producing one
   longer-than-ideal final leg. At this scale that shows up as at most one
   awkward jump in the preview, not a systemically bad route — the owner
   reviews the stop list before committing precisely so this is visible
   ahead of time. */
const { DARK_STORE, haversineKm } = require("./zone");

function nearestNeighborOrder(stops) {
  const remaining = stops.slice();
  const ordered = [];
  let cursor = { lat: DARK_STORE.lat, lng: DARK_STORE.lng };
  while (remaining.length) {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = haversineKm(cursor.lat, cursor.lng, remaining[i].lat, remaining[i].lng);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    const [next] = remaining.splice(bestIdx, 1);
    ordered.push(next);
    cursor = next;
  }
  return ordered;
}

/* Splits a set of orders into one route per driver: a single geographic walk
   from the dark store, cut into contiguous, roughly-even chunks capped at
   maxPerDriver. Chunking ONE walk (rather than running nearest-neighbor
   independently per driver) is what keeps each driver's stops adjacent
   rather than interleaved with another driver's patch of town. Even-sized
   chunks (not "fill driver 1 to the cap first") is what keeps a fixed
   amount of work spread across everyone working that day, matching "each
   driver gets a fixed amount, capped" rather than dumping load on whoever
   is first in the list. Orders with no lat/lng can't be placed in a
   geographic walk, so they ride along at the very end instead of being
   silently dropped. */
function assignRoutes(orders, driverIds, maxPerDriver) {
  if (!orders || orders.length === 0) throw new Error("There are no orders in this window to route yet.");
  if (!Array.isArray(driverIds) || driverIds.length === 0) throw new Error("Pick at least one driver.");
  if (!Number.isInteger(maxPerDriver) || maxPerDriver < 1) {
    throw new Error("Max deliveries per driver must be a whole number of 1 or more.");
  }

  const capacity = driverIds.length * maxPerDriver;
  if (orders.length > capacity) {
    throw new Error(
      `${orders.length} orders won't fit ${driverIds.length} driver(s) at ${maxPerDriver} each ` +
      `(room for ${capacity}). Add another driver or raise the cap.`
    );
  }

  const located = orders.filter((o) => o.lat != null && o.lng != null);
  const unlocated = orders.filter((o) => o.lat == null || o.lng == null);
  const sequence = nearestNeighborOrder(located).concat(unlocated);

  const base = Math.floor(sequence.length / driverIds.length);
  let remainder = sequence.length % driverIds.length;
  const sizes = driverIds.map(() => base);
  for (let i = 0; i < sizes.length && remainder > 0; i++) {
    if (sizes[i] < maxPerDriver) { sizes[i]++; remainder--; }
  }

  const routes = [];
  let cursor = 0;
  driverIds.forEach((driverId, i) => {
    const stops = sequence.slice(cursor, cursor + sizes[i]);
    cursor += sizes[i];
    if (stops.length) routes.push({ driverId, stops });
  });

  return { routes, unlocatedCount: unlocated.length };
}

/* Approximate route-from-store distance for one driver's chunk, purely to
   give the owner a sanity-check number on the preview screen ("~4.2 km, 6
   stops" reads as plausible or not at a glance). */
function routeDistanceKm(stops) {
  let total = 0;
  let cursor = { lat: DARK_STORE.lat, lng: DARK_STORE.lng };
  for (const s of stops) {
    if (s.lat == null || s.lng == null) continue;
    total += haversineKm(cursor.lat, cursor.lng, s.lat, s.lng);
    cursor = s;
  }
  return Math.round(total * 10) / 10;
}

module.exports = { nearestNeighborOrder, assignRoutes, routeDistanceKm };
