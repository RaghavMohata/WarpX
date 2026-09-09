/* WarpX install prompt + service-worker registration.

   Chromium fires beforeinstallprompt and lets us trigger the real install
   sheet. iOS Safari does neither, so there the same button opens short
   instructions instead — otherwise iPhone users, who are half the point of
   an installable app, get nothing at all. */

(function () {
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // A failed registration must never break the page it's on.
      });
    });
  }

  const DISMISS_KEY = "warpx_install_dismissed";
  let deferredPrompt = null;

  const isStandalone = () =>
    window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;

  const isIos = () =>
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    // iPadOS 13+ reports itself as a Mac; the touch points give it away.
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

  function dismissed() {
    try { return localStorage.getItem(DISMISS_KEY) === "1"; } catch (e) { return false; }
  }

  function showButton() {
    const host = document.querySelector(".nav-actions");
    if (!host || document.getElementById("installBtn")) return;
    const btn = document.createElement("button");
    btn.id = "installBtn";
    btn.className = "icon-btn install-btn";
    btn.type = "button";
    btn.title = "Install WarpX";
    btn.setAttribute("aria-label", "Install WarpX");
    btn.textContent = "📲";
    btn.addEventListener("click", onInstallClick);
    host.insertBefore(btn, host.firstChild);
  }

  async function onInstallClick() {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      deferredPrompt = null;
      if (outcome === "accepted") document.getElementById("installBtn")?.remove();
      return;
    }
    showIosHelp();
  }

  function showIosHelp() {
    if (document.getElementById("installSheet")) return;
    const wrap = document.createElement("div");
    wrap.id = "installSheet";
    wrap.className = "install-sheet";
    wrap.innerHTML = `
      <div class="install-card">
        <img src="/img/icon-192.png" alt="" width="56" height="56" class="install-icon">
        <h3>Add WarpX to your home screen</h3>
        <p class="text-muted">It opens like an app — full screen, one tap, no browser bar.</p>
        <ol class="install-steps">
          <li>Tap the <b>Share</b> button <span class="ios-share">⬆️</span> at the bottom of Safari</li>
          <li>Scroll down and choose <b>Add to Home Screen</b></li>
          <li>Tap <b>Add</b></li>
        </ol>
        <button type="button" class="btn btn-primary btn-block" id="installClose">Got it</button>
        <button type="button" class="btn btn-ghost btn-block" id="installNever">Don't show this again</button>
      </div>`;
    document.body.appendChild(wrap);
    const close = () => wrap.remove();
    wrap.addEventListener("click", (e) => { if (e.target === wrap) close(); });
    wrap.querySelector("#installClose").addEventListener("click", close);
    wrap.querySelector("#installNever").addEventListener("click", () => {
      try { localStorage.setItem(DISMISS_KEY, "1"); } catch (e) {}
      document.getElementById("installBtn")?.remove();
      close();
    });
  }

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // suppress the browser's own bar; we place our own button
    deferredPrompt = e;
    if (!dismissed()) showButton();
  });

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    document.getElementById("installBtn")?.remove();
  });

  // iOS never fires beforeinstallprompt, so offer the button on its own terms.
  document.addEventListener("DOMContentLoaded", () => {
    if (isStandalone() || dismissed()) return;
    if (isIos()) showButton();
  });
})();
