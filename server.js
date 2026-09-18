/* WarpX local server — serves the static site and a small JSON API
   backed by SQLite (warpx.db, created automatically on first run). */
const express = require("express");
const crypto = require("crypto");
const path = require("path");
const db = require("./db");
const { classifyZone } = require("./lib/zone");
const { hashPassword, verifyPassword } = require("./lib/auth");
const googleAuth = require("./lib/google");
const { tierFor, payFor, payIfOneMore, BASE_PAY_PER_DELIVERY } = require("./lib/tier");
const { feeFor, weeklyPlanFee } = require("./lib/fee");
const { validateSchedule, parseSchedule, isDueForDispatch, isOpenNow, nextOpeningSlot,
        SCHEDULE_OPEN_HOUR, SCHEDULE_CLOSE_HOUR } = require("./lib/schedule");
const { isWindowOpen, DELIVERY_SLOTS, slotById, weekDates, dayLabelFor, scheduledForDay, addDays } = require("./lib/weekly");
const { assignRoutes, routeDistanceKm } = require("./lib/route");
const { PICASSO_MENU } = require("./js/menu-data");
const config = require("./config");

const app = express();
// Correct behind a reverse proxy (Caddy/nginx) so req.ip and req.protocol
// reflect the real visitor rather than the proxy itself — matters the day
// this gets IP-based rate limiting or logging, neither of which exist yet.
app.set("trust proxy", true);
app.use(express.json());
app.use(express.static(__dirname));

function getLatestLocation(userId) {
  return db.prepare("SELECT * FROM locations WHERE user_id = ? ORDER BY id DESC LIMIT 1").get(userId);
}

function publicUser(row) {
  return { id: row.id, name: row.name, phone: row.phone };
}

// The delivery OTP is the customer's proof that a handover actually happened,
// so it must never travel to anyone but them — strip it from every response
// a driver (or the owner dashboard) can read. If a driver could read it, the
// code would prove nothing.
function withoutOtp(order) {
  const { delivery_otp, ...rest } = order;
  return rest;
}

// A food item means this order is collected from Picasso first — surfaced to
// drivers (job board, active list) and to n8n's delivery-partner notification.
// Never attached to anything a customer sees. Other services have no single
// fixed pickup point yet, so this is null for them.
function pickupAddressFor(items) {
  return items.some((it) => it.service === "food") ? config.PICASSO_ADDRESS : null;
}

// Fire-and-forget POST to an n8n webhook. n8n being down or unconfigured must
// never slow down or fail whatever WarpX request triggered the notification —
// it has already committed to the database by the time this is called.
function postToN8n(url, body) {
  if (!url) return;
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  }).catch(() => {});
}

/* Tells n8n an order just came in, so it can message the restaurant owner
   and delivery partners (Telegram/WhatsApp) even when nobody has admin.html
   or driver.html open to see the in-browser alert. n8n writes status changes
   back through the existing PATCH /api/orders/:id/status and .../pickup
   routes below, so no separate callback endpoint is needed here. Never
   include the delivery OTP — see withoutOtp() above for why. */
function notifyN8n(order) {
  // Env var wins, same as GOOGLE_CLIENT_ID — lets a one-off run point at a
  // different n8n instance without editing config.js.
  postToN8n(process.env.N8N_WEBHOOK_URL || config.N8N_WEBHOOK_URL, order);
}

/* Tells n8n an order's status just changed, so it can message the *customer*
   directly (Telegram/WhatsApp/SMS, whatever the workflow is wired to) instead
   of them having to keep orders.html open and refreshing. A separate webhook
   from notifyN8n() above, so each stays a simple, single-purpose n8n
   workflow. Looks up the customer fresh each time rather than trusting a
   caller to already have it, since two of the three callers only have the
   order row, not the user's contact details. */
function notifyN8nStatus(order, status) {
  const url = process.env.N8N_STATUS_WEBHOOK_URL || config.N8N_STATUS_WEBHOOK_URL;
  if (!url) return;
  const customer = db.prepare("SELECT name, phone FROM users WHERE id = ?").get(order.user_id);
  postToN8n(url, {
    orderId: order.id,
    orderNumber: order.order_number,
    status,
    customerName: customer ? customer.name : null,
    customerPhone: customer ? customer.phone : null,
  });
}

/* ---- Pricing is the server's business, not the browser's ------------------
   POST /api/orders used to total up whatever `price` the request carried,
   which meant a hand-crafted request could buy a ₹184 cold brew for ₹1. The
   server now ignores that field entirely and looks every cafe item up in the
   same menu the customer was shown.

   Only food is ever priced here. Grocery, medicine, laundry and custom
   requests are all quoted at pickup and stay null — which is exactly what
   they already did, so nothing about them changes. */
const MENU_PRICES = new Map();
for (const category of PICASSO_MENU) {
  for (const item of category.items) MENU_PRICES.set(item.name, item.price);
}

function resolvePrice(item) {
  if (item.service !== "food") return null;
  const listed = MENU_PRICES.get(item.name);
  // An unrecognised cafe line (a "Custom cafe request", or a renamed item) is
  // priced by hand at pickup rather than trusted from the request.
  return listed == null ? null : listed;
}

/* Opening hours as the SHOP sees them. The browser must not decide this from
   its own clock: a customer in another timezone (or with a wrong device
   clock) would otherwise be told the shop is open when the server will
   refuse the order, or shown a closed banner over a perfectly open shop. */
app.get("/api/hours", (req, res) => {
  const open = isOpenNow();
  res.json({
    open,
    openHour: SCHEDULE_OPEN_HOUR,
    closeHour: SCHEDULE_CLOSE_HOUR,
    opensAt: open ? null : nextOpeningSlot(),
  });
});

/* ---- Sign in with Google -------------------------------------------------
   The browser gets a signed ID token from Google and posts it here. Nothing in
   it is believed until lib/google.js has verified the signature against
   Google's keys, so every field used below comes from a verified payload.

   Google gives an email; WarpX has to deliver to a doorstep. So a first-time
   sign-in doesn't finish here — it returns a ticket, and the phone number (and,
   if that phone already has an account, its password) completes it. */

app.get("/api/auth/google/config", (req, res) => {
  // Lets the browser render the button without the client id being pasted into
  // a dozen pages, and no-op cleanly when Google sign-in isn't configured.
  res.json({ enabled: googleAuth.isEnabled(), clientId: googleAuth.CLIENT_ID });
});

function googleUserResponse(row) {
  return { id: row.id, name: row.name, phone: row.phone, email: row.email, avatarUrl: row.avatar_url };
}

app.post("/api/auth/google", async (req, res) => {
  if (!googleAuth.isEnabled()) return res.status(503).json({ error: "Google sign-in isn't set up on this server." });

  let profile;
  try {
    profile = await googleAuth.verifyIdToken((req.body || {}).credential);
  } catch (err) {
    // Deliberately vague: the caller learns it failed, not how to get closer.
    return res.status(401).json({ error: "That Google sign-in couldn't be verified. Please try again." });
  }
  googleAuth.purgeExpiredTickets();

  // Returning customer — straight in.
  const existing = db.prepare("SELECT * FROM users WHERE google_sub = ?").get(profile.sub);
  if (existing) {
    // Keep the profile fresh; people change their name and picture.
    db.prepare("UPDATE users SET email = ?, avatar_url = ?, name = COALESCE(name, ?) WHERE id = ?")
      .run(profile.email, profile.picture, profile.name, existing.id);
    const row = db.prepare("SELECT * FROM users WHERE id = ?").get(existing.id);
    return res.json({ status: "signed-in", user: googleUserResponse(row) });
  }

  // First time: we still need a phone number before an order can go anywhere.
  const ticket = googleAuth.createTicket(profile);
  const driver = db.prepare("SELECT * FROM drivers WHERE google_sub = ?").get(profile.sub);
  res.json({
    status: "needs-phone",
    ticket,
    email: profile.email,
    name: profile.name,
    driver: driver ? { id: driver.id, name: driver.name, phone: driver.phone } : null,
  });
});

