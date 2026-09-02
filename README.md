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
| `orders.html` | Order history for the logged-in user, read live from the database |

Cart-building state lives in `localStorage` (`js/cart.js`) so items survive page navigation before checkout. Once you log in or place an order, that data is also written to `warpx.db` via the API in `server.js` — `localStorage` is now just a client-side cache (and the offline fallback), not the source of truth.

## Backend / API

`server.js` exposes a small JSON API, all backed by `db.js` (schema + the SQLite connection):

| Endpoint | What it does |
|---|---|
| `POST /api/users` | Create or fetch a user by phone number (demo auth — no real OTP check) |
| `POST /api/users/:id/location` | Save a captured location; computes and returns the delivery zone/ETA server-side via `lib/zone.js` |
| `GET /api/users/:id/location` | Fetch a user's most recent saved location |
| `POST /api/orders` | Place an order — computes totals server-side, persists the order + line items |
| `GET /api/orders/:userId` | Order history for a user, items included |

`lib/zone.js` is a server-side port of the Haversine/zone logic in `js/location.js` — the browser copy is for instant map feedback before you submit; the server copy is what actually gets stored, so it's the source of truth.

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
- OTP login is still a demo (any digits "work") and prescription upload isn't stored server-side — see `medicine.html`'s note about that.
- Google Fonts (Space Grotesk, Inter) load from a CDN with system-font fallbacks if offline.
- Going beyond a laptop demo — real hosting, a managed Postgres instead of a single SQLite file, a real payment gateway — is a bigger step than this README covers; ask if/when you want to take it there.
