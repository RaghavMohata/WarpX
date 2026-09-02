/* Server-side mirror of the zone logic in js/location.js.
   Kept as the source of truth once a request hits the backend — the
   browser-side copy is only for instant UI feedback before checkout. */
const DARK_STORE = { lat: 23.2599, lng: 77.4126, name: "WarpX Dark Store — MG Road" };
const ZONE_CORE_KM = 2.19;

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function classifyZone(lat, lng) {
  const distanceKm = haversineKm(lat, lng, DARK_STORE.lat, DARK_STORE.lng);
  if (distanceKm <= ZONE_CORE_KM) return { distanceKm, zone: "core", etaMin: "10-15" };
  return { distanceKm, zone: "extended", etaMin: "15-25" };
}

module.exports = { DARK_STORE, ZONE_CORE_KM, haversineKm, classifyZone };