app.post("/api/auth/google/complete", (req, res) => {
  const { ticket, phone, password, name } = req.body || {};
  const profile = googleAuth.readTicket(ticket);
  if (!profile) {
    return res.status(410).json({ error: "That sign-in timed out. Tap the Google button again." });
  }
  const cleanPhone = String(phone || "").trim();
  if (!cleanPhone) return res.status(400).json({ error: "We need a mobile number to deliver to." });

  const existing = db.prepare("SELECT * FROM users WHERE phone = ?").get(cleanPhone);

  if (existing) {
    /* This phone already has an account. Linking it to whoever happens to be
       signed into Google right now would hand that account to anyone who knows
       the number, so the account's own password has to be produced first. */
    if (existing.google_sub && existing.google_sub !== profile.sub) {
      return res.status(409).json({ error: "That number is already linked to a different Google account." });
    }
    if (existing.password_hash) {
      if (!password) {
        return res.status(401).json({ error: "That number already has a WarpX account. Enter its password to link them.", needsPassword: true });
      }
      if (!verifyPassword(password, existing.password_hash, existing.password_salt)) {
        return res.status(401).json({ error: "That password doesn't match the account for this number.", needsPassword: true });
      }
    }
    db.prepare("UPDATE users SET google_sub = ?, email = ?, avatar_url = ?, name = COALESCE(name, ?) WHERE id = ?")
      .run(profile.sub, profile.email, profile.picture, profile.name, existing.id);
    googleAuth.consumeTicket(ticket);
    const row = db.prepare("SELECT * FROM users WHERE id = ?").get(existing.id);
    return res.json({ status: "linked", user: googleUserResponse(row) });
  }

  let info;
  try {
    info = db.prepare("INSERT INTO users (name, phone, email, google_sub, avatar_url) VALUES (?, ?, ?, ?, ?)")
      .run(name || profile.name || null, cleanPhone, profile.email, profile.sub, profile.picture);
  } catch (err) {
    // The unique indexes are the real guard if two tabs race the same signup.
    return res.status(409).json({ error: "That number or Google account is already registered." });
  }
  googleAuth.consumeTicket(ticket);
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(info.lastInsertRowid);
  res.json({ status: "created", user: googleUserResponse(row) });
});

/* Drivers sign in with the same button. Linking is by the phone they applied
   with — the same key the phone-only login already uses — so this is no weaker
   than today's sign-in, and every sign-in after the link is properly
   authenticated rather than merely claimed. */
app.post("/api/auth/google/driver", async (req, res) => {
  if (!googleAuth.isEnabled()) return res.status(503).json({ error: "Google sign-in isn't set up on this server." });

  let profile;
  try {
    profile = await googleAuth.verifyIdToken((req.body || {}).credential);
  } catch (err) {
    return res.status(401).json({ error: "That Google sign-in couldn't be verified. Please try again." });
  }

  const linked = db.prepare("SELECT * FROM drivers WHERE google_sub = ?").get(profile.sub);
  if (linked) {
    if (linked.status !== "approved") {
      return res.status(403).json({ error: "Your application isn't approved yet. We'll call you once it is." });
    }
    return res.json({ status: "signed-in", driver: { id: linked.id, name: linked.name, phone: linked.phone, vehicleType: linked.vehicle_type } });
  }
  res.json({ status: "needs-phone", ticket: googleAuth.createTicket(profile), email: profile.email, name: profile.name });
});

app.post("/api/auth/google/driver/complete", (req, res) => {
  const { ticket, phone } = req.body || {};
  const profile = googleAuth.readTicket(ticket);
  if (!profile) return res.status(410).json({ error: "That sign-in timed out. Tap the Google button again." });

  const cleanPhone = String(phone || "").trim();
  // Latest application wins, matching POST /api/drivers/login.
  const driver = db.prepare("SELECT * FROM drivers WHERE phone = ? ORDER BY id DESC").get(cleanPhone);
  if (!driver) return res.status(404).json({ error: "No application found for that number — apply on the Work With Us page first." });
  if (driver.status === "pending") return res.status(403).json({ error: "Your application is still being reviewed. We'll call you once it's approved." });
  if (driver.status === "rejected") return res.status(403).json({ error: "This application wasn't approved. Get in touch if you think that's a mistake." });
  if (driver.google_sub && driver.google_sub !== profile.sub) {
    return res.status(409).json({ error: "That number is already linked to a different Google account. Ask the owner to unlink it." });
  }

  db.prepare("UPDATE drivers SET google_sub = ?, email = ? WHERE id = ?").run(profile.sub, profile.email, driver.id);
  googleAuth.consumeTicket(ticket);
  res.json({ status: "linked", driver: { id: driver.id, name: driver.name, phone: driver.phone, vehicleType: driver.vehicle_type } });
});

// The owner's undo, for a link made to the wrong number.
app.delete("/api/drivers/:id/google", (req, res) => {
  const info = db.prepare("UPDATE drivers SET google_sub = NULL, email = NULL WHERE id = ?").run(Number(req.params.id));
  if (info.changes === 0) return res.status(404).json({ error: "No such driver." });
  res.json({ ok: true });
});

