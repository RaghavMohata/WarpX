/* WarpX cart — shared across every service page via localStorage. */
const WARPX_DELIVERY_FEE = 20;
const CART_KEY = "warpx_cart";

function getCart() {
  try { return JSON.parse(localStorage.getItem(CART_KEY)) || []; }
  catch (e) { return []; }
}

function saveCart(cart) {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
  renderCartDrawer();
  updateCartBadge();
}

function addToCart(item) {
  const cart = getCart();
  const existing = cart.find(
    (c) => c.service === item.service && c.name === item.name && c.note === (item.note || "")
  );
  if (existing && item.price != null) {
    existing.qty += item.qty || 1;
  } else {
    cart.push({
      id: "l" + Date.now() + Math.floor(Math.random() * 1000),
      service: item.service,
      name: item.name,
      price: item.price ?? null,
      qty: item.qty || 1,
      note: item.note || "",
    });
  }
  saveCart(cart);
  showToast(`Added "${item.name}" to your order ⚡`);
  openDrawer();
}

function removeFromCart(id) {
  saveCart(getCart().filter((c) => c.id !== id));
}

function changeQty(id, delta) {
  const cart = getCart();
  const line = cart.find((c) => c.id === id);
  if (!line) return;
  line.qty += delta;
  if (line.qty <= 0) return removeFromCart(id);
  saveCart(cart);
}

function cartCount() {
  return getCart().reduce((n, c) => n + c.qty, 0);
}

function cartSubtotal() {
  return getCart().reduce((sum, c) => sum + (c.price || 0) * c.qty, 0);
}

function clearCart() {
  saveCart([]);
}

const SERVICE_META = {
  food: { label: "Picasso Cafe", color: "var(--food)" },
  grocery: { label: "Grocery", color: "var(--grocery)" },
  medicine: { label: "Medicine", color: "var(--medicine)" },
  laundry: { label: "Laundry", color: "var(--laundry)" },
  anything: { label: "Custom request", color: "var(--anything)" },
};

function updateCartBadge() {
  document.querySelectorAll("[data-cart-count]").forEach((el) => {
    const n = cartCount();
    el.textContent = n;
    el.style.display = n > 0 ? "flex" : "none";
  });
}

function renderCartDrawer() {
  const body = document.getElementById("drawerBody");
  const foot = document.getElementById("drawerFoot");
  if (!body || !foot) return;
  const cart = getCart();

  if (cart.length === 0) {
    body.innerHTML = `<div class="cart-empty"><div style="font-size:2rem;margin-bottom:10px;">🛒</div>Your order is empty.<br>Add something from any service page.</div>`;
    foot.innerHTML = "";
    return;
  }

  body.innerHTML = cart
    .map((c) => {
      const meta = SERVICE_META[c.service] || { label: c.service };
      const priceLine = c.price != null ? `₹${c.price} × ${c.qty} = ₹${c.price * c.qty}` : "Price to be confirmed";
      return `
      <div class="cart-line">
        <div class="cart-line-info">
          <b>${escapeHtml(c.name)}</b>
          <small style="color:${meta.color}">${meta.label}${c.note ? " · " + escapeHtml(c.note) : ""}</small>
          <small>${priceLine}</small>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:8px;">
          <button class="cart-line-remove" onclick="removeFromCart('${c.id}')" aria-label="Remove">✕</button>
          <div class="stepper">
            <button onclick="changeQty('${c.id}',-1)">−</button>
            <span>${c.qty}</span>
            <button onclick="changeQty('${c.id}',1)">+</button>
          </div>
        </div>
      </div>`;
    })
    .join("");

  const subtotal = cartSubtotal();
  const hasCustom = cart.some((c) => c.price == null);
  foot.innerHTML = `
    <div class="row-between" style="margin-bottom:8px;">
      <span class="text-muted">Subtotal</span>
      <span>${subtotal > 0 ? "₹" + subtotal : "—"}${hasCustom ? " + custom items" : ""}</span>
    </div>
    <div class="row-between" style="margin-bottom:8px;">
      <span class="text-muted">Delivery fee <small>(flat, town-wide)</small></span>
      <span>₹${WARPX_DELIVERY_FEE}</span>
    </div>
    <div class="row-between" style="font-weight:700;font-size:1.05rem;margin-bottom:16px;">
      <span>Total</span>
      <span>${subtotal > 0 ? "₹" + (subtotal + WARPX_DELIVERY_FEE) : "₹" + WARPX_DELIVERY_FEE + " + custom items"}</span>
    </div>
    <button class="btn btn-primary btn-block" onclick="placeOrder()">Place order at warp speed 🚀</button>
  `;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function openDrawer() {
  document.getElementById("cartOverlay")?.classList.add("open");
  document.getElementById("cartDrawer")?.classList.add("open");
}
function closeDrawer() {
  document.getElementById("cartOverlay")?.classList.remove("open");
  document.getElementById("cartDrawer")?.classList.remove("open");
}

let toastTimer;
function showToast(msg) {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2400);
}

function getWarpxUser() {
  try { return JSON.parse(localStorage.getItem("warpx_user")); }
  catch (e) { return null; }
}

function showOrderModal(orderNumber, eta, persisted) {
  const modalBody = document.getElementById("modalBody");
  if (modalBody) {
    modalBody.innerHTML = `
      <div class="modal-icon">✅</div>
      <h3>Order placed!</h3>
      <p class="text-muted">Order <b>#${orderNumber}</b> is being prepped. At warp speed, expect it in about <b>${eta}</b>.</p>
      <p class="text-muted" style="font-size:.85rem;">Cash on delivery. ${persisted ? "Saved to your order history." : "This is a local demo checkout — Firebase wasn't reachable, so nothing was saved to the database."}</p>
      ${persisted ? `<a href="orders.html" class="btn btn-ghost btn-block" style="margin-bottom:10px;">View order history</a>` : ""}
      <button class="btn btn-primary btn-block" onclick="closeModal()">Done</button>
    `;
  }
  document.getElementById("orderModal")?.classList.add("open");
}

async function placeOrder() {
  const cart = getCart();
  if (cart.length === 0) return;
  const user = getWarpxUser();
  const loc = getSavedLocation ? getSavedLocation() : null;

  try {
    if (!window.WarpXDB) throw new Error("Firebase isn't configured (js/firebase-config.js still has placeholder values)");
    const order = await window.WarpXDB.placeOrder(user?.id, cart);
    showOrderModal(order.orderNumber, `${order.etaMin} min`, true);
  } catch (err) {
    console.error(err);
    // Firebase not set up yet, or unreachable — keep the demo usable with a local-only order.
    const orderNumber = "WPX" + Math.floor(100000 + Math.random() * 900000);
    const eta = loc && loc.etaMin ? `${loc.etaMin} min` : "20-30 min";
    showOrderModal(orderNumber, eta, false);
  }

  clearCart();
  closeDrawer();
}

function closeModal() {
  document.getElementById("orderModal")?.classList.remove("open");
}

document.addEventListener("DOMContentLoaded", () => {
  renderCartDrawer();
  updateCartBadge();
});
