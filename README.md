# WarpX

**Anything you need, delivered at warp speed.**

WarpX is a hyperlocal quick-commerce pickup & drop service built for small towns — food, grocery, medicine, laundry, and anything else, all with a single flat delivery fee.

## Running locally, with the real database

WarpX now has a small backend: an Express server backed by SQLite, using Node's **built-in** `node:sqlite` module — no database to install, no account to sign up for, no native modules to compile. Just:

```bash
npm install     # installs Express (the only dependency)
npm start       # runs server.js — serves the site AND the API
# then open http://localhost:3000
```

### One-click start

Instead of the commands above, you can just double-click a launcher for your OS — it installs dependencies on first run, starts the server, and opens the site in your browser automatically:

- **Windows**: `start.bat`
- **Mac**: `start.command` (first time only, Finder may warn it's from an "unidentified developer" — right-click → Open once to approve it)
- **Linux**: `start.sh` (your file manager may need "Allow executing file as program" checked in its Properties first, or run `./start.sh` from a terminal)

Whichever you use, closing that window/terminal (or pressing Ctrl+C in it) stops the server.

Requires **Node.js 22.5+** (for `node:sqlite`). Check with `node -v`; if you're on an older Node, upgrade first — the built-in SQLite module won't be there otherwise. You'll see an "experimental feature" warning in the console when it starts — that's expected, SQLite support is still marked experimental in Node itself, but it's stable enough for local use here.

A `warpx.db` file appears in the project folder on first run — that's your entire database, a single file. Delete it any time to start fresh; it's `.gitignore`d, so it never gets committed. Users, saved locations, and every placed order are persisted there and survive restarts — check `orders.html` after placing an order to see it read back from the database.

**Without the backend running** (e.g. opening the files with a plain static server, or as `file://`), the site still works as a front-end-only demo: login and checkout fall back to `localStorage`-only simulation and say so in the UI. To run it that way instead:

```bash
python3 -m http.server 8080
# then open http://localhost:8080
```

## Pages

| Page | Purpose |
|---|---|
| `index.html` | Landing page — about WarpX, stats, and buttons into every service |
| `food.html` | Picasso Cafe's full menu (extracted from the supplied menu PDF), categorized with add-to-cart |
| `grocery.html` | Category-based grocery ordering with quick-add chips + free-text custom items |
| `medicine.html` | Medicine request form with an **optional** prescription upload |
| `laundry.html` | Laundry service selection with quantities + pickup scheduling |
| `anything.html` | The core "just write it" freeform request page (delivery *or* pickup-and-drop between two places) |
| `login.html` | Login/signup + the smart location capture flow (see below) |
| `checkout.html` | Order summary, delivery address confirmation, and payment method — see below |
| `orders.html` | Order history for the logged-in user, read live from the database |
| `careers.html` | **Work With Us** — delivery driver registration, see below |
| `admin.html` | **Owner dashboard** — see below |

Cart-building state lives in `localStorage` (`js/cart.js`) so items survive page navigation before checkout. Once you log in or place an order, that data is also written to `warpx.db` via the API in `server.js` — `localStorage` is now just a client-side cache (and the offline fallback), not the source of truth.

## Backend / API

`server.js` exposes a small JSON API, all backed by `db.js` (schema + the SQLite connection):

| Endpoint | What it does |
|---|---|
| Netlify Identity | Create and authenticate accounts with email confirmation and managed sessions |
| `POST /api/users/:id/location` | Save a captured location; computes and returns the delivery zone/ETA server-side via `lib/zone.js` |
| `GET /api/users/:id/location` | Fetch a user's most recent saved location |
| `POST /api/orders` | Place an order — **requires a valid, logged-in `userId`** (rejects with 401 otherwise); computes totals server-side, persists the order + line items + payment method |
| `GET /api/orders/:userId` | Order history for a single user, items included |
| `GET /api/orders` | **All** orders across every customer, newest first — powers `admin.html` |
| `PATCH /api/orders/:id/status` | Update an order's status (`placed` → `preparing` → `out for delivery` → `delivered`) |
| `POST /api/drivers` | Submit a delivery-driver application (public, no login required) |
| `GET /api/drivers` | All driver applications, newest first — powers the admin dashboard's Drivers tab |
| `PATCH /api/drivers/:id/status` | Approve/reject an application (`pending` / `approved` / `rejected`) |

`lib/zone.js` is a server-side port of the Haversine/zone logic in `js/location.js` — the browser copy is for instant map feedback before you submit; the server copy is what actually gets stored, so it's the source of truth.

## Login / sign-up

`login.html` uses Netlify Identity for email-and-password authentication. New accounts receive a confirmation email unless autoconfirm is enabled in the site's Identity settings. The page handles confirmation links, establishes the managed Identity session, and keeps a small display-only user cache in `localStorage` for the existing static navigation and checkout UI.

## Checkout — login required, address confirm, payment method

Browsing and building a cart never requires an account — that stays open, like most quick-commerce apps. **Checking out does.** Clicking "Proceed to checkout" in the cart drawer:

1. Not logged in → sent to `login.html?redirect=checkout.html` (with a toast explaining why, and the login page's heading changes to "Log in to complete your order"). After logging in or signing up, you land back on `checkout.html` automatically — the `?redirect=` param is generic, so anywhere that needs someone logged in first can reuse it.
2. Logged in → straight to `checkout.html`, which shows:
   - **Your order** — items, subtotal, the flat ₹20 delivery fee, total.
   - **Delivery address** — your saved location's landmark note and zone/ETA, with a **Change** link back into `login.html`'s location picker (the one with the map/GPS/landmarks — not duplicated here).
   - **Payment method** — Cash on Delivery, or UPI (an optional UPI ID field, purely informational — see the caveat below).
3. **Place order** posts to `POST /api/orders`, which itself independently re-checks that `userId` is a real, logged-in account — checking out isn't just hidden by the UI, a direct API call with no `userId` is rejected with a 401 regardless of what the front-end does. I verified this directly (a raw `fetch` to the endpoint with no `userId` returns `{"error":"Please log in to place an order."}`, status 401).

`checkout.html` also guards itself on load — visiting it directly without being logged in shows a "Log in to check out" prompt instead of the order form, so there's no way to reach it by skipping the cart drawer either.

**UPI is a demo selection, not a real payment integration.** Choosing it just records "UPI" (and whatever VPA you typed, if any) on the order — nothing is charged, no payment gateway is contacted, same "Cash on Delivery only" honesty this project has had throughout. A real UPI flow needs a payment aggregator account (Razorpay, PhonePe for Business, Google Pay's API, etc.) — a bigger step than this project takes on; ask if/when you want to wire one in for real.

## How you find out an order was placed

`orders.html` only shows a *customer's own* history — it's not for you. **`admin.html`** is the owner's view: it polls `GET /api/orders` every 5 seconds, plays a beep and pops a toast the moment a new order appears, and shows full customer contact info (name/phone) plus items so you can act on it. Click through the status buttons on each order (`placed → preparing → out for delivery → delivered`) as you work it.

To use it: open `admin.html`, enter the PIN (**`1234`** by default), and just leave that tab open on a phone, tablet, or spare monitor at the counter — that's genuinely how small businesses run these on Swiggy/Zomato-style tablets.

**What it does now, beyond the basics:**
- **Sound that actually plays.** Earlier, `beep()` created a brand-new `AudioContext` inside the polling loop — browsers silently block audio that isn't triggered by a real user click, so the very first beeps were liable to never be heard. It now creates one `AudioContext` at the PIN-unlock click (a genuine user gesture) and reuses it, which is what makes the beep reliable.
- **Desktop notifications.** The same unlock click also asks for OS-level notification permission (the browser `Notification` API). If you switch away from the tab, a new order pops a real desktop notification, not just an in-tab toast — click it to jump back. Toggle it anytime with the "Enable alerts" button.
- **Per-service filters.** An "Orders" view with All/Food/Grocery/Medicine/Laundry/Anything tabs, so if you only run the medicine counter you can filter to just that — useful once one dashboard needs to be shared across different people handling different services.
- **Escalation highlighting.** Any order still sitting at `placed` (never even acknowledged) for more than 10 minutes gets a red pulsing outline and an "Unacknowledged N min" tag, so a busy counter can't lose track of something going stale.
- **A Drivers tab**, next to Orders, to review delivery-driver applications (see below) — with a badge showing how many are pending.

**Honest long-term problems this still doesn't solve** (real infrastructure, not a code tweak):
- **This is polling, not push.** The dashboard checks every 5 seconds while the tab is open — close the tab, or the browser/OS kills the tab in the background, and nothing reaches you at all. A real solution is a push channel that works with the tab closed: SMS (Twilio or similar), a mobile push notification (Firebase Cloud Messaging/APNs) to a proper phone app, or at minimum a Service Worker with the Push API so browser notifications survive a closed tab. All of these need a backend service and (for SMS) an ongoing per-message cost — a genuinely bigger step than this project takes on.
- **Single shared PIN, no accounts.** `ADMIN_PIN` is one hardcoded value in the page's own JavaScript — anyone who reads page source sees it, there's no audit trail of *who* changed an order's status, and there's no way to give one staff member access to only, say, the medicine queue without them also seeing food orders (the per-service filter is a client-side view, not an access boundary). Real multi-retailer support needs actual retailer accounts with server-side authorization, the same password-hashing pattern already used for customers.
- **Single point of failure.** If nobody is watching the one open dashboard tab — it crashed, the device is asleep, the wifi dropped — orders simply pile up unacknowledged with no fallback channel. A real deployment would want at least a second notification path (SMS/email) that doesn't depend on a browser tab staying open and connected.
- **No delivery-partner dispatch.** Approving a driver application (see below) doesn't yet connect that driver to specific orders — there's no assignment, no "driver en route" status, no driver-facing app. That's the natural next layer once there's more than one delivery partner to coordinate.

None of these need guesswork to fix — they need real accounts, a real push/SMS provider, and (eventually) a driver-facing app — each a genuine infrastructure decision rather than something to fake locally. Happy to build any of them next; they're called out here instead of quietly pretended-away.

## Delivery drivers — "Work With Us"

`careers.html` is a public registration page for people who want to deliver for WarpX — linked from the footer of every page and from a recruitment banner on the homepage. It asks for a name, phone number, vehicle type (bicycle/scooter/motorbike/car), the area they know well (optional), availability (full-time/part-time/weekends), and any notes — then posts to `POST /api/drivers`. No login required to apply; this is a lead-capture form, not a driver account system.

Applications land in the **Drivers** tab of `admin.html`, filterable by status (pending/approved/rejected/all), with a badge showing how many are waiting on a decision. Approving or rejecting just updates a status column for now — see the "No delivery-partner dispatch" caveat above for what a real next step looks like.

## Delivery model

- Flat **₹20** delivery fee on every order, every service.
- Service area quoted as **15–21.92 km²**. Treated as a circle (`area = πr²`), that's a delivery radius of **~2.19 km (core zone)** to **~2.64 km (extended zone)** from the dark store — used by the login page's zone check (`js/location.js`).
- `DARK_STORE` coordinates in `js/location.js` are a placeholder — replace with your real store location before going live.

## Solving the "precise location" problem

The brief asked for something like coordinate input for delivery targeting, but without asking ordinary users to read or type latitude/longitude. The approach used here (`login.html` + `js/location.js`):

1. **One-tap GPS capture** — `requestPreciseLocation()` calls the browser's Geolocation API (`navigator.geolocation.getCurrentPosition`, high accuracy). The user sees a button and an accuracy badge, never a number.
2. **Visual confirmation, not text entry** — the captured point is shown as a pin on a lightweight mock map (no map-tile API/key needed) with the store location and the two delivery-radius rings drawn to scale. The user can drag the pin, or tap anywhere on the map, to nudge it — coordinates update silently underneath.
3. **A no-GPS fallback** — "Pick my area instead" lists known local landmarks; picking one sets an approximate location without needing GPS permission at all.
4. **A free-text landmark/address field** stays available throughout, purely as human-readable delivery instructions layered on top of the coordinate — it is never the thing used for the zone/distance calculation.
5. **Immediate feedback** — as soon as a location is set (by any of the three methods), `classifyZone()` runs the Haversine distance from the dark store and shows the core-zone or extended-zone ETA. There's no "outside our service area" rejection — every location is served, just with a longer estimate the farther out it is.

This keeps the precision (real coordinates, an accurate radius check) while keeping the interaction to "tap a button" or "tap a map" for the vast majority of users.

## Extracted menu data

`js/menu-data.js` holds the full Picasso Cafe menu extracted from the supplied PDF (Cold Brews, Mocktails, Munchies, Shakes, Speciality Coffees, Others), including taglines/notes and the one MOQ-2 item.

## Notes

- Checkout is **Cash on Delivery only** — no payment gateway is wired up. There's no real order fulfillment or delivery dispatch either; placing an order just persists it.
- Login now checks a real hashed password (see "Login / sign-up" above) — the OTP step is gone. Prescription upload still isn't stored server-side — see `medicine.html`'s note about that.
- Google Fonts (Space Grotesk, Inter) load from a CDN with system-font fallbacks if offline.
- Every page ships a tiny inline SVG favicon (a ⚡, no extra file) — purely cosmetic, but it removes the browser's automatic `favicon.ico` 404 from the console on every page load.
- Going beyond a laptop demo — real hosting, a managed Postgres instead of a single SQLite file, a real payment gateway — is a bigger step than this README covers; ask if/when you want to take it there.