// Create a new account — phone + password, hashed with a per-user salt.
app.post("/api/auth/signup", (req, res) => {
  const { name, phone, password } = req.body || {};
  if (!phone || !password) return res.status(400).json({ error: "Phone and password are required." });
  if (password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters." });

  const existing = db.prepare("SELECT id FROM users WHERE phone = ?").get(phone);
  if (existing) return res.status(409).json({ error: "An account with this phone number already exists — try logging in instead." });

  const { hash, salt } = hashPassword(password);
  const info = db
    .prepare("INSERT INTO users (name, phone, password_hash, password_salt) VALUES (?, ?, ?, ?)")
    .run(name || null, phone, hash, salt);
  res.json(publicUser(db.prepare("SELECT * FROM users WHERE id = ?").get(info.lastInsertRowid)));
});

// Log into an existing account.
app.post("/api/auth/login", (req, res) => {
  const { phone, password } = req.body || {};
  if (!phone || !password) return res.status(400).json({ error: "Phone and password are required." });

  const user = db.prepare("SELECT * FROM users WHERE phone = ?").get(phone);
  if (!user || !verifyPassword(password, user.password_hash, user.password_salt)) {
    return res.status(401).json({ error: "Incorrect phone number or password." });
  }
  res.json(publicUser(user));
});

// Save a captured location and compute the delivery zone/ETA server-side.
app.post("/api/users/:id/location", (req, res) => {
  const userId = Number(req.params.id);
  const { lat, lng, method, accuracy, address } = req.body || {};
  if (lat == null || lng == null) return res.status(400).json({ error: "lat/lng are required" });

  const zoneInfo = classifyZone(lat, lng);
  db.prepare(
    `INSERT INTO locations (user_id, lat, lng, method, accuracy, address, zone, distance_km, eta_min)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(userId, lat, lng, method || null, accuracy ?? null, address || null, zoneInfo.zone, zoneInfo.distanceKm, zoneInfo.etaMin);

  res.json(zoneInfo);
});

app.get("/api/users/:id/location", (req, res) => {
  res.json(getLatestLocation(Number(req.params.id)) || null);
});

/* ---- Saved addresses (Home / Shop / Mom's) --------------------------------
   An address book, kept separate from the `locations` capture log: locations
   records every GPS fix ever taken, addresses holds the handful of named
   places someone actually orders to. */

// Exactly one address per user carries is_default, so switching has to clear
// the old one and set the new one together or not at all.
function setDefaultAddress(userId, addressId) {
  db.exec("BEGIN");
  try {
    db.prepare("UPDATE addresses SET is_default = 0 WHERE user_id = ?").run(userId);
    db.prepare("UPDATE addresses SET is_default = 1 WHERE id = ? AND user_id = ?").run(addressId, userId);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

function cleanLabel(label) {
  return String(label || "").trim().slice(0, 24);
}

app.get("/api/users/:id/addresses", (req, res) => {
  const rows = db
    .prepare("SELECT * FROM addresses WHERE user_id = ? ORDER BY is_default DESC, id DESC")
    .all(Number(req.params.id));
  res.json(rows);
});

app.post("/api/users/:id/addresses", (req, res) => {
  const userId = Number(req.params.id);
  const { label, address, lat, lng, makeDefault } = req.body || {};
  if (lat == null || lng == null) {
    return res.status(400).json({ error: "An address needs coordinates — capture the location first." });
  }
  const name = cleanLabel(label);
  if (!name) return res.status(400).json({ error: "Give this address a name, like Home or Shop." });

  const zoneInfo = classifyZone(lat, lng);
  const info = db
    .prepare(
      `INSERT INTO addresses (user_id, label, address, lat, lng, zone, distance_km, eta_min)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(userId, name, address || null, lat, lng, zoneInfo.zone, zoneInfo.distanceKm, zoneInfo.etaMin);

  // The first address someone saves becomes their default automatically —
  // otherwise their only saved place still wouldn't be pre-selected.
  const count = db.prepare("SELECT COUNT(*) AS n FROM addresses WHERE user_id = ?").get(userId).n;
  if (makeDefault || count === 1) setDefaultAddress(userId, info.lastInsertRowid);

  res.json(db.prepare("SELECT * FROM addresses WHERE id = ?").get(info.lastInsertRowid));
});

app.patch("/api/addresses/:id", (req, res) => {
  const id = Number(req.params.id);
  const { userId, label, address, lat, lng, makeDefault } = req.body || {};
  const existing = db.prepare("SELECT * FROM addresses WHERE id = ? AND user_id = ?").get(id, Number(userId));
  if (!existing) return res.status(404).json({ error: "That address isn't yours, or no longer exists." });

  const name = label === undefined ? existing.label : cleanLabel(label);
  if (!name) return res.status(400).json({ error: "Give this address a name, like Home or Shop." });

  const newLat = lat == null ? existing.lat : lat;
  const newLng = lng == null ? existing.lng : lng;
  // Moving the pin changes which zone it's in, so the ETA has to be recomputed
  // rather than carried over from wherever it used to be.
  const zoneInfo = classifyZone(newLat, newLng);

  db.prepare(
    `UPDATE addresses SET label = ?, address = ?, lat = ?, lng = ?, zone = ?, distance_km = ?, eta_min = ?
     WHERE id = ? AND user_id = ?`
  ).run(
    name, address === undefined ? existing.address : address || null,
    newLat, newLng, zoneInfo.zone, zoneInfo.distanceKm, zoneInfo.etaMin, id, Number(userId)
  );

  if (makeDefault) setDefaultAddress(Number(userId), id);
  res.json(db.prepare("SELECT * FROM addresses WHERE id = ?").get(id));
});

app.delete("/api/addresses/:id", (req, res) => {
  const id = Number(req.params.id);
  const userId = Number(req.query.userId || (req.body || {}).userId);
  const existing = db.prepare("SELECT * FROM addresses WHERE id = ? AND user_id = ?").get(id, userId);
  if (!existing) return res.status(404).json({ error: "That address isn't yours, or no longer exists." });

  db.prepare("DELETE FROM addresses WHERE id = ? AND user_id = ?").run(id, userId);

  // Deleting the default would leave the user with saved addresses but none
  // selected, so the next one in line takes over.
  if (existing.is_default) {
    const next = db.prepare("SELECT id FROM addresses WHERE user_id = ? ORDER BY id DESC LIMIT 1").get(userId);
    if (next) setDefaultAddress(userId, next.id);
  }
  res.json({ ok: true });
});

/* Where an order is going, in order of preference: the address the customer
   picked at checkout, their default saved address, and finally the last raw
   GPS capture — so someone who has never saved an address still orders
   exactly as they did before. Shared by single orders and weekly plans, which
   both need the same answer. */
function resolveOrderAddress(userId, addressId) {
  let chosenAddress = null;
  if (addressId != null) {
    chosenAddress = db.prepare("SELECT * FROM addresses WHERE id = ? AND user_id = ?").get(Number(addressId), userId);
  }
  if (!chosenAddress) {
    chosenAddress = db.prepare("SELECT * FROM addresses WHERE user_id = ? AND is_default = 1").get(userId);
  }
  const loc = chosenAddress || getLatestLocation(userId);
  return { chosenAddress, loc, etaMin: loc ? loc.eta_min : "20-30" };
}

/* Writes one order and its line items. Deliberately does NOT open its own
   transaction: a weekly plan is several orders that have to land together or
   not at all, so the caller owns the transaction boundary. */
function insertOrderWithItems({ userId, priced, subtotal, deliveryFee, method, upiId, loc, chosenAddress, scheduledFor, weeklyWindowId }) {
  const orderNumber = "WPX" + Math.floor(100000 + Math.random() * 900000);
  // 4-digit handover code, only ever shown to the customer.
  const deliveryOtp = String(crypto.randomInt(1000, 10000));

  const orderInfo = db
    .prepare(
      `INSERT INTO orders (order_number, user_id, subtotal, delivery_fee, total, eta_min, payment_method, upi_id, lat, lng, address, delivery_otp, address_label, scheduled_for, weekly_window_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      orderNumber, userId, subtotal, deliveryFee, subtotal + deliveryFee,
      loc ? loc.eta_min : "20-30", method,
      method === "upi" ? upiId || null : null,
      loc ? loc.lat : null, loc ? loc.lng : null, loc ? loc.address : null,
      deliveryOtp,
      chosenAddress ? chosenAddress.label : null,
      scheduledFor || null,
      weeklyWindowId || null
    );
  const orderId = orderInfo.lastInsertRowid;

  const insertItem = db.prepare(
    "INSERT INTO order_items (order_id, service, name, price, qty, note) VALUES (?, ?, ?, ?, ?, ?)"
  );
  for (const it of priced) {
    if (!it.service || !it.name) throw new Error("each item needs a service and a name");
    insertItem.run(orderId, it.service, it.name, it.price, it.qty || 1, it.note || null);
  }
  return { orderId, orderNumber, deliveryOtp };
}

// Place an order — computes totals server-side and persists items.
// Requires a logged-in account: orders are never anonymous.
// Weekly vegetable plans do NOT come through here: a plan is several orders
// that must be created together, so it has its own endpoint below.
app.post("/api/orders", (req, res) => {
  const { userId, items, paymentMethod, upiId, addressId, scheduleDate, scheduleTime } = req.body || {};
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "items are required" });
  }
  if (!userId) return res.status(401).json({ error: "Please log in to place an order." });
  const user = db.prepare("SELECT id FROM users WHERE id = ?").get(userId);
  if (!user) return res.status(401).json({ error: "Please log in to place an order." });

  const method = paymentMethod === "upi" ? "upi" : "cod";

  /* An order is either ASAP or scheduled. The browser validates the same way
     via lib/schedule.js, but this is the check that counts — it runs against
     the server's clock, which is the one dispatch actually uses. */
  let scheduledFor = null;
  if (scheduleDate || scheduleTime) {
    const check = validateSchedule(scheduleDate, scheduleTime);
    if (!check.ok) return res.status(400).json({ error: check.error });
    scheduledFor = check.value;
  } else if (!isOpenNow()) {
    /* An ASAP order outside opening hours can't be honoured — nobody is there
       to pick it up. Refused with the next slot named, so the customer can
       schedule instead of simply being turned away. */
    const next = nextOpeningSlot();
    return res.status(409).json({
      error: `We're closed right now. Schedule your order for ${next.label} instead, or come back when we open.`,
      closed: true,
      opensAt: next,
    });
  }

  // Resolved once, then reused for both the subtotal and the stored line items,
  // so what's charged and what's recorded can never disagree.
  const priced = items.map((it) => ({ ...it, price: resolvePrice(it) }));
  const subtotal = priced.reduce((sum, it) => sum + (it.price || 0) * (it.qty || 1), 0);
  // Priced server-side from the real subtotal — the browser's figure is only
  // ever a preview, never what gets charged.
  const deliveryFee = feeFor(subtotal);
  const total = subtotal + deliveryFee;
  const { chosenAddress, loc, etaMin } = resolveOrderAddress(userId, addressId);

  // Order + its line items must land together — wrap in a transaction so a
  // failure partway through (e.g. a bad item) never leaves an order with
  // some items missing.
  let orderId, orderNumber, deliveryOtp;
  db.exec("BEGIN");
  try {
    ({ orderId, orderNumber, deliveryOtp } = insertOrderWithItems({
      userId, priced, subtotal, deliveryFee, method, upiId, loc, chosenAddress, scheduledFor,
    }));
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    return res.status(400).json({ error: "Could not place order: " + err.message });
  }

  notifyN8n({
    orderId,
    orderNumber,
    services: [...new Set(priced.map((it) => it.service))],
    items: priced.map((it) => ({ name: it.name, qty: it.qty || 1, price: it.price })),
    subtotal,
    deliveryFee,
    total,
    paymentMethod: method,
    pickupAddress: pickupAddressFor(priced),
    address: loc ? loc.address : null,
    addressLabel: chosenAddress ? chosenAddress.label : null,
    etaMin,
    scheduledFor,
  });

  res.json({ orderId, orderNumber, subtotal, deliveryFee, total, etaMin, paymentMethod: method, status: "placed", deliveryOtp, addressLabel: chosenAddress ? chosenAddress.label : null, scheduledFor });
});

