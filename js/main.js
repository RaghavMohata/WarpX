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
  initHeroBlobs();
  initCountUp();
  initTiltCards();
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

// Injects soft floating gradient blobs into every hero banner (.hero on the
// homepage, .page-hero on every inner page) and drifts them slightly on
// scroll — no per-page HTML needed, so every page gets it automatically.
function initHeroBlobs() {
  const heroes = document.querySelectorAll(".hero, .page-hero");
  if (!heroes.length) return;
  const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Big hero (homepage) has room for large blobs; the shorter page-hero
  // banners on inner pages would just clip them, so they get a smaller set.
  const bigConfigs = [
    { size: 320, top: "-50px", right: "-40px", color: "rgba(198,241,53,.6)", speed: 0.12 },
    { size: 260, bottom: "-60px", left: "6%", color: "rgba(255,255,255,.4)", speed: 0.2 },
    { size: 200, top: "20%", left: "58%", color: "rgba(255,255,255,.32)", speed: 0.3 },
  ];
  const smallConfigs = [
    { size: 190, top: "-45px", right: "-30px", color: "rgba(198,241,53,.6)", speed: 0.12 },
    { size: 150, bottom: "-55px", left: "12%", color: "rgba(255,255,255,.4)", speed: 0.2 },
  ];

  const parallaxLayers = [];
  heroes.forEach((hero) => {
    const configs = hero.classList.contains("hero") ? bigConfigs : smallConfigs;
    configs.forEach((cfg, i) => {
      const layer = document.createElement("div");
      layer.className = "hero-blob-layer";
      if (cfg.top) layer.style.top = cfg.top;
      if (cfg.right) layer.style.right = cfg.right;
      if (cfg.bottom) layer.style.bottom = cfg.bottom;
      if (cfg.left) layer.style.left = cfg.left;

      const blob = document.createElement("div");
      blob.className = "hero-blob";
      blob.style.width = cfg.size + "px";
      blob.style.height = cfg.size + "px";
      blob.style.background = `radial-gradient(circle, ${cfg.color}, transparent 70%)`;
      blob.style.animationDelay = -i * 4 + "s";

      layer.appendChild(blob);
      hero.insertBefore(layer, hero.firstChild);
      if (!reduceMotion) parallaxLayers.push({ el: layer, speed: cfg.speed });
    });
  });

  if (reduceMotion || !parallaxLayers.length) return;
  let ticking = false;
  function updateParallax() {
    const y = window.scrollY;
    parallaxLayers.forEach(({ el, speed }) => {
      el.style.transform = `translateY(${y * speed}px)`;
    });
    ticking = false;
  }
  window.addEventListener(
    "scroll",
    () => {
      if (!ticking) {
        requestAnimationFrame(updateParallax);
        ticking = true;
      }
    },
    { passive: true }
  );
}

// Animates a number counting up from 0 once it scrolls into view. Add
// data-countup="20" (the target number) to any element, plus optional
// data-prefix, data-suffix, and data-decimals — the element's own text
// content is the no-JS/reduced-motion fallback, already correctly formatted.
function initCountUp() {
  const targets = document.querySelectorAll("[data-countup]");
  if (!targets.length) return;
  const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function animate(el) {
    const end = parseFloat(el.dataset.countup);
    if (isNaN(end)) return;
    const decimals = parseInt(el.dataset.decimals || "0", 10);
    const prefix = el.dataset.prefix || "";
    const suffix = el.dataset.suffix || "";
    if (reduceMotion) return; // leave the static, pre-written text alone

    const duration = 1100;
    const start = performance.now();
    function tick(now) {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      el.textContent = prefix + (end * eased).toFixed(decimals) + suffix;
      if (t < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  if (!("IntersectionObserver" in window)) return; // static text already shown
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          animate(entry.target);
          io.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.4 }
  );
  targets.forEach((el) => io.observe(el));
}

// Tilts a service tile toward the cursor (a subtle 3D effect), snapping
// back smoothly on mouse-leave. Skipped on touch devices (no real hover)
// and when the visitor has asked their OS for reduced motion.
function initTiltCards() {
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  if (window.matchMedia && window.matchMedia("(hover: none)").matches) return;

  document.querySelectorAll(".service-card").forEach((card) => {
    card.addEventListener("mouseenter", () => {
      card.style.transition = "transform .1s ease-out";
    });
    card.addEventListener("mousemove", (e) => {
      const rect = card.getBoundingClientRect();
      const px = (e.clientX - rect.left) / rect.width;
      const py = (e.clientY - rect.top) / rect.height;
      const rotateX = (0.5 - py) * 14;
      const rotateY = (px - 0.5) * 14;
      card.style.transform = `perspective(800px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-6px) scale(1.02)`;
    });
    card.addEventListener("mouseleave", () => {
      card.style.transition = "transform .5s cubic-bezier(.16,.84,.44,1)";
      card.style.transform = "";
    });
  });
}
