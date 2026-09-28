/* WarpX delivery area — where we deliver, and how far each address is.

   Loaded two ways, like lib/fee.js: `require`d by server.js and served to the
   browser as <script src="lib/zone.js">, so the area the login page shows and
   the one the server charges for can never drift apart. No require, no Node
   APIs, and keep the export footer at the bottom.

   The area is two towns and the road between them: Brahmapuri, Wadsa
   (Desaiganj), and a band either side of the ~12 km road that joins them.
   Anywhere else is refused. Coordinates are from OpenStreetMap.

   ponytail: distances are straight-line from HUB, not road km. The Wadsa
   road is nearly straight (12.5 km by road vs 10.9 in a line), so the per-km
   fee lands close enough; switch to a routing API if twisty routes appear. */

// Where distances are measured from, and where riders start: Brahmapuri
// town centre. To fine-tune, change these two numbers.
const HUB = { lat: 20.6084, lng: 79.8586, name: "Brahmapuri" };
// Old name, still used by lib/route.js for the weekly route walk.
const DARK_STORE = HUB;

const AREAS = [
  { id: "brahmapuri", name: "Brahmapuri", lat: 20.6084, lng: 79.8586, radiusKm: 3 },
  { id: "wadsa", name: "Wadsa", lat: 20.6238, lng: 79.9626, radiusKm: 2.5 },
];

// The Brahmapuri–Wadsa road (NH543), simplified from the OSRM route.
const ROAD = [
  [20.6086, 79.8586], [20.6120, 79.8557], [20.6155, 79.8566], [20.6164, 79.8614],
  [20.6136, 79.8663], [20.6148, 79.8753], [20.6167, 79.9001], [20.6193, 79.9450],
  [20.6228, 79.9538], [20.6240, 79.9612], [20.6244, 79.9624],
];
const ROAD_WIDTH_KM = 1.5; // how far either side of the road still counts

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Flat x/y in km around HUB — plenty accurate over a 15 km patch.
function toKm(lat, lng) {
  return { x: (lng - HUB.lng) * 111 * Math.cos((HUB.lat * Math.PI) / 180), y: (lat - HUB.lat) * 111 };
}

function kmFromRoad(lat, lng) {
  const p = toKm(lat, lng);
  let best = Infinity;
  for (let i = 1; i < ROAD.length; i++) {
    const a = toKm(ROAD[i - 1][0], ROAD[i - 1][1]);
    const b = toKm(ROAD[i][0], ROAD[i][1]);
    const dx = b.x - a.x, dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
    best = Math.min(best, Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)));
  }
  return best;
}

function etaFor(distanceKm) {
  if (distanceKm <= 3) return "15-25";
  if (distanceKm <= 8) return "25-40";
  return "35-50";
}

/* Is this spot inside the delivery area, which part, and how far out?
   served:false means we don't deliver there — the server refuses the order. */
function coverageFor(lat, lng) {
  const la = Number(lat), ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) {
    return { served: false, area: null, areaName: null, distanceKm: null, etaMin: null };
  }
  const distanceKm = haversineKm(la, ln, HUB.lat, HUB.lng);
  const town = AREAS.find((a) => haversineKm(la, ln, a.lat, a.lng) <= a.radiusKm);
  const onRoad = !town && kmFromRoad(la, ln) <= ROAD_WIDTH_KM;
  const area = town ? town.id : onRoad ? "road" : null;
  return {
    served: Boolean(area),
    area,
    areaName: town ? town.name : onRoad ? "Brahmapuri–Wadsa road" : null,
    distanceKm,
    etaMin: area ? etaFor(distanceKm) : null,
  };
}

/* The shape the addresses/locations tables have always stored. zone is now
   the area id ("brahmapuri", "wadsa", "road") or "outside". */
function classifyZone(lat, lng) {
  const c = coverageFor(lat, lng);
  return { distanceKm: c.distanceKm, zone: c.area || "outside", etaMin: c.etaMin || "—" };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    HUB, DARK_STORE, AREAS, ROAD, ROAD_WIDTH_KM,
    haversineKm, kmFromRoad, coverageFor, classifyZone, etaFor,
  };
}
