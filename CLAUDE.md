# WarpX — working notes for Claude

Hyperlocal quick-commerce for **Brahmapuri, Maharashtra**: pickup & drop for
food (Picasso Cafe), grocery, medicine, laundry, and anything else. One rider
network, a delivery fee that scales down as the order grows, cash on delivery.

**`README.md` is the real documentation** — about 870 lines, and it is current. This
file is a map to it, plus the rules that are invisible in the code. Read the
one or two README sections your task actually touches; don't read all of it.

## Stack — and what it is not

Hand-written HTML, CSS and vanilla JS, served by Express, stored in SQLite
through Node's built-in `node:sqlite`. Node >= 22.5.

```bash
npm install && npm start   # http://localhost:3000
```

**No React. No Tailwind. No bundler. No build step.** Two dependencies:
`express` and `google-auth-library`. Sixteen pages are plain `.html` files
you edit directly and reload.

That is a boundary, not an oversight. A request that implies a framework — a
component library, a CSS-in-JS system, anything installed with `npx <tool>
add` — is a rewrite of the entire front end, not a feature. Say so plainly and
offer the vanilla equivalent; that has been the right answer every time it has
come up.

## Invariants

Each of these looks arbitrary in the code and breaks something real if ignored.

**Identity comes from the session cookie, never from the request.** Every
route touching an order, address or person runs `requireUser`,
`requireDriver` or `requireAdmin` (top of `server.js`) and reads
`req.userId` / `req.driverId`. A `userId` or `driverId` in a body, query or
path is at most checked against the session with `claims()`, and a mismatch is
a 401. A new endpoint without one of the guards is a data leak. Owner routes
also accept `Authorization: Bearer <N8N_API_KEY>`, which is how n8n calls in.
The one deliberate exception is the cafe's link: `requireCafeKey` checks a
per-order HMAC key (`lib/cafe.js`) that can only move that one order from
`placed` to `preparing`. Keep it that narrow. Opening the link (a GET) must
never change anything, because mail scanners open links on their own.

**The cafe never sees WarpX's prices.** Menu prices include WarpX's ₹15/item
margin over Picasso's own. Anything sent to or shown to the cafe (the `cafe`
block in the new-order webhook, `cafe.html`, `GET /api/cafe/orders/:id`)
carries items, quantities and notes only: no price, no total, no customer.

**The web server hands out an allowlist, not the folder.** Root `.html` pages,
`sw.js`, the manifest, `css/`, `js/`, `img/`, and three `lib/` files. It used to
be `express.static(__dirname)`, which served `warpx.db` to anyone. Never put
that back. A new browser-side folder or `lib/` file must be added to the list.

**Five modules run in both Node and the browser** — `lib/fee.js`,
`lib/zone.js`, `lib/schedule.js`, `lib/weekly.js` and `js/menu-data.js`. They are `require`d
by `server.js` *and* served as `<script src>`. So: no `import`/`export`, no
Node-only APIs, and keep the `if (typeof module !== "undefined")` export
footer at the bottom. The other `lib/*.js` (`tier`, `route`, `auth`,
`google`, `session`, `secrets`, `ratelimit`, `cafe`) are server-only and
unconstrained.

**Bump `VERSION` in `sw.js` whenever shared CSS or JS changes shape.**
Currently `warpx-v14`. Pages are network-first, but assets are cache-first —
without a bump, a returning visitor runs one page-load of yesterday's
JavaScript against today's API.

**The server prices every order.** The client never sends a price; cafe items
resolve by name against `PICASSO_MENU` in `js/menu-data.js`. Renaming an item
there is therefore a pricing change — see the first entry under "Known
limitations".

**The dark theme has three rules** that a contrast audit produced and the code
does not explain:

- `--violet` is never text — it is 2.77:1 on `--bg`. Use it as a border, a
  fill or a shadow. For violet *text*, use `--violet-bright`.
- `--fill-strong` is the bright-block background. Never `--ink`, which inverts
  to invisible on dark.
- A selected `.segmented` pill must be **lighter** than its track, because
  `--surface` is darker than `--surface-2` here. The intuitive pairing reads
  as unselected.

Everything is themed from `:root` in `css/style.css`. Change a token, not a
call site.

**Names, money, order numbers, delivery codes and addresses carry
`translate="no"`.** Google's widget translates every text node it is not told
to skip, so a lost mark means a customer reading a machine translation of
their own address. Any new template showing those needs the attribute.

**Animation is guarded.** Every effect sits behind `prefers-reduced-motion`,
and uses transform and opacity only — these are small-town phones. `driver.html`
and `admin.html` deliberately load **no** `js/main.js`.

