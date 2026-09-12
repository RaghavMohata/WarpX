# WarpX

**Anything you need, delivered at warp speed.**

WarpX is a hyperlocal quick-commerce pickup & drop service built for small towns — food, grocery, medicine, laundry, and anything else, with a delivery fee that scales down as the order grows.

## Running locally, with the real database

WarpX now has a small backend: an Express server backed by SQLite, using Node's **built-in** `node:sqlite` module — no database to install, no account to sign up for, no native modules to compile. Just:

```bash
npm install     # installs Express (the only dependency)
npm start       # runs server.js — serves the site AND the API
# then open http://localhost:3000
```

### One-click start

Instead of the commands above, you can just double-click a launcher for your OS — it installs dependencies on first run, starts the server, and opens **all three views in three browser tabs**:

| Tab | For | URL |
|---|---|---|
| Customer site | the people ordering | `http://localhost:3000/` |
| Owner dashboard | you, watching orders come in | `http://localhost:3000/admin.html` |
| Driver Hub | your delivery partners | `http://localhost:3000/driver.html` |

- **Windows**: `start.bat`
- **Mac**: `start.command` (first time only, Finder may warn it's from an "unidentified developer" — right-click → Open once to approve it)
- **Linux**: `start.sh` (your file manager may need "Allow executing file as program" checked in its Properties first, or run `./start.sh` from a terminal)

It's still **one server on one port** — those are three pages of the same app, not three separate things to run. On Mac and Linux the launcher waits until the server actually answers before opening the tabs, rather than guessing with a fixed delay and landing on a "can't connect" page when startup runs slow.

Whichever you use, closing that window/terminal (or pressing Ctrl+C in it) stops the server — and all three tabs with it.

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
| `food.html` | Picasso Cafe — collapsed by default, tap the card to expand the full menu (extracted from the supplied menu PDF), categorized with add-to-cart |
| `grocery.html` | Category-based grocery ordering with quick-add chips + free-text custom items |
| `medicine.html` | Medicine request form with an **optional** prescription upload |
| `laundry.html` | Laundry service selection with quantities + pickup scheduling |
| `anything.html` | The core "just write it" freeform request page (delivery *or* pickup-and-drop between two places) |
| `login.html` | Login/signup + the smart location capture flow (see below) |
| `checkout.html` | Order summary, delivery address confirmation, and payment method — see below |
| `orders.html` | Order history for the logged-in user, read live from the database |
| `careers.html` | **Work With Us** — delivery driver registration, see below |
| `driver.html` | **Driver Hub** — a driver's own dashboard: progress bar, available orders, active deliveries |
| `admin.html` | **Owner dashboard** — see below |

Cart-building state lives in `localStorage` (`js/cart.js`) so items survive page navigation before checkout. Once you log in or place an order, that data is also written to `warpx.db` via the API in `server.js` — `localStorage` is now just a client-side cache (and the offline fallback), not the source of truth.

## Backend / API

`server.js` exposes a small JSON API, all backed by `db.js` (schema + the SQLite connection):

| Endpoint | What it does |
|---|---|
| `POST /api/auth/signup` | Create an account — phone + password, hashed before it touches the database |
| `POST /api/auth/login` | Log into an existing account — verifies the password, never the other way around |
| `POST /api/users/:id/location` | Save a captured location; computes and returns the delivery zone/ETA server-side via `lib/zone.js` |
| `GET /api/users/:id/location` | Fetch a user's most recent saved location |
| `POST /api/orders` | Place an order — **requires a valid, logged-in `userId`** (rejects with 401 otherwise); computes totals server-side, persists the order + line items + payment method + a snapshot of the customer's current lat/lng/address |
| `GET /api/orders/:userId` | Order history for a single user, items included |
| `GET /api/orders` | **All** orders across every customer, newest first — powers `admin.html` |
| `PATCH /api/orders/:id/status` | Update an order's status (`placed` → `preparing` → `out for delivery` → `delivered`) |
| `POST /api/drivers` | Submit a delivery-driver application (public, no login required) |
| `GET /api/drivers` | All driver applications, newest first — powers the admin dashboard's Drivers tab |
| `PATCH /api/drivers/:id/status` | Approve/reject an application (`pending` / `approved` / `rejected`) |
| `POST /api/drivers/login` | Driver sign-in by phone — only approved drivers get in (pending/rejected get told why) |
| `GET /api/drivers/:id/summary` | One driver's progress tier plus the orders they're currently carrying |
| `GET /api/orders/available` | Orders no driver has claimed yet — the Driver Hub's job board |
| `PATCH /api/orders/:id/claim` | A driver claims an unassigned order (rejects if someone else got there first) |
| `PATCH /api/orders/:id/deliver` | A driver completes their own order — requires the customer's 4-digit delivery code, and is what advances the progress bar |

`lib/zone.js` is a server-side port of the Haversine/zone logic in `js/location.js` — the browser copy is for instant map feedback before you submit; the server copy is what actually gets stored, so it's the source of truth.

## Login / sign-up

Real password authentication, not a demo OTP: `login.html` has a password field (with a show/hide toggle) and, when signing up, a confirm-password field. Passwords are never stored or transmitted in the clear — `lib/auth.js` hashes each one with Node's built-in `crypto.scryptSync` and a random per-user salt, and login compares hashes with a timing-safe check (`crypto.timingSafeEqual`) rather than a plain `===`.

A few things this still doesn't do, on purpose (kept in scope for a local demo):
- No session tokens/cookies — after a successful login the browser just holds `{id, name, phone}` in `localStorage`, the same as before. Anyone with access to that browser's storage can "act as" that logged-in user; there's no way to remotely revoke a session.
- No rate-limiting on login attempts, no account lockout, no password reset flow.
- If the server is unreachable at all (network error), it falls back to a local-only session so the demo keeps working — but a wrong password or a duplicate sign-up is always a hard rejection with no fallback, exactly because that's the point of adding a password.

## Checkout — login required, address confirm, payment method

Browsing and building a cart never requires an account — that stays open, like most quick-commerce apps. **Checking out does.** Clicking "Proceed to checkout" in the cart drawer:

1. Not logged in → sent to `login.html?redirect=checkout.html` (with a toast explaining why, and the login page's heading changes to "Log in to complete your order"). After logging in or signing up, you land back on `checkout.html` automatically — the `?redirect=` param is generic, so anywhere that needs someone logged in first can reuse it.
2. Logged in → straight to `checkout.html`, which shows:
   - **Your order** — items, subtotal, the delivery fee for that basket size (with a nudge showing how much more would unlock the next slab), total.
   - **Delivery address** — your saved location's landmark note and zone/ETA, with a **Change** button that expands inline (no redirect to `login.html` — that was a dead end for anyone already logged in who just needed to fix a typo or refresh their GPS fix). Inline you get two independent things: a "Use my current location" button that re-captures GPS and recomputes the zone/ETA live, and a plain text field for the landmark/house-number note. Editing just the text keeps whatever coordinates you already had; tapping the GPS button replaces them. Both get saved immediately (locally and to the server) — the next order you place uses whatever's current at that moment.
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
- **Dispatch is pull, not push.** Drivers now have their own hub (see below) where they claim orders off a shared board and mark them delivered, so orders do get assigned to a named driver. What's still missing is *push*: nobody is notified when a new order appears (the board just polls every 10 seconds), no order is auto-assigned to the nearest driver, and there's no live tracking of where a driver is mid-delivery. Those need the same push infrastructure as the notification gap above.

None of these need guesswork to fix — they need real accounts, a real push/SMS provider, and (eventually) a driver-facing app — each a genuine infrastructure decision rather than something to fake locally. Happy to build any of them next; they're called out here instead of quietly pretended-away.

## Getting precise coordinates for a placed order

Every order card in `admin.html` now has a **"📍 Navigate to customer"** button, plus the raw coordinates printed next to it as text. Clicking it opens Google Maps with turn-by-turn directions straight to that customer's exact location (`https://www.google.com/maps/dir/?api=1&destination=lat,lng`) — on a phone this opens the Google Maps app directly if it's installed. This needs **no Google Maps API key, no billing account, no setup** — it's a plain URL format Google Maps supports for free, so it works immediately with what's already built.

Where the coordinates actually come from: `login.html`'s location step (GPS tap, dragged pin, or landmark pick — see below) captures a precise lat/lng and saves it to the `locations` table. Previously that was only ever used to *compute* the zone/ETA shown at login — it was never attached to the order itself, so there was no way to look up a specific order's exact location afterward. Placing an order now takes a **snapshot** of the customer's most recent lat/lng/address directly onto that order row, so it stays accurate for that order even if the customer's saved location changes later (e.g. they move house and update it before their next order).

If an order shows "⚠ No location on file" instead of the navigate button, it means that customer placed the order without ever completing the location step (shouldn't normally happen given the login flow, but could if their account predates this feature, or the request was a raw API call without a location saved first).

## Delivery drivers — "Work With Us"

`careers.html` is a public registration page for people who want to deliver for WarpX — linked from the footer of every page and from a recruitment banner on the homepage. It asks for a name, phone number, vehicle type (bicycle/scooter/motorbike/car), the area they know well (optional), availability (full-time/part-time/weekends), and any notes — then posts to `POST /api/drivers`. No login required to apply; this is a lead-capture form, not a driver account system.

Applications land in the **Drivers** tab of `admin.html`, filterable by status (pending/approved/rejected/all), with a badge showing how many are waiting on a decision.

## The Driver Hub (`driver.html`)

Once you approve someone in the admin dashboard, they can sign in at `driver.html` with the phone number they applied with, and get their own dashboard — separate from the customer site and from your owner dashboard.

**The progress bar is a daily target.** It counts deliveries completed since local midnight and resets every night — that reset is what makes a 25-delivery ladder mean anything. As a lifetime count it would be climbed once and then sit at the top forever, incentivising nothing. A live countdown on the card shows how long the current day's rate has left, and the driver's lifetime total is still shown beside it so nothing feels erased.

Five tiers, filling toward a **50% goal**:

| Tier | Rate | Unlocked at |
| --- | --- | --- |
| 1 | 5% | from the start |
| 2 | 15% | 3 deliveries |
| 3 | 25% | 8 deliveries |
| 4 | 35% | 15 deliveries |
| 5 | 45% | 25 deliveries |

The ladder is **front-loaded on purpose**. The steps widen — 3, 5, 7, 10 — so a new rider gets promoted on their first shift instead of grinding ten jobs before anything visibly changes, while the top tier still takes real work. Percentages stay odd and the goal stays 50%, both as originally specified.

It lives in `lib/tier.js` as a **plain table of thresholds, not arithmetic**. The previous version derived every tier from four interlocking constants (start, step, orders-per-tier, max), which forced every tier to cost the same and made retuning a puzzle — the reason it sat at "10 deliveries per step" long after that pace stopped making sense. A table is readable at a glance, retuned by editing one number, and can express uneven steps at all. Want a flat five deliveries per tier instead? Change the `from` values to 0/5/10/15/20 and nothing else moves.

Tick marks label each tier **with the jobs that unlock it** ("15% · 3 jobs"), so the ladder explains itself on the bar rather than living only in the owner's head, and light up in lime as they're passed.

Two different numbers drive that bar, which matters:

- `percent` is the **tier** — the headline number, which only moves on promotion.
- `barPercent` is the **fill**, and it advances with *every single delivery*, interpolating between one tier mark and the next. It lands exactly on 15/25/35/45 at deliveries 3/8/15/25.

Using the tier for the fill made the bar look frozen between promotions, which read as broken. Because early tiers are short, each delivery moves the bar a lot at the start (a first delivery is worth ~3.3 points) and less later on — the movement shrinks as the promotions get bigger. The header also shows progress within the current tier ("Tier 2 of 5 · 2/5 toward the next"). Both numbers come from `lib/tier.js` and are computed server-side, so neither can be fudged from the browser.

### How a driver actually gets paid

Two numbers decide it, both in `lib/tier.js`:

```
BASE_PAY_PER_DELIVERY = ₹15     flat, every delivery, whatever the tier
tier percentage                  share of the delivery fees collected today
```

So a day's pay is `(deliveries × ₹15) + (tier% × the day's delivery fees)`.

**The tier reached by the end of the day pays for the whole day** — not just the deliveries made after the promotion. That single rule is what makes the bar worth watching: the delivery that triggers a promotion retroactively lifts every job already done that day, so it can be worth several times a normal one. The Driver Hub quotes this live ("Your next delivery is worth about ₹43.50 — it lifts today's whole rate to 25%"), and `payIfOneMore()` is what computes it.

| Tier | Reach it at | Your % | Per delivery* |
| --- | --- | --- | --- |
| 1 | from the start | 5% | ₹16.50 |
| 2 | 3 deliveries | 15% | ₹19.50 |
| 3 | 8 deliveries | 25% | ₹22.50 |
| 4 | 15 deliveries | 35% | ₹25.50 |
| 5 | 25 deliveries | 45% | ₹28.50 |

\*On a ₹30 delivery fee. Because the fee itself scales ₹20–₹40 with basket size, a bigger customer order pays the driver more too — the two ladders pull in the same direction.

A full day at the top tier (25 deliveries, ₹30 average fee) comes to **₹712.50**. The **"How is this worked out?"** panel in the Driver Hub explains all of this to the driver in plain words, with the same table and their current tier highlighted.

> ⚠️ **`BASE_PAY_PER_DELIVERY` is a business input, not a technical one.** ₹15 is a placeholder chosen to make the tiers land on sensible per-delivery figures — check it against your real margins before paying anyone from it. It and the tier percentages are the only numbers involved, and both live in one file.

**Recording when a delivery happened.** A daily count needs a delivery date, and `status = 'delivered'` alone doesn't carry one, so orders now have `delivered_at`, stamped when the handover OTP is accepted. Timestamps are stored UTC and shifted with SQLite's `'localtime'` before the day comparison, so a delivery at 11pm counts toward that evening rather than the next morning. Orders delivered before this column existed fall back to `created_at` rather than disappearing from the count.

**Why it needed order-claiming.** A progress bar is only worth having if the number behind it is real, so orders now carry a `driver_id`:

- The **Available orders** board lists every order no driver has claimed yet (refreshing itself every 10 seconds).
- **Accept delivery** claims one. The `driver_id IS NULL` guard is inside the `UPDATE` itself, so if two drivers tap Accept at the same moment, the second one changes 0 rows and gets told "another driver just took that one" — rather than both of them thinking it's theirs.
- **Complete delivery** is what advances the bar. It only works on orders assigned to *that* driver, and requires the customer's delivery code (below).
- Each job card shows what to collect (COD amount vs. already-settled UPI), the landmark note, and a **Navigate** button using the order's saved coordinates.

The owner's dashboard now also shows which driver is carrying each order, or "no driver yet".

## Delivery codes (handover OTP)

"Delivered" used to mean nothing more than the driver tapping a button. Now every order gets a **4-digit delivery code** at checkout that only the customer sees, and the driver has to type it in to complete the delivery — so a completed order is the customer's confirmation that the handover actually happened, not the driver's word for it.

- The code is generated server-side with `crypto.randomInt` when the order is placed, and shown to the customer twice: in the order-confirmation modal, and on their order card in `orders.html` (where it disappears once the order is delivered).
- The driver's job card has a 4-digit field. Wrong code → the delivery is refused and the order stays open, with the typed digits left on screen so a typo can be corrected rather than retyped.
- **The code never leaves the customer.** It's stripped from every response a driver or the owner dashboard can read (`/api/orders`, `/api/orders/available`, the claim response, and the driver summary) via a `withoutOtp()` helper — if a driver could read it, the code would prove nothing. The customer's own `/api/orders/:userId` is the only endpoint that returns it. There's a test that asserts the code appears nowhere in the driver page's HTML.
- Orders placed *before* delivery codes existed have no code stored, and stay completable without one rather than being stranded forever.
- **Escape hatch:** if a customer is unreachable or has lost their code, the owner can still force an order to `delivered` from the status buttons in `admin.html`. That's deliberate — but it does mean the admin PIN is the way around the code, which is one more reason to change it from the default.

**Honest caveat on driver sign-in:** drivers never set a password — they only ever filled in the careers form — so signing in with just a phone number *identifies* rather than *authenticates*. Anyone who knows an approved driver's number could open their hub. That's fine for a small town where you personally approved every driver, but it's the first thing to fix if this grows: give drivers a real password (the customer-side `lib/auth.js` hashing is already there to reuse).

## Delivery model

- Delivery is priced by order size, from **₹40** down to **₹20**:

| Order subtotal | Delivery fee |
| --- | --- |
| Under ₹100 | ₹40 |
| ₹100 – ₹199 | ₹35 |
| ₹200 – ₹399 | ₹30 |
| ₹400 and above | ₹20 |

  The ladder lives in **`lib/fee.js`**, which is both `require`d by `server.js` and served straight to the browser as `<script src="lib/fee.js">`. That's deliberate: the fee used to be a `20` hardcoded in two unrelated places (`js/cart.js` and `server.js`), which is exactly how a cart ends up quoting one price while the server charges another. One file, both sides, no drift.

  **The server always re-prices from its own subtotal.** The browser's figure is only ever a preview — `POST /api/orders` ignores any `deliveryFee` in the request body and calls `feeFor()` itself, so a hand-crafted request can't buy a ₹1 delivery. (There's a bigger, still-open version of this problem: the server currently trusts the *item prices* the browser sends. See "Known limitations".)

  The cart and checkout both show a nudge — *"Add ₹140 more and delivery drops to ₹20 · save ₹10"* — because the whole point of a slab ladder is to make the next slab feel worth reaching. Once you're on the cheapest rate it turns into a confirmation instead.

  **Unpriced custom items don't count toward the slab.** A "get me a phone charger" request has no price until you price it, so it contributes ₹0 to the subtotal and the order lands in the ₹40 band. The cart says so in plain words rather than quietly quoting a number that later changes.
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

## Design refresh: scroll animation, colors, buttons

- **Scroll-reveal animation** — `js/main.js` runs an `IntersectionObserver` (`initScrollReveal()`) once per page load that fades/slides in cards, service tiles, section headers, and menu categories as they enter the viewport, with a slight stagger between siblings. It only touches static page content present at load — anything injected later (cart items, order lists, driver applications) renders normally, since animating a list that's still loading would read as a glitch, not a feature. Respects `prefers-reduced-motion: reduce` (skips the animation entirely for anyone who's asked their OS for less motion).
- **Colour refresh** — the core `--grad-warp` brand gradient picked up an extra violet stop for more depth, plus new tinted-violet shadow tokens (`--shadow-violet`, `--shadow-violet-sm`) used on hover states instead of flat grey shadows, for a more "branded" glow. Per-service colors (food/grocery/medicine/laundry/anything) are unchanged — they're already distinct and consistently used across every page, so re-theming them risked more confusion than payoff.
- **Button & tile animation** — every `.btn` now lifts on hover and settles on click; `.btn-primary` additionally has an animated gradient sweep. Service tiles get a lift, a soft violet glow, and an icon pop on hover; menu items and "Add" buttons got matching micro-interactions.
- **Copy pass** — tightened the homepage's hero line and all five service-card descriptions for punchier, more consistent tone.
- **Floating hero blobs + parallax** — every hero banner (the homepage's tall `.hero`, and every inner page's shorter `.page-hero`) gets 2–3 soft blurred gradient blobs injected automatically by `initHeroBlobs()` — no per-page HTML needed. They drift slowly on their own (a looping CSS animation) and shift position at a slower rate than the page as you scroll (a JS-driven parallax effect), giving the hero a sense of depth instead of a flat gradient.
- **Count-up numbers** — the homepage's hero stats (₹20, service area, service count) count up from 0 the moment they scroll into view, instead of just appearing as static text. Add `data-countup="20"` (plus optional `data-prefix`/`data-suffix`/`data-decimals`) to any element to get this for free elsewhere — `initCountUp()` in `js/main.js` handles the rest, and falls back to the plain pre-written text if `prefers-reduced-motion` is set.
- **3D tilt on service tiles** — the five homepage service cards tilt toward the cursor as you move over them (a subtle `perspective`/`rotateX`/`rotateY` effect driven by `initTiltCards()`), snapping back smoothly on mouse-leave. Skipped on touch devices (no real hover to track) and under `prefers-reduced-motion`.

## Saved addresses (Home / Shop / Mom's)

Customers keep an address book instead of re-capturing GPS every order.

- **Where they live:** a separate `addresses` table, deliberately *not* the existing `locations` table. `locations` is an append-only log of every GPS fix ever taken; an address book needs a handful of stable rows people name, rename and delete. Mixing the two would have made "delete my old address" mean "delete a history record".
- **The label is the point.** Home, Shop, Work, Mom's — free text, capped at 24 characters, with quick-pick chips at the point of entry. Common names get a matching icon (🏠 🏪 🏢 👪) so the list is scannable without reading.
- **Exactly one default per user.** Setting a new one clears the old one inside a transaction, so there is never a moment with two defaults or none. Deleting the default promotes the next address rather than leaving the user with a book and nothing selected.
- **Zone and ETA are computed server-side** on save via `lib/zone.js`, and recomputed if the pin moves — an address dragged out of the core zone gets the longer ETA rather than keeping a stale one.
- **Orders record which place they went to.** `orders.address_label` is snapshotted at order time, so the owner dashboard and the Driver Hub show "**Home** · Blue gate, House 12" rather than coordinates alone. Renaming or deleting the address later doesn't rewrite past orders.

### How an order picks its destination

`POST /api/orders` resolves the delivery target in this order:

1. The `addressId` the customer picked at checkout — **only if that address belongs to them**. A request naming someone else's address id is ignored, not honoured.
2. Their default saved address.
3. Their last raw GPS capture, exactly as before this feature existed.

That last step is what keeps the change backwards-compatible: an existing customer who has never saved an address checks out precisely as they did before, and checkout says so ("This order will go here") instead of showing an empty picker.

| Endpoint | Purpose |
| --- | --- |
| `GET /api/users/:id/addresses` | List, default first |
| `POST /api/users/:id/addresses` | Save a new one; the first one becomes the default automatically |
| `PATCH /api/addresses/:id` | Rename, move the pin, or make it the default |
| `DELETE /api/addresses/:id` | Remove it, promoting a new default if needed |

Edit and delete are scoped with `WHERE id = ? AND user_id = ?`, so one customer cannot touch another's addresses. That said, `userId` still arrives from the client like everywhere else in this app — see "Known limitations".

## Scheduled orders

Every order is either **ASAP** (the default and the fast path) or booked for a slot. Checkout has a two-way toggle; picking "Schedule it" reveals native date and time inputs, pre-filled with the next slot that would actually be accepted, so the common case is one tap rather than a date-picker expedition.

**The rules live in `lib/schedule.js`**, loaded both ways like `lib/fee.js` — `require`d by `server.js` and served to the browser — so checkout refuses exactly the slots the server would refuse. Nobody picks a time only to be rejected after hitting Place order.

| Rule | Value |
| --- | --- |
| Service window | 08:00 – 22:00 |
| Minimum lead time | 30 minutes |
| Furthest ahead | 7 days |
| Reaches the driver board | 45 minutes before the slot |

The date input is bounded with `min`/`max` to the bookable window, so an impossible day can't even be offered — but the server validates independently anyway, against its own clock, because that's the clock dispatch actually runs on.

**Scheduled orders stay off the driver board until 45 minutes before their slot.** A 7pm delivery visible at 10am invites a driver to claim it and then sit on it, which looks like progress on the board while nothing is moving. The owner's dashboard is deliberately *not* filtered this way — advance notice is exactly what you need in order to prep, so `GET /api/orders` shows everything while `GET /api/orders/available` shows only what's due.

**On timezones:** slots are stored as plain local wall-clock strings (`2026-09-10 19:00`), not UTC. The shop, the drivers and the customers are all in one town in one timezone, so local time removes an entire class of conversion bugs at zero cost. A second town in another timezone would need this revisited — the parsing is deliberately explicit (never bare `new Date(str)`, which parses some formats as UTC and some as local depending on the engine) so the change would be contained to that one file.

The slot is shown wherever the order is: "booked in" on the confirmation instead of an ETA, "Scheduled for Tomorrow at 7:00 pm" in My Orders, and a 🗓️ tag on both the owner dashboard and the Driver Hub.

**Not built:** real service hours. The 08:00–22:00 window is a pair of constants in `lib/schedule.js`, not a configurable per-service schedule, and nothing stops an *ASAP* order at 3am — only scheduled ones are bounded. Proper open/closed handling is still on the list.

## Owner earnings (`admin.html` → 💰 Earnings)

The dashboard separates **what customers paid** from **what WarpX keeps**, because on a pickup-and-drop service those are very different numbers — most of an order's subtotal is the cafe's or the shop's money passing through.

```
WarpX revenue  =  delivery fees  +  food margin
Net kept       =  WarpX revenue  −  driver pay
```

- **Delivery fees** — the ₹20–₹40 charged per order, by basket size.
- **Food margin** — **₹15 per item** built into Picasso Cafe's listed prices (`FOOD_MARGIN_PER_ITEM` in `server.js`, which must stay in step with the prices in `js/menu-data.js`). Only priced cafe items count: a custom cafe request has no price yet, so it carries no margin, and grocery/medicine/laundry items carry none either.
- **Driver pay** — settled **per driver per day**, not from a single running total, because the tier a driver finishes a day on pays for that whole day. The earnings panel groups it exactly the way the Driver Hub does, so the two can never disagree.

Four periods: today, 7 days, 30 days, all time. The panel also explains its own arithmetic in plain words underneath, naming how much of the gross belongs to the cafe rather than to you.

## Installable app (PWA)

WarpX installs to a phone's home screen and opens full-screen, with no browser chrome and no app store — the biggest perceived-quality jump available for the effort.

- **`manifest.webmanifest`** — standalone display, brand theme colour, and three app shortcuts (long-press the icon for Food / My Orders / Driver Hub). Icons are 192, 512, and a separate **maskable** 512: Android crops non-maskable icons to the launcher's shape, so without that variant the logo loses its corners.
- **`sw.js`** — the service worker, which is what makes it installable and what makes it work without signal.
- **`js/pwa.js`** — registration plus the 📲 install button, which only appears when the app is genuinely installable, so it is never a dead control.
- **iOS** never fires `beforeinstallprompt` and cannot trigger an install sheet, so there the same button opens short **Share → Add to Home Screen** instructions instead. Half the point of an installable app is iPhone users; without this they would get nothing at all. "Don't show this again" is remembered.

### What the service worker will and won't cache

**Nothing under `/api/` is cached, or even intercepted.** This app's whole job is live state — an owner watching for new orders, a driver refreshing the available board, a customer reading a delivery code. A stale API response wouldn't be a slightly old page, it would be a missed order. API traffic goes straight to the network as though the worker didn't exist.

| Request | Strategy | Why |
| --- | --- | --- |
| `/api/*` | never touched | live data; staleness here loses orders |
| Page navigations | network first, cache as fallback | the owner pulls and restarts often — a cache-first shell would keep serving yesterday's HTML, which is exactly the "I pulled but nothing changed" trap |
| CSS / JS / icons | stale-while-revalidate | instant load, updates land on the next visit |
| Anything not cached, offline | `offline.html` | a WarpX page explaining what still works, not a browser error |

Only **successful** responses are cached. An earlier version stored whatever came back, which would have written a 404 or a 502 into the shell and then served that error page from cache long after it stopped being true.

The worker calls `skipWaiting()` and `clients.claim()` so a new version takes over immediately rather than waiting for every tab to close — again, because the normal workflow here is pull, restart, refresh.

**Bumping the cache:** change `VERSION` in `sw.js` when you want every client to discard its cached shell. Old caches are deleted on activate.

## Order tracking, opening hours, and payouts

Four features shipped earlier had visible holes — promises the code didn't yet keep. These close them.

### Prices are the server's business

`POST /api/orders` used to total up whatever `price` the request carried, so a hand-crafted request could buy a ₹184 cold brew for ₹1. It now **never reads `price` from the request at all**. Every cafe line is looked up by name in `js/menu-data.js` — the same file the customer's page renders from, now dual-exported so the server can `require()` it.

Only food is ever priced this way. Grocery, medicine, laundry and custom requests already sent `price: null` and are quoted at pickup, so nothing about them changes. An unrecognised cafe line (a renamed item, a "Custom cafe request") resolves to `null` rather than being trusted.

### Opening hours, 08:00–22:00

Scheduling was bounded from the start; **ASAP orders weren't**, so an order could land at 3am with a broken ETA before anyone saw it. `isOpenNow()` and `nextOpeningSlot()` in `lib/schedule.js` now bound both, from the same two constants.

**The server decides this, not the browser.** `GET /api/hours` is the authority — a customer in another timezone, or with a wrong device clock, would otherwise see a closed banner over an open shop or be told it's open when the server will refuse. A closed shop shows a site-wide banner, and checkout disables the ASAP option and pre-selects the next slot it can actually deliver in, rather than refusing and losing the order.

### Live order tracking

The status flow (`placed → preparing → out for delivery → delivered`) existed and worked, but `orders.html` fetched once and rendered a single static word — nobody ever saw the owner's updates. My Orders now shows a four-step tracker that polls every 15s, and **stops polling once every order is delivered** rather than running forever in a background tab.

Two supporting changes:

- **Drivers get a "Picked up" button.** Claiming an order is not the same as having collected it, so inferring *out for delivery* from the claim would tell a customer their food had left the cafe while the rider was still on the way to it. The owner keeps *preparing*, the driver owns *picked up*, and the OTP handover still sets *delivered*.
- `PATCH /api/orders/:id/status` **validates against the allowed list.** It previously accepted any string, so a typo could write nonsense into the column.

### Scheduled orders now shout

A 7pm delivery used to sit on the dashboard wearing a 🗓️ tag with nothing telling the owner to start it. The dashboard now pins a **Due soon** block above the order list and fires the existing chime + desktop notification once per order, at the same moment it becomes claimable by a driver (`DISPATCH_LEAD_MINUTES`, 45 min). Alerted ids are remembered, so a reload doesn't re-shout, and the first paint after unlocking stays silent rather than announcing history.

### Driver payout ledger

The earnings panel could say you owed ₹4,158 with no record of what you'd actually handed over. A new **💸 Payouts** tab groups every driver-day: deliveries, tier, base + bonus, and a Mark paid button, with running totals for outstanding vs settled.

- **Owed is never stored.** It's recomputed from delivered orders with the same `tierFor` + `payFor` grouping the Driver Hub uses, so the ledger and a driver's own screen cannot disagree. The `payouts` table records only *settlement*.
- `UNIQUE(driver_id, day)` means a day can't be paid twice, even if two clicks race.
- The amount written comes from the freshly computed row, never from the request — a payout can't be recorded for a figure that was never owed.
- Drivers see their own paid/pending list in the hub.

## Sign in with Google

A **Sign in with Google** button sits above the phone + password form on
`login.html` and on the Driver Hub, with Google's One Tap prompt offered on
ordinary pages. Passwords still work exactly as before — this is an extra door,
not a replacement.

### Setting it up (you have to do this once)

1. Google Cloud Console → **APIs & Services → Credentials → Create credentials →
   OAuth client ID → Web application**.
2. Under **Authorized JavaScript origins** add `http://localhost:3000`, and your real
   `https://` domain if you have one. Origins must match exactly — Google will not
   accept a bare LAN IP, so testing from a phone needs the same domain or tunnel the
   PWA already needs.
3. Paste the **Client ID** into `config.js`:

```js
GOOGLE_CLIENT_ID: "xxxx.apps.googleusercontent.com",
```

That's the only file to edit. The value is read in-process, so `npm start`,
`start.command`, `start.sh` and `start.bat` all pick it up with nothing extra typed.
An environment variable still wins if you set one, which is handy for pointing a
single run at a second Google project or another domain:

```bash
GOOGLE_CLIENT_ID="other-id.apps.googleusercontent.com" npm start
```

🔒 **Only the Client ID goes in `config.js`.** The Console also shows a **Client
Secret** — WarpX never uses it (the button verifies a signed ID token rather than
exchanging an authorization code), and it must not be committed, pasted into a chat,
or stored anywhere in this repo. If one is ever exposed, reset it in the Console:
**Credentials → your OAuth client → Reset secret**. A Client ID is different: Google
renders it into every page for every visitor, so it is public by design.

**With `config.js` left empty, the button never renders and every page behaves exactly
as it did before** — no dead control, no console errors. The same is true if Google's
script can't load (blocked network, offline): the container hides itself and the
phone + password form carries on.

### The token is verified server-side

The browser receives a signed ID token and posts it to `POST /api/auth/google`.
Nothing in it is believed until `lib/google.js` has checked the **signature against
Google's own keys**, the **audience** matches your client id, the **issuer** is
Google, it hasn't **expired**, and the **email is verified**. That is the entire
trust boundary, so verification is delegated to `google-auth-library` rather than
hand-rolled — key rotation and `kid` selection are exactly where a silent mistake
means anyone can log in as anyone. It is the only dependency here besides Express,
and it earns its place.

*(That library allows a documented 300-second clock-skew grace past expiry, which
protects people whose phone clock is a few minutes out. Both sides of that boundary
are pinned by tests so it can't surprise anyone later.)*

### Google gives an email; WarpX needs a doorstep

`users.phone` is `UNIQUE NOT NULL` and stays that way — SQLite can't drop a NOT NULL
constraint without rebuilding the table, and rebuilding a live table would be the
riskiest change in this feature. It's also unnecessary: you can't deliver to an email
address, so a first-time Google sign-in ends with *"What's your mobile number?"* and
the row is only created once that's in hand. Returning users are matched on
`google_sub` and skip the step entirely.

### Linking, and the takeover risk

If the phone entered already belongs to an account, signing that person in would hand
the account to **anyone who knows the number**. So:

| Phone entered | What happens |
| --- | --- |
| Not in use | A new Google-backed account is created |
| Belongs to a password account | That account's password is required, once, to link |
| Already linked to a different Google account | Refused |

The half-finished sign-in is held as a **short-lived server-side ticket keyed to the
verified `sub`** (`lib/google.js`), so the phone step can't be replayed with someone
else's email, and a spent ticket can't be reused.

### Drivers

Same button on the hub. Linking is by the phone they applied with — the same key the
phone-only sign-in already used — and only an **approved** application can link;
pending and rejected are refused as before.

⚠️ **Honest caveat:** linking by phone is first-come, so someone who knew a driver's
number could in principle claim it first. That is not worse than the current
sign-in, where the phone alone *is* the whole credential permanently, and every
sign-in after linking is properly authenticated. To keep it accountable the admin
**Drivers** tab shows each linked Google address with an **Unlink** button.

## HTTPS with a reverse proxy (no third-party tunnel)

Running WarpX on your own Mac with port forwarding gets you a real public URL, but
plain `http://` breaks two things: the PWA can't install (service workers refuse to
register outside `https://`/`localhost`) and Google Sign-In expects a secure origin.
**Caddy** solves both — one binary, no account, no config beyond your domain name,
and it gets and renews a free Let's Encrypt certificate on its own forever.

This assumes port forwarding is already working (see the tunnel section above).
The `Caddyfile` in this repo is already set up for **warpx.online** — if you're
using a different domain, edit it before starting.

0. **If GitHub Pages was ever enabled for this domain, turn it off first.**
   A domain's DNS can only point one place — GitHub Pages' servers, or your home's
   public IP — never both. In the repo's **Settings → Pages**, clear the custom
   domain field (or set the source to "None"), and make sure no `CNAME` file exists
   at the repo root. Skip this step if you never set up Pages for this domain.
1. **Point the domain's DNS at your home IP.** In Hostinger's DNS panel, the domain's
   **A record** must resolve to your current public IP (`curl ifconfig.me` on your
   Mac gets it) — not to GitHub Pages' IPs. This is also the record you'll need to
   update by hand whenever your home IP changes (see the tunnel section above).
2. **Forward two more ports on your router**, alongside the `3000` you already set up:
   `80` and `443`, both TCP, both pointed at your Mac's reserved local IP. Caddy needs
   `80` to prove domain ownership to Let's Encrypt and `443` to serve HTTPS.
3. **Install Caddy:**
   ```bash
   brew install caddy
   ```
4. **Run it as a background service**, so it starts on login and keeps running
   without you having to launch it each time:
   ```bash
   sudo brew services start caddy
   ```
   The first request to your domain takes a few extra seconds while Caddy fetches
   the certificate — that's normal, and it only happens once.
5. **Start WarpX as usual** — `npm start` or `start.command`. Nothing about how you
   run the Node app changes; Caddy sits in front of it on ports 80/443 and forwards
   everything to `localhost:3000`.
6. **Test from your phone on mobile data** (not home Wi-Fi): `https://warpx.online`
   should load with a padlock, no warnings.
7. **Add the new origin to Google Cloud Console** — Credentials → your OAuth client
   → Authorized JavaScript origins → add `https://warpx.online` (keep
   `http://localhost:3000` too, for local testing). Google Sign-In won't work on the
   new domain until this is added.

Express is told it's behind a proxy (`app.set("trust proxy", true)` in `server.js`)
so `req.ip` and `req.protocol` reflect the real visitor rather than Caddy itself —
not load-bearing today since nothing reads either yet, but correct the moment
rate limiting or IP logging is added.

**To stop it:** `sudo brew services stop caddy`. Node keeps running independently;
your domain just stops resolving to anything until Caddy is started again.

⚠️ Going from a temporary tunnel link to a permanent domain changes the risk here.
A tunnel URL is usually short-lived and only shared with people you gave it to; a
domain sits there indefinitely for anyone to find. The admin PIN being visible in
`admin.html`'s source and the total absence of API auth (see Known limitations,
just below) matter far more once the site has a permanent public address — don't
treat this step as "done," treat the items below as the next ones to close.

## Known limitations

Things that are genuinely not solved yet, written down so they don't get rediscovered as surprises.

- **Cafe items are matched by name.** Server-side pricing keys off the item name in `js/menu-data.js`, so renaming an item there without updating anything else makes existing carts holding the old name resolve to unpriced rather than mispriced. Safe, but worth knowing before a menu rewrite.
- **`GET /api/admin/earnings` has no auth**, like every other endpoint here — anyone who can reach the server can read your revenue and driver costs. Same root cause as the admin PIN below.
- **The admin PIN is in the page.** `ADMIN_PIN` is a constant in `admin.html`, visible in view-source, and the API behind it has no auth at all — `GET /api/orders` returns every customer's name, phone, address and coordinates to anyone who requests it. That's fine on localhost; it is a data leak the moment the site is reachable from the internet.
- **Driver sign-in by phone alone still identifies rather than authenticates.** Google sign-in fixes this for drivers who link an account; a driver who never links is exactly as before. Making Google mandatory for drivers would close it completely.
- **Ownership checks trust a client-supplied `userId`.** The address endpoints scope every read and write to `user_id`, which stops accidents and casual tampering, but since there are no sessions or tokens a crafted request can still claim to be another user. Real sessions would fix this everywhere at once.
- **No rate limiting** on any endpoint, so order spam and login brute-forcing are both open.
- **No phone verification at sign-up**, so a wrong or fake number means an order nobody can chase.
- **The PWA needs HTTPS off localhost.** Service workers only run on `https://` or `localhost` — over plain `http://` on a LAN IP or a bare port-forward the site still works, it just won't install or cache. See "HTTPS with a reverse proxy" above for the fix.
- **`warpx.db` has no backup.** It's a single file; losing it loses every order, customer and driver.

## Notes

- Checkout is **Cash on Delivery only** — no payment gateway is wired up. There's no real order fulfillment or delivery dispatch either; placing an order just persists it.
- Login now checks a real hashed password (see "Login / sign-up" above) — the OTP step is gone. Prescription upload still isn't stored server-side — see `medicine.html`'s note about that.
- Google Fonts (Space Grotesk, Inter) load from a CDN with system-font fallbacks if offline.
- Every page ships a tiny inline SVG favicon (a ⚡, no extra file) — purely cosmetic, but it removes the browser's automatic `favicon.ico` 404 from the console on every page load.
- Going beyond a laptop demo — real hosting, a managed Postgres instead of a single SQLite file, a real payment gateway — is a bigger step than this README covers; ask if/when you want to take it there.
