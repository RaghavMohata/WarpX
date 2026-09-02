/* WarpX shared chrome: mobile nav, cart drawer/modal/toast injection, active link. */

document.addEventListener("DOMContentLoaded", () => {
  // Mobile nav toggle
  const toggle = document.getElementById("navToggle");
  const links = document.getElementById("navLinks");
  if (toggle && links) {
    toggle.addEventListener("click", () => links.classList.toggle("open"));
  }

  // Highlight current page in nav
  const path = location.pathname.split("/").pop() || "index.html";
  document.querySelectorAll(".nav-links a").forEach((a) => {
    const href = a.getAttribute("href");
    if (href === path || (path === "" && href === "index.html")) a.classList.add("active");
  });

  // Reflect a logged-in user in the nav's login button — once logged in,
  // this button is "my profile" (order history), not "log in again".
  try {
    const user = JSON.parse(localStorage.getItem("warpx_user"));
    if (user && user.phone) {
      document.querySelectorAll('a.btn[href="login.html"]').forEach((btn) => {
        btn.textContent = user.name ? `👤 ${user.name.split(" ")[0]}` : "👤 My profile";
        btn.setAttribute("href", "orders.html");
      });
    }
  } catch (e) {}

  // Inject cart drawer + overlay + modal + toast once per page
  if (!document.getElementById("cartDrawer")) {
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="overlay" id="cartOverlay" onclick="closeDrawer()"></div>
      <aside class="drawer" id="cartDrawer">
        <div class="drawer-head">
          <h3 style="margin:0;">Your order</h3>
          <button class="icon-btn" onclick="closeDrawer()" aria-label="Close cart">✕</button>
        </div>
        <div class="drawer-body" id="drawerBody"></div>
        <div class="drawer-foot" id="drawerFoot"></div>
      </aside>
      <div class="modal" id="orderModal">
        <div class="modal-card" id="modalBody"></div>
      </div>
      <div class="toast" id="toast"></div>
    `;
    document.body.appendChild(wrap);
    renderCartDrawer();
    updateCartBadge();
  }

  document.querySelectorAll("[data-open-cart]").forEach((btn) =>
    btn.addEventListener("click", openDrawer)
  );
});