**The Driver Hub must not re-render to switch panels.** It refreshes every 10
seconds; `showTab()` toggles `style.display`, and the refresh restores any
half-typed delivery code by scanning `input[id^='otp-']`. Re-rendering on a tab
change would throw away a code a rider is midway through typing.

**`privacy.html` is a promise about the code.** Google's sign-in is published
to real customers on the strength of it: it lists every field WarpX stores and
everyone it goes to (riders, restaurants, Cloudflare, Google, the messaging
apps n8n uses). Storing something new, or sending data somewhere new, means
updating that page in the same change.

**The delivery code never appears on the driver's page.** `driver.html`
contains no `delivery_code` reference, and should stay that way — the code is
the customer's proof of handover.

**The delivery area and distance charge live in two files.** `lib/zone.js`
says where WarpX delivers (Brahmapuri, Wadsa, and a 1.5 km band along the
road between) and how far a spot is from `HUB`; `lib/fee.js` turns that into
money (`FREE_KM`, `PER_KM`, `RIDER_DISTANCE_SHARE`). Orders store the
distance part in `orders.distance_fee`, inside `delivery_fee`: rider pay
(`lib/tier.js`) pays the tier bonus on the ladder part only and 75% of the
distance part. Coverage is always worked out from lat/lng at order time,
never from the stored `zone` column. An address outside the area is refused
with `outOfArea: true`.

## Working on it

- Branch: `claude/warpx-quick-commerce-j2jxmy`. The owner runs the site on a
  MacBook at `~/WarpX` (moved off the Desktop, which macOS hides from
  background processes) and pulls from GitHub, so a change only reaches them
  once it is committed and pushed.
- **It's live at `https://warpx.online`** through a Cloudflare Tunnel, with
  WarpX kept running by pm2. So instructions for the owner end in
  `pm2 restart warpx`, not `npm start`. Starting a second copy fails on the
  port. See the README's "Running it for real".
- **The owner isn't technical.** Give copy-paste commands with the folder
  spelled out, and say what a command will print.
- `warpx.db` is gitignored. Deleting it and restarting rebuilds an empty one —
  that is how test orders and planner data get cleared.
- **There is no committed test suite.** Verification is throwaway Playwright
  scripts, written to a scratch directory, run, and discarded. Don't go
  looking for `npm test`.
- The server refuses orders outside **08:00–22:00** (`lib/schedule.js`). A
  machine whose clock sits outside that window fails every order test for
  reasons that look like bugs — run `TZ=UTC npm start`.
- **API tests need sessions.** Sign up or log in, then send the `wx_user` /
  `wx_driver` cookie back. Owner routes take `Authorization: Bearer <key>`
  from `warpx-secrets.json`. Give each test client its own `X-Forwarded-For`
  (trusted from localhost only), or ten sign-ups in a row hit the rate limit
  and look like a bug.
- `warpx-secrets.json` (gitignored) holds the owner password and n8n key.
  Never commit it or print its values.

## Where to look in the README

| Question | Section |
| --- | --- |
| Endpoints and data shapes | Backend / API |
| Fees, zones, who pays what | Delivery model |
| Rider tiers and payouts | How a driver actually gets paid |
| The rider's screen | The Driver Hub (`driver.html`) |
| Handover OTP | Delivery codes (handover OTP) |
| Owner and driver notifications | n8n order automation |
| The cafe's order email and "I'm preparing it" link | The cafe's order email, and its one-tap "I'm preparing it" |
| Colours and tokens | The dark theme |
| Marathi / Hindi | Languages |
| Motion, scroll, page transitions | Animation |
| The weekly veg planner | Weekly vegetable planner (`weekly.html`) |
| Install to home screen, caching | Installable app (PWA) |
| Logins, sessions, owner password, n8n key, rate limits | Accounts, sessions and the owner password |
| Google sign-in setup | Sign in with Google |
| How the live site runs, restarting, updating | Running it for real (Cloudflare Tunnel + pm2) |
| Serving over HTTPS without Cloudflare | HTTPS with a reverse proxy |
| What is still broken | Known limitations |

## Security posture

Locked down for a site reachable from the internet (public at warpx.online
through a Cloudflare Tunnel). There are HttpOnly session cookies for customers, drivers and the
owner. The owner password lives in `warpx-secrets.json` and is checked on the
server. Password, sign-up, driver sign-in and delivery-code attempts are
rate-limited, and only the site's own files are served. What's still open is
written up under "Known limitations" and doesn't need re-reporting: driver
sign-in by phone alone, no phone/email verification, one shared owner
password, no limit on placing orders, and one cafe for all food orders.