/* ---- Weekly vegetable plans ------------------------------------------------
   The owner opens a window covering one week of delivery days. Customers plan
   that week on weekly.html — vegetables under each day, one delivery slot for
   the whole week — and submit it as a PLAN, which becomes one ordinary order
   per day they put something under. After the cutoff the owner routes each
   day separately: lib/route.js sequences that day's stops from the dark store
   outward and splits them across drivers, capped at a fixed count each. */

// Public — weekly.html reads this to render the week, the slots and what's
// still free. Exposes only window shape and counts, never another customer's
// details, so it needs no auth.
app.get("/api/weekly/current", (req, res) => {
  const w = db.prepare("SELECT * FROM weekly_windows WHERE status = 'open' ORDER BY id DESC LIMIT 1").get();
  if (!isWindowOpen(w)) return res.json({ open: false });

  const takenStmt = db.prepare("SELECT COUNT(*) AS n FROM weekly_plans WHERE window_id = ? AND slot_id = ?");
  res.json({
    open: true,
    window: {
      id: w.id,
      cutoffAt: w.cutoff_at,
      weekStartDate: w.week_start_date,
      days: weekDates(w.week_start_date),
      slots: DELIVERY_SLOTS.map((s) => {
        const taken = takenStmt.get(w.id, s.id).n;
        return { ...s, capacity: w.slot_capacity, taken, full: taken >= w.slot_capacity };
      }),
    },
  });
});

/* One active window at a time — enforced here, not in the schema, the same way
   a single default address is. "Active" is derived rather than stored: a
   closed week stops blocking the next one as soon as its last delivery lands,
   so the owner never has to remember to mark a week finished. */
function currentActiveWeeklyWindow() {
  return db
    .prepare(
      `SELECT * FROM weekly_windows w
       WHERE w.status = 'open'
          OR (w.status = 'closed'
              AND EXISTS (SELECT 1 FROM orders o
                          WHERE o.weekly_window_id = w.id AND o.status != 'delivered'))
       ORDER BY w.id DESC LIMIT 1`
    )
    .get();
}

// Every weekly window, newest first, with what it collected — owner use.
app.get("/api/admin/weekly/windows", (req, res) => {
  const windows = db.prepare("SELECT * FROM weekly_windows ORDER BY id DESC").all();
  const orderStmt = db.prepare("SELECT COUNT(*) AS n FROM orders WHERE weekly_window_id = ?");
  const planStmt = db.prepare("SELECT COUNT(*) AS n FROM weekly_plans WHERE window_id = ?");
  res.json(windows.map((w) => ({ ...w, orderCount: orderStmt.get(w.id).n, planCount: planStmt.get(w.id).n })));
});

app.post("/api/admin/weekly/windows", (req, res) => {
  const { cutoffDate, cutoffTime, weekStartDate, slotCapacity } = req.body || {};
  if (currentActiveWeeklyWindow()) {
    return res.status(409).json({ error: "There's already a week in progress — finish its deliveries before opening another." });
  }
  const cutoff = parseSchedule(`${cutoffDate} ${cutoffTime}`);
  if (!cutoff) return res.status(400).json({ error: "Pick a valid cutoff date and time." });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(weekStartDate || ""))) {
    return res.status(400).json({ error: "Pick the date the delivery week starts on." });
  }
  if (cutoff.getTime() <= Date.now()) return res.status(400).json({ error: "The cutoff has to be in the future." });
  /* A week that starts before its own cutoff has days nobody can still order
     for — the planner would show Monday and Tuesday as already gone. Caught
     here rather than left for the customer to discover. */
  if (weekStartDate < cutoffDate) {
    return res.status(400).json({ error: "The delivery week can't start before the cutoff — customers wouldn't be able to order for its first days." });
  }
  const capacity = Number(slotCapacity) || config.WEEKLY_SLOT_CAPACITY;
  if (!Number.isInteger(capacity) || capacity < 1) {
    return res.status(400).json({ error: "Customers per slot must be a whole number of 1 or more." });
  }

  const info = db
    .prepare("INSERT INTO weekly_windows (cutoff_at, week_start_date, slot_capacity) VALUES (?, ?, ?)")
    .run(`${cutoffDate} ${cutoffTime}`, weekStartDate, capacity);
  res.json(db.prepare("SELECT * FROM weekly_windows WHERE id = ?").get(info.lastInsertRowid));
});

// The owner's manual early cutoff — stops submissions even before cutoff_at.
app.patch("/api/admin/weekly/windows/:id/close", (req, res) => {
  const id = Number(req.params.id);
  const w = db.prepare("SELECT * FROM weekly_windows WHERE id = ?").get(id);
  if (!w) return res.status(404).json({ error: "No such weekly window." });
  if (w.status !== "open") return res.status(409).json({ error: "That window isn't open." });
  db.prepare("UPDATE weekly_windows SET status = 'closed', closed_at = datetime('now') WHERE id = ?").run(id);
  res.json(db.prepare("SELECT * FROM weekly_windows WHERE id = ?").get(id));
});

/* A customer's plan for the open week, so the planner can show them what they
   already booked. Needed because submitting clears the browser's cart — without
   this, coming back to the page would look like nothing was ever ordered.
   Also returns their most recent previous plan, which powers "copy last week"
   so a regular doesn't retype the same vegetables every week. */
app.get("/api/weekly/plans/mine", (req, res) => {
  const userId = Number(req.query.userId);
  const windowId = Number(req.query.windowId);
  if (!userId || !windowId) return res.status(400).json({ error: "userId and windowId are required." });

  const window = db.prepare("SELECT * FROM weekly_windows WHERE id = ?").get(windowId);
  if (!window) return res.status(404).json({ error: "No such week." });

  const itemsStmt = db.prepare("SELECT name, qty, note FROM order_items WHERE order_id = ?");
  const daysForPlan = (winRow, uid) =>
    db
      .prepare("SELECT * FROM orders WHERE weekly_window_id = ? AND user_id = ? ORDER BY scheduled_for ASC")
      .all(winRow.id, uid)
      .map((o) => {
        const date = String(o.scheduled_for || "").slice(0, 10);
        const day = weekDates(winRow.week_start_date).find((d) => d.date === date);
        return {
          index: day ? day.index : null,
          date,
          orderNumber: o.order_number,
          status: o.status,
          items: itemsStmt.all(o.id),
        };
      });

  const plan = db.prepare("SELECT * FROM weekly_plans WHERE window_id = ? AND user_id = ?").get(windowId, userId);

  // Their last plan from an earlier week, for the copy-forward shortcut.
  const previous = db
    .prepare("SELECT * FROM weekly_plans WHERE user_id = ? AND window_id != ? ORDER BY id DESC LIMIT 1")
    .get(userId, windowId);
  let lastWeek = null;
  if (previous) {
    const prevWindow = db.prepare("SELECT * FROM weekly_windows WHERE id = ?").get(previous.window_id);
    if (prevWindow) lastWeek = { slotId: previous.slot_id, days: daysForPlan(prevWindow, userId) };
  }

  res.json({
    plan: plan ? { id: plan.id, slotId: plan.slot_id, days: daysForPlan(window, userId) } : null,
    lastWeek,
  });
});

/* Submit (or replace) a week's plan. This is the one place weekly orders are
   created: a plan is several orders that have to land together, so looping
   POST /api/orders from the browser isn't an option — a failure halfway
   through would leave someone holding half a week, and the slot check would
   race against itself across the requests. */
