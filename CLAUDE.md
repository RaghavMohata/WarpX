# WarpX — working notes for Claude

Hyperlocal quick-commerce for **Brahmapuri, Maharashtra**: pickup & drop for
food (Picasso Cafe), grocery, medicine, laundry, and anything else. One rider
network, a delivery fee that scales down as the order grows, cash on delivery.

**`README.md` is the real documentation** — 787 lines, and it is current. This
file is a map to it, plus the rules that are invisible in the code. Read the
one or two README sections your task actually touches; don't read all of it.

## Stack — and what it is not

Hand-written HTML, CSS and vanilla JS, served by Express, stored in SQLite
through Node's built-in `node:sqlite`. Node >= 22.5.

```bash
npm install && npm start   # http://localhost:3000
```

**No React. No Tailwind. No bundler. No build step.** Two dependencies:
`express` and `google-auth-library`. Thirteen pages are plain `.html` files
you edit directly and reload.

That is a boundary, not an oversight. A request that implies a framework — a
component library, a CSS-in-JS system, anything installed with `npx <tool>
add` — is a rewrite of the entire front end, not a feature. Say so plainly and
offer the vanilla equivalent; that has been the right answer every time it has
come up.

## Invariants

Each of these looks arbitrary in the code and breaks something real if ignored.

**Four modules run in both Node and the browser** — `lib/fee.js`,
`lib/schedule.js`, `lib/weekly.js` and `js/menu-data.js`. They are `require`d
by `server.js` *and* served as `<script src>`. So: no `import`/`export`, no
Node-only APIs, and keep the `if (typeof module !== "undefined")` export
footer at the bottom. The other `lib/*.js` — `zone`, `tier`, `route`, `auth`,
`google` — are server-only and unconstrained.

**Bump `VERSION` in `sw.js` whenever shared CSS or JS changes shape.**
Currently `warpx-v9`. Pages are network-first, but assets are cache-first —
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

**The delivery code never appears on the driver's page.** `driver.html`
contains no `delivery_code` reference, and should stay that way — the code is
the customer's proof of handover.

## Working on it

- Branch: `claude/warpx-quick-commerce-j2jxmy`. The owner runs the site on a
  Mac at `~/Desktop/WarpX` and pulls from GitHub, so a change only reaches
  them once it is committed and pushed.
- `warpx.db` is gitignored. Deleting it and restarting rebuilds an empty one —
  that is how test orders and planner data get cleared.
- **There is no committed test suite.** Verification is throwaway Playwright
  scripts, written to a scratch directory, run, and discarded. Don't go
  looking for `npm test`.
- The server refuses orders outside **08:00–22:00** (`lib/schedule.js`). A
  machine whose clock sits outside that window fails every order test for
  reasons that look like bugs — run `TZ=UTC npm start`.

## Where to look in the README

| Question | Section |
| --- | --- |
| Endpoints and data shapes | Backend / API |
| Fees, zones, who pays what | Delivery model |
| Rider tiers and payouts | How a driver actually gets paid |
| The rider's screen | The Driver Hub (`driver.html`) |
| Handover OTP | Delivery codes (handover OTP) |
| Owner and driver notifications | n8n order automation |
| Colours and tokens | The dark theme |
| Marathi / Hindi | Languages |
| Motion, scroll, page transitions | Animation |
| The weekly veg planner | Weekly vegetable planner (`weekly.html`) |
| Install to home screen, caching | Installable app (PWA) |
| Google sign-in setup | Sign in with Google |
| Serving over HTTPS | HTTPS with a reverse proxy |
| What is still broken | Known limitations |

## Security posture

The admin dashboard is gated by a PIN that is a **client-side constant in
`admin.html`**, and the API behind it has no auth at all. Ownership checks
trust a client-supplied `userId`. There is no rate limiting and no phone
verification at sign-up. All of this is known, acceptable for a localhost
demo, and written up under "Known limitations" — it does not need
re-reporting. It does need fixing before the site is reachable from the
internet.
