/* WarpX saved addresses — the address book shared by checkout and My Orders.

   Talks to /api/users/:id/addresses and /api/addresses/:id, and renders the
   cards both pages use, so the two never drift into looking like different
   features. */

const ADDR_SELECTED_KEY = "warpx_selected_address";

/* Labels are free text, but the common ones get a recognisable icon so the
   list is scannable without reading. */
const ADDR_ICONS = [
  [/home|ghar|house/i, "🏠"],
  [/shop|store|dukan|stall|market/i, "🏪"],
  [/work|office|desk/i, "🏢"],
  [/mom|mum|dad|papa|mama|parent|nani|dadi/i, "👪"],
  [/hostel|pg|college|school/i, "🎓"],
];
const ADDR_QUICK_LABELS = ["Home", "Shop", "Work", "Mom's"];

function addressIcon(label) {
  const match = ADDR_ICONS.find(([re]) => re.test(label || ""));
  return match ? match[1] : "📍";
}

function escAddr(str) {
  const d = document.createElement("div");
  d.textContent = str == null ? "" : String(str);
  return d.innerHTML;
}

function addressZoneLine(a) {
  const zoneLabel = a.zone === "core" ? "Prime warp zone" : "Extended zone";
  return `⚡ ${zoneLabel} · ${escAddr(a.eta_min)} min`;
}

/* ---- API ---------------------------------------------------------------- */

async function fetchAddresses(userId) {
  try {
    const res = await fetch(`/api/users/${userId}/addresses`);
    if (!res.ok) return [];
    return await res.json();
  } catch (e) {
    return []; // no backend — checkout falls back to the plain location flow
  }
}

async function createAddress(userId, payload) {
  const res = await fetch(`/api/users/${userId}/addresses`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Could not save that address.");
  return data;
}

async function updateAddress(id, payload) {
  const res = await fetch(`/api/addresses/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Could not update that address.");
  return data;
}

async function deleteAddress(id, userId) {
  const res = await fetch(`/api/addresses/${id}?userId=${userId}`, { method: "DELETE" });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Could not delete that address.");
  return data;
}

/* ---- Which one is picked ------------------------------------------------ */

function getSelectedAddressId() {
  const raw = localStorage.getItem(ADDR_SELECTED_KEY);
  return raw ? Number(raw) : null;
}

function setSelectedAddressId(id) {
  if (id == null) localStorage.removeItem(ADDR_SELECTED_KEY);
  else localStorage.setItem(ADDR_SELECTED_KEY, String(id));
}

/* Resolve the address to deliver to: whatever was picked last, as long as it
   still exists, otherwise the server's default, otherwise the first one. A
   stale id from a deleted address must never silently win. */
function resolveSelectedAddress(list) {
  if (!list.length) return null;
  const pickedId = getSelectedAddressId();
  return (
    list.find((a) => a.id === pickedId) ||
    list.find((a) => a.is_default === 1) ||
    list[0]
  );
}

/* ---- Rendering ---------------------------------------------------------- */

/* mode "pick" gives each row a radio and makes the whole card clickable;
   mode "manage" drops the radio and offers "Make default" instead. */
function addressCardHtml(a, { mode = "pick", selectedId = null } = {}) {
  const picked = mode === "pick" && a.id === selectedId;
  return `
    <div class="addr-card${picked ? " addr-card-picked" : ""}" data-addr-id="${a.id}"
         ${mode === "pick" ? `onclick="pickAddress(${a.id})" role="button" tabindex="0"` : ""}>
      ${mode === "pick" ? `<span class="addr-radio${picked ? " on" : ""}" aria-hidden="true"></span>` : ""}
      <div class="addr-body">
        <div class="addr-title">
          <span class="addr-icon">${addressIcon(a.label)}</span>
          <b>${escAddr(a.label)}</b>
          ${a.is_default === 1 ? `<span class="addr-tag">Default</span>` : ""}
        </div>
        <p class="addr-line">${escAddr(a.address) || "<span class='text-muted'>No landmark added</span>"}</p>
        <p class="addr-meta">${addressZoneLine(a)}</p>
      </div>
      <div class="addr-actions">
        ${mode === "manage" && a.is_default !== 1
          ? `<button type="button" class="btn btn-ghost btn-sm" onclick="event.stopPropagation();makeAddressDefault(${a.id})">Make default</button>`
          : ""}
        <button type="button" class="addr-icon-btn" title="Edit" onclick="event.stopPropagation();editAddress(${a.id})">✏️</button>
        <button type="button" class="addr-icon-btn" title="Delete" onclick="event.stopPropagation();removeAddress(${a.id})">🗑️</button>
      </div>
    </div>`;
}

function quickLabelChipsHtml(targetInputId) {
  return ADDR_QUICK_LABELS.map(
    (l) =>
      `<button type="button" class="chip chip-btn" onclick="document.getElementById('${targetInputId}').value='${l}'">${addressIcon(l)} ${l}</button>`
  ).join("");
}