app.post("/api/weekly/plans", (req, res) => {
  const { userId, windowId, slotId, addressId, paymentMethod, upiId, days } = req.body || {};

  if (!userId) return res.status(401).json({ error: "Please log in to plan your week." });
  const user = db.prepare("SELECT id FROM users WHERE id = ?").get(userId);
  if (!user) return res.status(401).json({ error: "Please log in to plan your week." });

  const window = db.prepare("SELECT * FROM weekly_windows WHERE id = ?").get(Number(windowId));
  if (!isWindowOpen(window)) {
    return res.status(409).json({ error: "This week's vegetable planner has closed.", weeklyClosed: true });
  }
  if (!slotById(slotId)) return res.status(400).json({ error: "Pick a delivery time slot." });

  if (!Array.isArray(days) || days.length === 0) {
    return res.status(400).json({ error: "Add vegetables to at least one day." });
  }
  const seen = new Set();
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  for (const day of days) {
    const index = Number(day && day.index);
    if (!Number.isInteger(index) || index < 0 || index > 6) {
      return res.status(400).json({ error: "That isn't a day of the week." });
    }
    if (seen.has(index)) return res.status(400).json({ error: "Each day can only appear once." });
    seen.add(index);
    if (!Array.isArray(day.items) || day.items.length === 0) {
      return res.status(400).json({ error: `${dayLabelFor(window.week_start_date, index)} has no vegetables on it.` });
    }
    // Backstop for a window whose first days have already gone by.
    if (addDays(window.week_start_date, index) < todayStr) {
      return res.status(400).json({ error: `${dayLabelFor(window.week_start_date, index)} has already passed.` });
    }
  }

  const existing = db.prepare("SELECT * FROM weekly_plans WHERE window_id = ? AND user_id = ?").get(window.id, userId);
  if (existing) {
    const started = db
      .prepare("SELECT COUNT(*) AS n FROM orders WHERE weekly_window_id = ? AND user_id = ? AND (driver_id IS NOT NULL OR status != 'placed')")
      .get(window.id, userId).n;
    if (started > 0) {
      return res.status(409).json({ error: "Part of this week is already being delivered, so it can't be changed now.", planLocked: true });
    }
  }

  /* Capacity is counted over OTHER customers: someone editing their own plan
     shouldn't be refused by the seat they're already sitting in. */
  const taken = db
    .prepare("SELECT COUNT(*) AS n FROM weekly_plans WHERE window_id = ? AND slot_id = ? AND user_id != ?")
    .get(window.id, slotId, userId).n;
  if (taken >= window.slot_capacity) {
    return res.status(409).json({ error: "That delivery slot just filled up — please pick another.", slotFull: true });
  }

  const { chosenAddress, loc } = resolveOrderAddress(userId, addressId);
  const method = paymentMethod === "upi" ? "upi" : "cod";

  // Priced server-side, exactly like any other order: the browser's figures
  // are a preview, never what gets charged.
  const pricedDays = days
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((day) => {
      const priced = day.items.map((it) => ({
        ...it,
        service: "grocery",
        price: resolvePrice({ ...it, service: "grocery" }),
        // Derived from the window's own dates, never echoed back from the client.
        note: dayLabelFor(window.week_start_date, day.index),
      }));
      return {
        index: Number(day.index),
        priced,
        subtotal: priced.reduce((sum, it) => sum + (it.price || 0) * (it.qty || 1), 0),
      };
    });
  const fee = weeklyPlanFee(pricedDays.length, pricedDays.map((d) => d.subtotal));

  const created = [];
  db.exec("BEGIN");
  try {
    // Replacing a plan means replacing its orders outright — simpler to reason
    // about than diffing days, and the orders haven't been touched yet.
    if (existing) {
      db.prepare("DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE weekly_window_id = ? AND user_id = ?)").run(window.id, userId);
      db.prepare("DELETE FROM orders WHERE weekly_window_id = ? AND user_id = ?").run(window.id, userId);
      db.prepare("UPDATE weekly_plans SET slot_id = ?, updated_at = datetime('now') WHERE id = ?").run(slotId, existing.id);
    } else {
      db.prepare("INSERT INTO weekly_plans (window_id, user_id, slot_id) VALUES (?, ?, ?)").run(window.id, userId, slotId);
    }

    pricedDays.forEach((day, i) => {
      const scheduledFor = scheduledForDay(window.week_start_date, day.index, slotId);
      const written = insertOrderWithItems({
        userId,
        priced: day.priced,
        subtotal: day.subtotal,
        deliveryFee: fee.perOrder[i],
        method, upiId, loc, chosenAddress, scheduledFor,
        weeklyWindowId: window.id,
      });
      created.push({ ...written, dayIndex: day.index, date: addDays(window.week_start_date, day.index), deliveryFee: fee.perOrder[i], subtotal: day.subtotal, priced: day.priced, scheduledFor });
    });
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    return res.status(400).json({ error: "Could not save your week: " + err.message });
  }

  // Fire-and-forget, after the commit — same contract as a single order.
  for (const order of created) {
    notifyN8n({
      orderId: order.orderId,
      orderNumber: order.orderNumber,
      services: ["grocery"],
      items: order.priced.map((it) => ({ name: it.name, qty: it.qty || 1, price: it.price })),
      subtotal: order.subtotal,
      deliveryFee: order.deliveryFee,
      total: order.subtotal + order.deliveryFee,
      paymentMethod: method,
      pickupAddress: pickupAddressFor(order.priced),
      address: loc ? loc.address : null,
      addressLabel: chosenAddress ? chosenAddress.label : null,
      etaMin: loc ? loc.eta_min : "20-30",
      scheduledFor: order.scheduledFor,
    });
  }

  const planRow = db.prepare("SELECT * FROM weekly_plans WHERE window_id = ? AND user_id = ?").get(window.id, userId);
  res.json({
    planId: planRow.id,
    slotId,
    weekStartDate: window.week_start_date,
    fee: { mode: fee.mode, total: fee.total },
    orders: created.map((o) => ({
      dayIndex: o.dayIndex, date: o.date, orderId: o.orderId, orderNumber: o.orderNumber,
      deliveryOtp: o.deliveryOtp, deliveryFee: o.deliveryFee, total: o.subtotal + o.deliveryFee,
    })),
  });
});

// Cancel a week before the cutoff. Without this, "edit your plan" leaves
// someone holding orders they have no way to call off.
app.delete("/api/weekly/plans/:id", (req, res) => {
  const id = Number(req.params.id);
  const userId = Number(req.query.userId || (req.body || {}).userId);
  const plan = db.prepare("SELECT * FROM weekly_plans WHERE id = ? AND user_id = ?").get(id, userId);
  if (!plan) return res.status(404).json({ error: "That plan isn't yours, or no longer exists." });

  const window = db.prepare("SELECT * FROM weekly_windows WHERE id = ?").get(plan.window_id);
  if (!isWindowOpen(window)) {
    return res.status(409).json({ error: "This week has closed — get in touch if you need to cancel.", weeklyClosed: true });
  }
  const started = db
    .prepare("SELECT COUNT(*) AS n FROM orders WHERE weekly_window_id = ? AND user_id = ? AND (driver_id IS NOT NULL OR status != 'placed')")
    .get(plan.window_id, userId).n;
  if (started > 0) return res.status(409).json({ error: "Part of this week is already being delivered.", planLocked: true });

  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE weekly_window_id = ? AND user_id = ?)").run(plan.window_id, userId);
    db.prepare("DELETE FROM orders WHERE weekly_window_id = ? AND user_id = ?").run(plan.window_id, userId);
    db.prepare("DELETE FROM weekly_plans WHERE id = ?").run(plan.id);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    return res.status(400).json({ error: "Could not cancel that week: " + err.message });
  }
  res.json({ ok: true });
});

// Every order in a window, for the owner's review list.
app.get("/api/admin/weekly/windows/:id/orders", (req, res) => {
  const id = Number(req.params.id);
  const orders = db
    .prepare(
      `SELECT orders.*, users.name AS customer_name, users.phone AS customer_phone, drivers.name AS driver_name
       FROM orders
       LEFT JOIN users ON users.id = orders.user_id
       LEFT JOIN drivers ON drivers.id = orders.driver_id
       WHERE orders.weekly_window_id = ?
       ORDER BY orders.scheduled_for ASC, orders.route_position IS NULL, orders.route_position ASC, orders.id ASC`
    )
    .all(id);
  const itemsStmt = db.prepare("SELECT * FROM order_items WHERE order_id = ?");
  res.json(orders.map((o) => ({ ...withoutOtp(o), items: itemsStmt.all(o.id) })));
});

