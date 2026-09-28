/* WarpX location capture: GPS, the pin-drop map and the landmark list.
   Where we deliver (and how far a spot is) lives in lib/zone.js, which every
   page loads just before this file; the server runs the same file. */

/* The mock map shows both towns: ~17 × 10.6 km (the map box is 16:10),
   centred between Brahmapuri and Wadsa. */
const MAP_CENTER = { lat: 20.6161, lng: 79.9106 };
const MAP_HALF_X_KM = 8.5;
const MAP_HALF_Y_KM = MAP_HALF_X_KM * 10 / 16;

const LOCATION_KEY = "warpx_location";

// Real places, from OpenStreetMap, for picking a spot without GPS.
const LANDMARKS = [
  { name: "Brahmapuri town centre", area: "Brahmapuri", lat: 20.6084, lng: 79.8586 },
  { name: "MSRTC Bus Stand", area: "Brahmapuri", lat: 20.6153, lng: 79.8552 },
  { name: "Brahmapuri Railway Station", area: "Brahmapuri", lat: 20.6040, lng: 79.8683 },
  { name: "Kurza", area: "Brahmapuri", lat: 20.6282, lng: 79.8624 },
  { name: "Midway on the Wadsa road", area: "NH543", lat: 20.6180, lng: 79.9200 },
  { name: "Wadsa town centre", area: "Wadsa (Desaiganj)", lat: 20.6238, lng: 79.9626 },
  { name: "Wadsa station area", area: "Wadsa (Desaiganj)", lat: 20.6240, lng: 79.9631 },
];

function kmFromCenter(lat, lng) {
  return {
    x: (lng - MAP_CENTER.lng) * 111 * Math.cos((MAP_CENTER.lat * Math.PI) / 180),
    y: (lat - MAP_CENTER.lat) * 111,
  };
}

/* Convert a lat/lng into 0-100% coordinates on the mock map, and back. */
function latlngToPct(lat, lng) {
  const { x, y } = kmFromCenter(lat, lng);
  return { xPct: 50 + (x / MAP_HALF_X_KM) * 50, yPct: 50 - (y / MAP_HALF_Y_KM) * 50 };
}
function pctToLatLng(xPct, yPct) {
  const x = ((xPct - 50) / 50) * MAP_HALF_X_KM;
  const y = -((yPct - 50) / 50) * MAP_HALF_Y_KM;
  return {
    lat: MAP_CENTER.lat + y / 111,
    lng: MAP_CENTER.lng + x / (111 * Math.cos((MAP_CENTER.lat * Math.PI) / 180)),
  };
}

/* The delivery area drawn to scale in km: both town circles and the road
   band. The SVG's own units are km, so shapes stay true to the ground. */
function areaMapSvg() {
  const pt = (lat, lng) => { const k = kmFromCenter(lat, lng); return [k.x.toFixed(2), (-k.y).toFixed(2)]; };
  const road = ROAD.map(([la, ln]) => pt(la, ln).join(",")).join(" ");
  const towns = AREAS.map((a) => {
    const [cx, cy] = pt(a.lat, a.lng);
    return `<circle cx="${cx}" cy="${cy}" r="${a.radiusKm}" fill="rgba(124,58,237,.18)" stroke="rgba(167,139,250,.7)" stroke-width=".08"/>
      <text x="${cx}" y="${(cy - a.radiusKm - 0.3).toFixed(2)}" text-anchor="middle" font-size=".75" fill="currentColor">${a.name}</text>`;
  }).join("");
  return `<svg viewBox="${-MAP_HALF_X_KM} ${-MAP_HALF_Y_KM} ${MAP_HALF_X_KM * 2} ${MAP_HALF_Y_KM * 2}" preserveAspectRatio="none" style="opacity:1;pointer-events:none;color:var(--ink-soft);">
    <polyline points="${road}" fill="none" stroke="rgba(124,58,237,.14)" stroke-width="${ROAD_WIDTH_KM * 2}" stroke-linecap="round" stroke-linejoin="round"/>
    <polyline points="${road}" fill="none" stroke="rgba(167,139,250,.6)" stroke-width=".08" stroke-dasharray=".3 .2"/>
    ${towns}
  </svg>`;
}

/* A short label for where a spot falls: "Wadsa · 35-50 min · +₹32 delivery". */
function areaLabel(lat, lng) {
  const c = coverageFor(lat, lng);
  if (!c.served) return "Outside our delivery area";
  const extra = distanceFeeFor(c.distanceKm);
  return `${c.areaName} · ${c.etaMin} min${extra ? ` · +₹${extra} delivery` : ""}`;
}

function saveLocation(loc) {
  const zoneInfo = classifyZone(loc.lat, loc.lng);
  const full = { ...loc, ...zoneInfo };
  localStorage.setItem(LOCATION_KEY, JSON.stringify(full));
  return full;
}

function getSavedLocation() {
  try { return JSON.parse(localStorage.getItem(LOCATION_KEY)); }
  catch (e) { return null; }
}

/* One-tap precise capture — the browser/OS handles the actual coordinates,
   the person never sees or types a number. */
function requestPreciseLocation(onSuccess, onError) {
  if (!navigator.geolocation) {
    onError("Geolocation isn't supported on this device.");
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      onSuccess({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: Math.round(pos.coords.accuracy),
        method: "gps",
      });
    },
    (err) => {
      const messages = {
        1: "Location permission was denied.",
        2: "Position unavailable — try again near a window or outdoors.",
        3: "That took too long. You can drop a pin manually instead.",
      };
      onError(messages[err.code] || "Couldn't fetch your location.");
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
  );
}
