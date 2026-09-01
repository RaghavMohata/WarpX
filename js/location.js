/* WarpX location + delivery-zone logic.
   Demo dark-store coordinates — swap for your real store location. */
const DARK_STORE = { lat: 23.2599, lng: 77.4126, name: "WarpX Dark Store — MG Road" };

/* Service area is quoted as "15 km² to 21.92 km²". Treating that as a circle
   (area = πr²) gives radius ≈ 2.19 km (core) to ≈ 2.64 km (outer edge). */
const ZONE_CORE_KM = 2.19;
const ZONE_EXT_KM = 2.64;
const MAP_HALF_SPAN_KM = 3.3; // mock-map view window, a bit wider than the service zone

const LOCATION_KEY = "warpx_location";

const LANDMARKS = [
  { name: "Main Bus Stand", area: "Old Town", dxKm: -1.1, dyKm: 0.6 },
  { name: "Railway Station Road", area: "Station Side", dxKm: 1.4, dyKm: -0.4 },
  { name: "Old Market Chowk", area: "Central Bazaar", dxKm: 0.2, dyKm: 0.3 },
  { name: "Civil Hospital Area", area: "Sector 4", dxKm: -0.6, dyKm: -1.3 },
  { name: "Green Valley College Road", area: "North End", dxKm: 0.8, dyKm: 1.8 },
  { name: "New Colony", area: "East End", dxKm: 2.1, dyKm: 0.9 },
  { name: "Industrial Estate Gate", area: "South End", dxKm: -0.3, dyKm: -2.2 },
  { name: "Lakeview Road", area: "West End", dxKm: -2.0, dyKm: 0.2 },
];

function kmToLatDeg(km) {
  return km / 111;
}
function kmToLngDeg(km, atLat) {
  return km / (111 * Math.cos((atLat * Math.PI) / 180));
}

function offsetFromStore(dxKm, dyKm) {
  // dx = east(+)/west(-), dy = north(+)/south(-)
  return {
    lat: DARK_STORE.lat + kmToLatDeg(dyKm),
    lng: DARK_STORE.lng + kmToLngDeg(dxKm, DARK_STORE.lat),
  };
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/* Convert a lat/lng into 0-100% coordinates on the mock map, and back. */
function latlngToPct(lat, lng) {
  const dxKm = (lng - DARK_STORE.lng) * 111 * Math.cos((DARK_STORE.lat * Math.PI) / 180);
  const dyKm = (lat - DARK_STORE.lat) * 111;
  return {
    xPct: 50 + (dxKm / MAP_HALF_SPAN_KM) * 50,
    yPct: 50 - (dyKm / MAP_HALF_SPAN_KM) * 50,
  };
}
function pctToLatLng(xPct, yPct) {
  const dxKm = ((xPct - 50) / 50) * MAP_HALF_SPAN_KM;
  const dyKm = -((yPct - 50) / 50) * MAP_HALF_SPAN_KM;
  const o = offsetFromStore(dxKm, dyKm);
  return o;
}

function classifyZone(lat, lng) {
  const distanceKm = haversineKm(lat, lng, DARK_STORE.lat, DARK_STORE.lng);
  if (distanceKm <= ZONE_CORE_KM) return { distanceKm, zone: "core", etaMin: "10-15" };
  if (distanceKm <= ZONE_EXT_KM) return { distanceKm, zone: "extended", etaMin: "15-25" };
  return { distanceKm, zone: "out", etaMin: null };
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