/* Shared by preview and commit so a preview can never show something
   different from what committing actually produces. Scoped to ONE delivery
   day: a week's stops are routed a day at a time, because Monday's van run and
   Friday's are separate journeys. lib/route.js needs no say in this — it just
   takes whatever list it's handed. */
function buildWeeklyRoutes(windowId, deliveryDate, driverIds, maxPerDriver) {
  const orders = db
    .prepare(
      // substr rather than date(): scheduled_for is "YYYY-MM-DD HH:MM" local
      // wall-clock text, and substr can't reinterpret it as anything else.
      `SELECT orders.*, users.name AS customer_name, users.phone AS customer_phone
       FROM orders LEFT JOIN users ON users.id = orders.user_id
       WHERE orders.weekly_window_id = ? AND substr(orders.scheduled_for, 1, 10) = ?`
    )
    .all(windowId, deliveryDate);
  const ids = (driverIds || []).map(Number);
  const validDrivers = ids.length
    ? db.prepare(`SELECT * FROM drivers WHERE id IN (${ids.map(() => "?").join(",")}) AND status = 'approved'`).all(...ids)
    : [];
  if (validDrivers.length !== ids.length) throw new Error("Only approved drivers can be assigned a route.");

  const { routes, unlocatedCount } = assignRoutes(orders, ids, Number(maxPerDriver));
  const driverById = new Map(validDrivers.map((d) => [d.id, d]));
  return {
    routes: routes.map((r) => ({
      driverId: r.driverId,
      driverName: driverById.get(r.driverId).name,
      stops: r.stops.map((o, i) => ({ ...withoutOtp(o), routePosition: i + 1 })),
      totalDistanceKm: routeDistanceKm(r.stops),
    })),
    unlocatedCount,
    totalOrders: orders.length,
    deliveryDate,
  };
}

// The delivery date must be one of this window's own seven days — otherwise a
// typo would silently route an empty day.
function weeklyDayOrError(window, deliveryDate) {
  const day = weekDates(window.week_start_date).find((d) => d.date === deliveryDate);
  if (!day) throw new Error("That date isn't one of this week's delivery days.");
  return day;
}

