/* Language picker — English / Marathi / Hindi.
   ---------------------------------------------------------------------------
   Machine translation through Google's Website Translator widget rather than a
   hand-written dictionary. That was a deliberate trade: one script covers every
   page, including everything rendered by JavaScript, where a dictionary would
   mean several hundred strings kept in step by hand.

   What it costs, so the next person is not surprised:
     - Google closed this widget to new sites around 2019. It still serves, but
       it is unsupported. If it ever stops, the button hides itself (see
       `failed` below) and the site carries on in English — nothing else breaks.
     - It translates every text node it is not told to leave alone, which is
       why product names, money, order numbers, delivery codes and addresses
       carry translate="no" in their templates. Losing those marks is how a
       customer ends up reading a translated version of their own address.

   Loaded on the customer pages and the Driver Hub. admin.html is left out on
   purpose — that is the owner's own screen. */

(function () {
  const KEY = "warpx_lang";
  // translate.google.com is not the host to use: the documented endpoint is
  // translate.googleapis.com, and the older host is unreachable from some
  // networks.
  const SRC = "https://translate.googleapis.com/translate_a/element.js?cb=__warpxTranslateReady";
  const LANGS = [
    { code: "en", label: "English" },
    { code: "mr", label: "मराठी" },
    { code: "hi", label: "हिंदी" },
  ];

  const saved = () => { try { return localStorage.getItem(KEY) || "en"; } catch (e) { return "en"; } };
  const remember = (code) => { try { localStorage.setItem(KEY, code); } catch (e) {} };

  /* The widget reads its target language from this cookie on load. Written for
     the bare host as well as the dotted form, because it is inconsistent about
     which it looks for. */
  function setCookie(code) {
    const value = code === "en" ? "" : "/en/" + code;
    const bits = "googtrans=" + value + ";path=/";
    document.cookie = bits;
    if (location.hostname && location.hostname !== "localhost") {
      document.cookie = bits + ";domain=." + location.hostname;
    }
  }

  let loading = false;
  let ready = false;
  let failed = false;

  window.__warpxTranslateReady = function () {
    try {
      /* autoDisplay off: we never want Google's own "translate this page?"
         prompt, only the button in our nav. */
      new google.translate.TranslateElement(
        { pageLanguage: "en", includedLanguages: "mr,hi,en", autoDisplay: false },
        "warpxTranslateHost"
      );
      ready = true;
    } catch (e) {
      failed = true;
      hideButton();
    }
  };

  function loadWidget() {
    if (loading || failed) return;
    loading = true;
    const s = document.createElement("script");
    s.src = SRC;
    s.async = true;
    s.onerror = () => { failed = true; loading = false; hideButton(); };
    document.head.appendChild(s);
    // onerror does not fire for every blocked case, so time it out too.
    setTimeout(() => { if (!ready) { failed = true; hideButton(); } }, 8000);
  }

  function hideButton() {
    const b = document.getElementById("langBtn");
    if (b) b.style.display = "none";
    closeMenu();
  }

  /* Driving the widget's own hidden <select> applies the language in place,
     which keeps a half-filled checkout form intact. A reload would also work
     and is what most examples do, but it would throw that form away. */
  function applyViaSelect(code) {
    const sel = document.querySelector("select.goog-te-combo");
    if (!sel) return false;
    sel.value = code === "en" ? "" : code;
    sel.dispatchEvent(new Event("change"));
    return true;
  }

  function choose(code) {
    remember(code);
    setCookie(code);
    closeMenu();
    paintActive(code);

    if (code === "en") {
      // Leaving a translated page is the one case the select handles badly —
      // Google restores the original text only on a fresh load.
      location.reload();
      return;
    }
    if (ready && applyViaSelect(code)) return;
    loadWidget();
    // The select only exists once the widget has initialised; poll briefly.
    let tries = 0;
    const t = setInterval(() => {
      if (failed || ++tries > 40) return clearInterval(t);
      if (applyViaSelect(code)) clearInterval(t);
    }, 250);
  }

  function paintActive(code) {
    document.querySelectorAll("#langMenu button").forEach((b) => {
      b.classList.toggle("on", b.dataset.lang === code);
    });
    const cur = LANGS.find((l) => l.code === code);
    const lbl = document.getElementById("langBtnLabel");
    if (lbl && cur) lbl.textContent = code === "en" ? "EN" : cur.label;
  }

  function closeMenu() {
    const m = document.getElementById("langMenu");
    if (m) m.classList.remove("open");
  }

  function build() {
    const host = document.querySelector(".nav-actions");
    if (!host || document.getElementById("langBtn")) return;

    // The widget mounts into this; it is never shown.
    if (!document.getElementById("warpxTranslateHost")) {
      const h = document.createElement("div");
      h.id = "warpxTranslateHost";
      document.body.appendChild(h);
    }

    const wrap = document.createElement("div");
    wrap.className = "lang-wrap";
    wrap.setAttribute("translate", "no");
    wrap.innerHTML =
      '<button class="icon-btn lang-btn" id="langBtn" aria-label="Language" aria-haspopup="true">' +
        '<span id="langBtnLabel">EN</span>' +
      '</button>' +
      '<div class="lang-menu" id="langMenu" role="menu">' +
        LANGS.map((l) =>
          '<button type="button" role="menuitem" data-lang="' + l.code + '">' + l.label + '</button>'
        ).join("") +
      '</div>';
    host.insertBefore(wrap, host.firstChild);

    document.getElementById("langBtn").addEventListener("click", (e) => {
      e.stopPropagation();
      document.getElementById("langMenu").classList.toggle("open");
    });
    wrap.querySelectorAll("#langMenu button").forEach((b) => {
      b.addEventListener("click", () => choose(b.dataset.lang));
    });
    document.addEventListener("click", closeMenu);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMenu(); });

    const now = saved();
    paintActive(now);
    // A visitor who already chose a language gets it applied straight away;
    // everyone else never downloads the widget at all.
    if (now !== "en") loadWidget();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", build);
  } else {
    build();
  }
})();
