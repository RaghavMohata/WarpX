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

  initScrollReveal();
});

// Fade/slide content in as it scrolls into view. Runs once at page load, so
// it only ever touches static page structure — content injected later
// (cart drawer, order lists, driver lists) is unaffected and just renders
// normally, which is the right call since scroll-reveal on a list that's
// still loading would look like a glitch, not a feature.
function initScrollReveal() {
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  if (!("IntersectionObserver" in window)) return;

  const targets = document.querySelectorAll(".card, .service-card, .section-head, .menu-cat, .hero-stat");
  if (!targets.length) return;

  const staggerCount = new Map();
  targets.forEach((el) => {
    const parent = el.parentElement;
    const idx = staggerCount.get(parent) || 0;
    staggerCount.set(parent, idx + 1);
    el.classList.add("reveal");
    el.style.transitionDelay = Math.min(idx, 5) * 70 + "ms";
  });

  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("reveal-in");
          io.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.1, rootMargin: "0px 0px -30px 0px" }
  );
  targets.forEach((el) => io.observe(el));
}