// Computes a day's route split without saving anything, so the owner can see
// it before committing.
app.post("/api/admin/weekly/windows/:id/preview-routes", (req, res) => {
  const id = Number(req.params.id);
  const w = db.prepare("SELECT * FROM weekly_windows WHERE id = ?").get(id);
  if (!w) return res.status(404).json({ error: "No such weekly window." });
  if (w.status === "open") return res.status(409).json({ error: "Close the week to new plans before assigning routes." });
  try {
    weeklyDayOrError(w, req.body.deliveryDate);
    res.json(buildWeeklyRoutes(id, req.body.deliveryDate, req.body.driverIds, req.body.maxPerDriver));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/admin/weekly/windows/:id/assign-routes", (req, res) => {
  const id = Number(req.params.id);
  const w = db.prepare("SELECT * FROM weekly_windows WHERE id = ?").get(id);
  if (!w) return res.status(404).json({ error: "No such weekly window." });
  if (w.status === "open") return res.status(409).json({ error: "Close the week to new plans before assigning routes." });

  const deliveryDate = req.body.deliveryDate;
  try {
    weeklyDayOrError(w, deliveryDate);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  /* Re-running a day is allowed — it's how the owner fixes a wrong driver pick
     — but only until a driver has actually started on that day's stops. The
     guard is per day, so Monday being underway never blocks routing Friday. */
  const started = db
    .prepare("SELECT COUNT(*) AS n FROM orders WHERE weekly_window_id = ? AND substr(scheduled_for, 1, 10) = ? AND status != 'placed'")
    .get(id, deliveryDate).n;
  if (started > 0) {
    return res.status(409).json({ error: "That day's deliveries are already underway — its routes can't be reassigned now." });
  }

  let result;
  try {
    result = buildWeeklyRoutes(id, deliveryDate, req.body.driverIds, req.body.maxPerDriver);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  db.exec("BEGIN");
  try {
    const setRoute = db.prepare("UPDATE orders SET driver_id = ?, route_position = ? WHERE id = ?");
    for (const route of result.routes) {
      for (const stop of route.stops) setRoute.run(route.driverId, stop.routePosition, stop.id);
    }
    // Remembered only to prefill the box next time — a week has no single
    // "routed" moment now that each day is routed on its own.
    db.prepare("UPDATE weekly_windows SET max_per_driver = ? WHERE id = ?").run(Number(req.body.maxPerDriver), id);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    return res.status(400).json({ error: "Could not save the route assignment: " + err.message });
  }
  res.json(result);
});

// All orders across all customers — for the owner's dashboard (admin.html).
app.get("/api/orders", (req, res) => {
  const orders = db
    .prepare(
      `SELECT orders.*, users.name AS customer_name, users.phone AS customer_phone,
              drivers.name AS driver_name
       FROM orders
       LEFT JOIN users ON users.id = orders.user_id
       LEFT JOIN drivers ON drivers.id = orders.driver_id
       ORDER BY orders.id DESC`
    )
    .all();
  const itemsStmt = db.prepare("SELECT * FROM order_items WHERE order_id = ?");
  // Unfiltered on purpose: the owner needs to see scheduled orders well ahead
  // of their slot in order to prep for them.
  res.json(orders.map((o) => ({ ...withoutOtp(o), items: itemsStmt.all(o.id) })));
});

// Orders nobody has picked up yet — the driver app's job board.
// Registered before /api/orders/:userId, otherwise "available" would be
// swallowed by that route and parsed as a (NaN) user id.
app.get("/api/orders/available", (req, res) => {
  const orders = db
    .prepare(
      // weekly_window_id IS NULL: a weekly grocery order is never
      // self-claimed off this board — it only gets a driver through the
      // owner's route-assignment step, so a driver can't cherry-pick
      // individual weekly stops and defeat the whole point of routing them.
      `SELECT * FROM orders
       WHERE driver_id IS NULL AND status != 'delivered' AND weekly_window_id IS NULL
       ORDER BY id ASC`
    )
    .all();
  const itemsStmt = db.prepare("SELECT * FROM order_items WHERE order_id = ?");
  /* A scheduled order stays off the driver board until its slot is close.
     Showing a 7pm delivery at 10am invites a driver to claim it and then sit
     on it, which looks like progress while nothing is actually moving. */
  const due = orders.filter((o) => isDueForDispatch(o.scheduled_for));
  res.json(due.map((o) => {
    const items = itemsStmt.all(o.id);
    return { ...withoutOtp(o), items, pickupAddress: pickupAddressFor(items) };
  }));
});

// Order history for a single user.
app.get("/api/orders/:userId", (req, res) => {
  const userId = Number(req.params.userId);
  const orders = db.prepare("SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC").all(userId);
  const itemsStmt = db.prepare("SELECT * FROM order_items WHERE order_id = ?");
  res.json(orders.map((o) => ({ ...o, items: itemsStmt.all(o.id) })));
});

// Update an order's status (owner dashboard use).
// The four steps a customer sees on their tracker. Anything outside this list
// would render as an unknown step, so it is rejected rather than stored.
const ORDER_STATUSES = ["placed", "preparing", "out for delivery", "delivered"];

app.patch("/api/orders/:id/status", (req, res) => {
  const id = Number(req.params.id);
  const { status } = req.body || {};
  if (!status) return res.status(400).json({ error: "status is required" });
  if (!ORDER_STATUSES.includes(status)) {
    return res.status(400).json({ error: `Unknown status. Expected one of: ${ORDER_STATUSES.join(", ")}.` });
  }
  const existing = db.prepare("SELECT * FROM orders WHERE id = ?").get(id);
  if (!existing) return res.status(404).json({ error: "No such order." });

  // Reaching 'delivered' through here would skip the handover code entirely,
  // which is the one thing that makes 'delivered' mean anything.
  db.prepare(
    status === "delivered"
      ? "UPDATE orders SET status = ?, delivered_at = COALESCE(delivered_at, datetime('now')) WHERE id = ?"
      : "UPDATE orders SET status = ? WHERE id = ?"
  ).run(status, id);
  // Skip the ping if the owner just re-clicked the status it's already at —
  // the customer doesn't need to hear "your order is preparing" twice.
  if (existing.status !== status) notifyN8nStatus(existing, status);
  res.json({ id, status });
});

/* A driver marking an order collected. Claiming an order is not the same as
   having it in your hands, so this is a separate, driver-driven step rather
   than something inferred from the claim. */
app.patch("/api/orders/:id/pickup", (req, res) => {
  const id = Number(req.params.id);
  const { driverId } = req.body || {};
  const order = db.prepare("SELECT * FROM orders WHERE id = ? AND driver_id = ?").get(id, Number(driverId));
  if (!order) return res.status(403).json({ error: "That order isn't assigned to you." });
  if (order.status === "delivered") return res.status(409).json({ error: "That order is already delivered." });
  db.prepare("UPDATE orders SET status = 'out for delivery' WHERE id = ? AND driver_id = ?").run(id, Number(driverId));
  if (order.status !== "out for delivery") notifyN8nStatus(order, "out for delivery");
  res.json({ id, status: "out for delivery" });
});

// Submit a delivery-driver application (public — no login required).
app.post("/api/drivers", (req, res) => {
  const { name, phone, vehicleType, area, availability, notes } = req.body || {};
  if (!name || !phone || !vehicleType) {
    return res.status(400).json({ error: "Name, phone, and vehicle type are required." });
  }
  const info = db
    .prepare(
      `INSERT INTO drivers (name, phone, vehicle_type, area, availability, notes)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(name, phone, vehicleType, area || null, availability || null, notes || null);
  res.json(db.prepare("SELECT * FROM drivers WHERE id = ?").get(info.lastInsertRowid));
});

// All driver applications, newest first — owner dashboard use.
/* ---- Owner earnings ------------------------------------------------------
   What WarpX actually keeps, as opposed to what customers hand over. Most of
   an order's subtotal belongs to the cafe or the shop it came from — the only
   parts that are WarpX's are the delivery fee and the margin baked into
   Picasso Cafe's listed prices. Driver pay comes straight back out of that. */

// Must match the markup already added into js/menu-data.js prices.
const FOOD_MARGIN_PER_ITEM = 15;

function earningsBetween(sinceExpr) {
  // sinceExpr is a SQLite date() expression, or null for all time.
  const dayCol = "date(COALESCE(o.delivered_at, o.created_at), 'localtime')";
  const where = sinceExpr ? `AND ${dayCol} >= ${sinceExpr}` : "";

  const totals = db
    .prepare(
      `SELECT COUNT(*) AS orders,
              COALESCE(SUM(o.total), 0) AS gross,
              COALESCE(SUM(o.subtotal), 0) AS goods,
              COALESCE(SUM(o.delivery_fee), 0) AS fees
       FROM orders o WHERE 1=1 ${where}`
    )
    .get();

  // Margin applies per priced cafe item; custom cafe requests carry no price
  // yet, so they carry no margin either.
  const margin = db
    .prepare(
      `SELECT COALESCE(SUM(oi.qty), 0) AS units
       FROM order_items oi JOIN orders o ON o.id = oi.order_id
       WHERE oi.service = 'food' AND oi.price IS NOT NULL ${where}`
    )
    .get().units * FOOD_MARGIN_PER_ITEM;

  /* Driver pay is settled per driver per day, because the tier that pays is
     the one they finished that day on — so it cannot be derived from a single
     total and has to be grouped the same way the Driver Hub groups it. */
  const dayRows = db
    .prepare(
      `SELECT o.driver_id AS driverId, ${dayCol} AS day,
              COUNT(*) AS n, COALESCE(SUM(o.delivery_fee), 0) AS fees
       FROM orders o
       WHERE o.status = 'delivered' AND o.driver_id IS NOT NULL ${where}
       GROUP BY o.driver_id, day`
    )
    .all();
  const driverPay = dayRows.reduce(
    (sum, r) => sum + payFor({ deliveries: r.n, feeTotal: r.fees, percent: tierFor(r.n).percent }).total,
    0
  );

  const revenue = totals.fees + margin;
  const round = (v) => Math.round(v * 100) / 100;
  return {
    orders: totals.orders,
    gross: round(totals.gross),
    goods: round(totals.goods),
    deliveryFees: round(totals.fees),
    foodMargin: round(margin),
    revenue: round(revenue),
    driverPay: round(driverPay),
    net: round(revenue - driverPay),
    deliveries: dayRows.reduce((n, r) => n + r.n, 0),
  };
}

/* ---- Driver payouts ------------------------------------------------------
   The earnings panel says what is owed in total; this says who is owed it and
   whether they have been paid. Owed is always recomputed from delivered
   orders using the same tierFor + payFor grouping the Driver Hub uses, so the
   ledger and the driver's own screen can never disagree. */

function payoutRows() {
  const days = db
    .prepare(
      `SELECT o.driver_id AS driverId, d.name AS driverName, d.phone AS driverPhone,
              date(COALESCE(o.delivered_at, o.created_at), 'localtime') AS day,
              COUNT(*) AS deliveries, COALESCE(SUM(o.delivery_fee), 0) AS fees
       FROM orders o JOIN drivers d ON d.id = o.driver_id
       WHERE o.status = 'delivered' AND o.driver_id IS NOT NULL
       GROUP BY o.driver_id, day
       ORDER BY day DESC, d.name ASC`
    )
    .all();

  const paidStmt = db.prepare("SELECT * FROM payouts WHERE driver_id = ? AND day = ?");
  return days.map((r) => {
    const progress = tierFor(r.deliveries);
    const pay = payFor({ deliveries: r.deliveries, feeTotal: r.fees, percent: progress.percent });
    const paid = paidStmt.get(r.driverId, r.day);
    return {
      driverId: r.driverId, driverName: r.driverName, driverPhone: r.driverPhone,
      day: r.day, deliveries: r.deliveries, fees: Math.round(r.fees * 100) / 100,
      tier: progress.tier, percent: progress.percent,
      base: pay.base, bonus: pay.bonus, amount: pay.total,
      paid: !!paid,
      paidAt: paid ? paid.paid_at : null,
      paidAmount: paid ? paid.amount : null,
      payoutId: paid ? paid.id : null,
    };
  });
}

app.get("/api/admin/payouts", (req, res) => {
  const rows = payoutRows();
  const round = (v) => Math.round(v * 100) / 100;
  res.json({
    rows,
    outstanding: round(rows.filter((r) => !r.paid).reduce((s, r) => s + r.amount, 0)),
    settled: round(rows.filter((r) => r.paid).reduce((s, r) => s + r.paidAmount, 0)),
    total: round(rows.reduce((s, r) => s + r.amount, 0)),
  });
});

app.post("/api/admin/payouts", (req, res) => {
  const { driverId, day, note } = req.body || {};
  const row = payoutRows().find((r) => r.driverId === Number(driverId) && r.day === day);
  if (!row) return res.status(404).json({ error: "No deliveries for that driver on that day." });
  if (row.paid) return res.status(409).json({ error: "That day is already marked paid." });

  // The amount is taken from the freshly computed row, never from the request,
  // so a payout can't be recorded for a figure that was never owed.
  try {
    const info = db
      .prepare("INSERT INTO payouts (driver_id, day, deliveries, fees, percent, amount, note) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(row.driverId, row.day, row.deliveries, row.fees, row.percent, row.amount, note || null);
    res.json({ id: info.lastInsertRowid, ...row, paid: true, paidAmount: row.amount });
  } catch (err) {
    // The unique index is the real guard against a double payment racing in.
    return res.status(409).json({ error: "That day is already marked paid." });
  }
});

app.delete("/api/admin/payouts/:id", (req, res) => {
  const info = db.prepare("DELETE FROM payouts WHERE id = ?").run(Number(req.params.id));
  if (info.changes === 0) return res.status(404).json({ error: "No such payout record." });
  res.json({ ok: true });
});

// A driver's own settlement history — the side that actually cares.
app.get("/api/drivers/:id/payouts", (req, res) => {
  const id = Number(req.params.id);
  const rows = payoutRows().filter((r) => r.driverId === id);
  const round = (v) => Math.round(v * 100) / 100;
  res.json({
    rows,
    pending: round(rows.filter((r) => !r.paid).reduce((s, r) => s + r.amount, 0)),
    received: round(rows.filter((r) => r.paid).reduce((s, r) => s + r.paidAmount, 0)),
  });
});

app.get("/api/admin/earnings", (req, res) => {
  res.json({
    today: earningsBetween("date('now', 'localtime')"),
    week: earningsBetween("date('now', 'localtime', '-6 days')"),
    month: earningsBetween("date('now', 'localtime', '-29 days')"),
    all: earningsBetween(null),
    foodMarginPerItem: FOOD_MARGIN_PER_ITEM,
    basePerDelivery: BASE_PAY_PER_DELIVERY,
  });
});

app.get("/api/drivers", (req, res) => {
  res.json(db.prepare("SELECT * FROM drivers ORDER BY id DESC").all());
});

// Approve/reject a driver application.
app.patch("/api/drivers/:id/status", (req, res) => {
  const id = Number(req.params.id);
  const { status } = req.body || {};
  if (!["pending", "approved", "rejected"].includes(status)) {
    return res.status(400).json({ error: "status must be pending, approved, or rejected" });
  }
  db.prepare("UPDATE drivers SET status = ? WHERE id = ?").run(status, id);
  res.json({ id, status });
});

// Driver sign-in for driver.html. Phone-only on purpose: drivers never set a
// password (they only ever filled in the careers form), so this identifies
// rather than authenticates — see the README's caveat about that.
app.post("/api/drivers/login", (req, res) => {
  const { phone } = req.body || {};
  if (!phone) return res.status(400).json({ error: "Enter the mobile number you applied with." });

  const driver = db.prepare("SELECT * FROM drivers WHERE phone = ? ORDER BY id DESC").get(phone);
  if (!driver) {
    return res.status(404).json({ error: "No application found for that number — apply on the Work With Us page first." });
  }
  if (driver.status === "pending") {
    return res.status(403).json({ error: "Your application is still being reviewed. We'll call you once it's approved." });
  }
  if (driver.status === "rejected") {
    return res.status(403).json({ error: "This application wasn't approved. Get in touch if you think that's a mistake." });
  }
  res.json({ id: driver.id, name: driver.name, phone: driver.phone, vehicleType: driver.vehicle_type });
});

// A driver's own dashboard data: their progress tier plus the orders they're
// currently carrying.
/* The tier ladder resets nightly, so "completed" means completed TODAY.
   Timestamps are stored UTC (datetime('now')); 'localtime' shifts them into
   the shop's day before the date comparison, so a delivery at 11pm counts
   toward that evening rather than the next morning. Legacy rows delivered
   before delivered_at existed fall back to created_at rather than vanishing. */
function driverDayStats(driverId) {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(delivery_fee), 0) AS fees
       FROM orders
       WHERE driver_id = ? AND status = 'delivered'
         AND date(COALESCE(delivered_at, created_at), 'localtime') = date('now', 'localtime')`
    )
    .get(driverId);
  const lifetime = db
    .prepare("SELECT COUNT(*) AS n FROM orders WHERE driver_id = ? AND status = 'delivered'")
    .get(driverId).n;
  return { today: row.n, feesToday: row.fees, lifetime };
}

// Seconds until the count zeroes, so the hub can show a live countdown
// without having to agree with the server about timezones.
function secondsUntilReset(now = new Date()) {
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
  return Math.max(0, Math.round((midnight.getTime() - now.getTime()) / 1000));
}

app.get("/api/drivers/:id/summary", (req, res) => {
  const id = Number(req.params.id);
  const driver = db.prepare("SELECT * FROM drivers WHERE id = ?").get(id);
  if (!driver) return res.status(404).json({ error: "Driver not found." });

  const stats = driverDayStats(id);
  const progress = tierFor(stats.today);
  const pay = payFor({ deliveries: stats.today, feeTotal: stats.feesToday, percent: progress.percent });

  const active = db
    .prepare("SELECT * FROM orders WHERE driver_id = ? AND weekly_window_id IS NULL AND status != 'delivered' ORDER BY id ASC")
    .all(id);
  // Ordered day by day, then along each day's route. The date lives on the
  // order's own scheduled_for now, so no join back to the window is needed.
  const weeklyStopRows = db
    .prepare(
      `SELECT * FROM orders
       WHERE driver_id = ? AND weekly_window_id IS NOT NULL AND status != 'delivered'
       ORDER BY scheduled_for ASC, route_position ASC`
    )
    .all(id);
  const itemsStmt = db.prepare("SELECT * FROM order_items WHERE order_id = ?");

  res.json({
    driver: { id: driver.id, name: driver.name, phone: driver.phone, vehicleType: driver.vehicle_type },
    progress,
    pay,
    // What one more average-fee delivery would add, promotion included.
    nextDeliveryWorth: payIfOneMore({ deliveries: stats.today, feeTotal: stats.feesToday, fee: 30 }),
    basePerDelivery: BASE_PAY_PER_DELIVERY,
    lifetimeDeliveries: stats.lifetime,
    resetsInSeconds: secondsUntilReset(),
    active: active.map((o) => {
      const items = itemsStmt.all(o.id);
      return { ...withoutOtp(o), items, pickupAddress: pickupAddressFor(items) };
    }),
    weeklyStops: weeklyStopRows.map((o) => {
      const items = itemsStmt.all(o.id);
      return { ...withoutOtp(o), items, pickupAddress: pickupAddressFor(items) };
    }),
  });
});

// Claim an unassigned order. The `driver_id IS NULL` guard in the UPDATE is
// what stops two drivers grabbing the same order — whoever's write lands
// second changes 0 rows and gets told it's already taken.
app.patch("/api/orders/:id/claim", (req, res) => {
  const id = Number(req.params.id);
  const { driverId } = req.body || {};
  const driver = db.prepare("SELECT * FROM drivers WHERE id = ?").get(driverId);
  if (!driver || driver.status !== "approved") {
    return res.status(403).json({ error: "Only approved drivers can accept orders." });
  }
  const info = db
    .prepare("UPDATE orders SET driver_id = ? WHERE id = ? AND driver_id IS NULL AND status != 'delivered'")
    .run(driverId, id);
  if (info.changes === 0) {
    return res.status(409).json({ error: "Another driver just took that one." });
  }
  res.json(withoutOtp(db.prepare("SELECT * FROM orders WHERE id = ?").get(id)));
});

// Mark one of your own orders delivered — this is what moves the progress bar.
// Requires the customer's handover OTP, so "delivered" means the customer
// actually confirmed it rather than the driver just saying so.
app.patch("/api/orders/:id/deliver", (req, res) => {
  const id = Number(req.params.id);
  const { driverId, otp } = req.body || {};

  const order = db.prepare("SELECT * FROM orders WHERE id = ? AND driver_id = ?").get(id, driverId);
  if (!order) return res.status(403).json({ error: "That order isn't assigned to you." });
  if (order.status === "delivered") return res.status(409).json({ error: "That order is already marked delivered." });

  // Orders placed before delivery codes existed have no OTP to check, so they
  // stay completable rather than being stranded forever.
  if (order.delivery_otp) {
    const given = String(otp || "").trim();
    if (!given) return res.status(400).json({ error: "Ask the customer for their 4-digit delivery code." });
    if (given !== order.delivery_otp) {
      return res.status(401).json({ error: "That code doesn't match. Check it with the customer." });
    }
  }

  const info = db
    .prepare("UPDATE orders SET status = 'delivered', delivered_at = datetime('now') WHERE id = ? AND driver_id = ?")
    .run(id, driverId);
  if (info.changes === 0) {
    return res.status(403).json({ error: "That order isn't assigned to you." });
  }
  notifyN8nStatus(order, "delivered");
  const stats = driverDayStats(driverId);
  res.json({ id, status: "delivered", progress: tierFor(stats.today) });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n  WarpX is running → http://localhost:${PORT}\n`);
});
