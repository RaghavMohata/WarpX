# WarpX

**Anything you need, delivered at warp speed.**

WarpX is a hyperlocal quick-commerce pickup & drop service built for small towns — food, grocery, medicine, laundry, and anything else, all with a single flat delivery fee.

## Running locally, with a real database (Firebase)

WarpX's database is **Firebase Firestore**, talked to directly from the browser — there's no server of your own to run at all. That also means the exact same files work locally and once actually deployed (Firebase Hosting, GitHub Pages, Netlify, anywhere) — nothing about the database changes between the two.

### 1. Create a Firebase project (one-time, in your browser)

This part only you can do — it needs your own Google account:

1. Go to [console.firebase.google.com](https://console.firebase.google.com) → **Add project** → give it any name (e.g. `warpx`) → you can skip Google Analytics.
2. In the left sidebar: **Build → Firestore Database → Create database**. Pick any region close to you, and start in **test mode** (you'll tighten the rules in step 3).
3. Still in the console: **Firestore Database → Rules**, and replace the contents with:
   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /users/{userId} {
         allow read, write: if true;
       }
       match /orders/{orderId} {
         allow read, write: if true;
       }
     }
   }
   ```
   This is intentionally wide open — there's no real login (the OTP is a demo) to check `request.auth` against yet, so there's nothing more restrictive to gate on. Firebase's own default "test mode" rules expire after 30 days; this replaces them with the same openness on purpose, so it doesn't quietly stop working. Don't launch this to real users without adding [Firebase Authentication](https://firebase.google.com/docs/auth) and rules scoped to it first.
4. **Project settings** (gear icon, top left) → scroll to **Your apps** → click the **`</>`** (Web) icon → register an app (any nickname) → it shows you a `firebaseConfig` object. Copy it.

### 2. Drop your config into the project

Open `js/firebase-config.js` and replace the placeholder values with the ones from step 1.4:

```js
export const firebaseConfig = {
  apiKey: "...",
  authDomain: "...",
  projectId: "...",
  storageBucket: "...",
  messagingSenderId: "...",
  appId: "...",
};
```

These values are safe to have in client-side code — they identify your project, not a secret credential; the security rules from step 1.3 are what actually control access.

### 3. Run it

No build step, no `npm install` needed for the site itself — just serve the folder:

```bash
python3 -m http.server 8080
# then open http://localhost:8080
```

(any static server works — `npx serve .`, VS Code's Live Server, etc.)

**If you skip steps 1–2** (config still has placeholder values), the site still works as a front-end-only demo: login and checkout notice Firebase isn't configured, fall back to `localStorage`-only simulation, and say so in the UI rather than breaking.

### Going live

Since there's no server, hosting is just "put the static files somewhere" — Firebase Hosting is the natural pick since you already have the project:

```bash
npm install -g firebase-tools
firebase login          # opens a browser to sign into your Google account
firebase init hosting    # pick your project, public directory = "." , configure as single-page app = No
firebase deploy
```

That gives you a real `https://<your-project>.web.app` URL. GitHub Pages, Netlify, or Vercel work exactly as well — it's plain static files either way.

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

Cart-building state lives in `localStorage` (`js/cart.js`) so items survive page navigation before checkout. Once you log in or place an order, that data is also written to Firestore via `js/firebase-db.js` — `localStorage` is now just a client-side cache (and the offline fallback), not the source of truth.

## Database access layer

`js/firebase-db.js` is loaded as an ES module (`<script type="module">`, on every page) and attaches its functions to `window.WarpXDB` so the rest of the code — plain classic `<script>` files like `js/cart.js`, and inline page scripts — can call them without becoming modules themselves.

| Function | What it does |
|---|---|
| `WarpXDB.upsertUser(name, phone)` | Create or fetch a user document by phone number (demo auth — no real OTP check; phone is the document id) |
| `WarpXDB.saveUserLocation(userId, loc)` | Persist a captured location (lat/lng, zone, ETA — already computed client-side by `classifyZone()` in `js/location.js`) |
| `WarpXDB.getUserLocation(userId)` | Fetch a user's most recently saved location |
| `WarpXDB.placeOrder(userId, items)` | Place an order (Cash on Delivery) — computes totals, stores the order with its items inline |
| `WarpXDB.getOrders(userId)` | Order history for a user, newest first |

Firestore layout: a top-level `users` collection (doc id = phone number) holding profile + latest `location`, and a top-level `orders` collection (auto ids) with each order's items embedded directly on the document — no separate line-items collection needed for this scale.

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
- OTP login is still a demo (any digits "work") and prescription upload isn't stored anywhere server-side — see `medicine.html`'s note about that.
- The Firestore security rules above are wide open on purpose (see step 1.3) — there's no real authentication yet to scope them to. Add Firebase Authentication before this goes anywhere near real users/orders.
- Google Fonts (Space Grotesk, Inter) and the Firebase SDK both load from CDNs, so an internet connection is required even for local use — there's no offline mode (Google Fonts falls back to system fonts if blocked; Firebase, being the database, can't).
