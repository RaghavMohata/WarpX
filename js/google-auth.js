/* WarpX "Sign in with Google" widget.

   Renders Google's own button into any [data-google-signin] container and,
   where appropriate, shows the One Tap prompt. The page supplies callbacks for
   the two outcomes: signed straight in, or needs a phone number first.

   Everything here is presentation. The ID token this produces means nothing
   until the server has verified it — see lib/google.js. */

const GOOGLE_ONETAP_DISMISSED = "warpx_onetap_dismissed";
// One Tap floats over the page uninvited. That's fine while someone is
// browsing and not fine while they're paying, so checkout is excluded.
const ONETAP_EXCLUDED_PAGES = ["checkout.html"];

let googleConfig = null;

async function loadGoogleConfig() {
  if (googleConfig) return googleConfig;
  try {
    const res = await fetch("/api/auth/google/config");
    if (!res.ok) return (googleConfig = { enabled: false });
    googleConfig = await res.json();
  } catch (e) {
    // No backend, or offline: behave as though Google sign-in doesn't exist.
    googleConfig = { enabled: false };
  }
  return googleConfig;
}

function loadGoogleScript() {
  return new Promise((resolve, reject) => {
    if (window.google && window.google.accounts) return resolve();
    const existing = document.getElementById("gsiScript");
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", reject);
      return;
    }
    const s = document.createElement("script");
    s.id = "gsiScript";
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Google's sign-in script couldn't load."));
    document.head.appendChild(s);
  });
}

function oneTapAllowed() {
  const page = location.pathname.split("/").pop() || "index.html";
  if (ONETAP_EXCLUDED_PAGES.includes(page)) return false;
  try { return localStorage.getItem(GOOGLE_ONETAP_DISMISSED) !== "1"; }
  catch (e) { return true; }
}

/* mode      — "customer" (login.html) or "driver" (driver.html)
   onResult  — called with the parsed server response
   onError   — called with a message worth showing someone
   oneTap    — offer the floating prompt as well as the button */
async function initGoogleSignIn({ mode = "customer", onResult, onError, oneTap = false } = {}) {
  const containers = document.querySelectorAll("[data-google-signin]");
  if (!containers.length) return;

  const config = await loadGoogleConfig();
  if (!config.enabled) {
    // Not configured: leave no trace rather than a button that can't work.
    containers.forEach((el) => { el.style.display = "none"; });
    return;
  }

  try {
    await loadGoogleScript();
  } catch (e) {
    containers.forEach((el) => { el.style.display = "none"; });
    return;
  }

  const endpoint = mode === "driver" ? "/api/auth/google/driver" : "/api/auth/google";

  window.google.accounts.id.initialize({
    client_id: config.clientId,
    callback: async (response) => {
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ credential: response.credential }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "That sign-in didn't work. Please try again.");
        onResult && onResult(data);
      } catch (err) {
        onError ? onError(err.message) : console.error(err);
      }
    },
  });

  containers.forEach((el) => {
    el.innerHTML = "";
    window.google.accounts.id.renderButton(el, {
      theme: "outline", size: "large", shape: "pill",
      text: mode === "driver" ? "signin_with" : "continue_with",
      logo_alignment: "center",
      width: Math.min(el.offsetWidth || 320, 400),
    });
  });

  if (oneTap && oneTapAllowed()) {
    window.google.accounts.id.prompt((notification) => {
      // Remember a deliberate dismissal so it isn't shown on every page.
      if (notification.isDismissedMoment && notification.isDismissedMoment()) {
        try { localStorage.setItem(GOOGLE_ONETAP_DISMISSED, "1"); } catch (e) {}
      }
    });
  }
}
