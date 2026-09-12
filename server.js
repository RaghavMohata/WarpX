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
const { feeFor } = require("./lib/fee");
const { validateSchedule, isDueForDispatch, isOpenNow, nextOpeningSlot,
        SCHEDULE_OPEN_HOUR, SCHEDULE_CLOSE_HOUR } = require("./lib/schedule");
const { PICASSO_MENU } = require("./js/menu-data");

const app = express();
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

// Place an order — computes totals server-side and persists items.
// Requires a logged-in account: orders are never anonymous.
app.post("/api/orders", (req, res) => {
  const { userId, items, paymentMethod, upiId, addressId, scheduleDate, scheduleTime } = req.body || {};
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "items are required" });
  }
  if (!userId) return res.status(401).json({ error: "Please log in to place an order." });
  const user = db.prepare("SELECT id FROM users WHERE id = ?").get(userId);
  if (!user) return res.status(401).json({ error: "Please log in to place an order." });

  const method = paymentMethod === "upi" ? "upi" : "cod";

  /* An order is either ASAP (no slot) or scheduled. The browser validates the
     same way via lib/schedule.js, but this is the check that counts — it runs
     against the server's clock, which is the one dispatch actually uses. */
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
  /* Where this order is going, in order of preference: the address the
     customer picked at checkout, their default saved address, and finally the
     last raw GPS capture — so someone who has never saved an address still
     orders exactly as they did before. */
  let chosenAddress = null;
  if (addressId != null) {
    chosenAddress = db.prepare("SELECT * FROM addresses WHERE id = ? AND user_id = ?").get(Number(addressId), userId);
  }
  if (!chosenAddress) {
    chosenAddress = db.prepare("SELECT * FROM addresses WHERE user_id = ? AND is_default = 1").get(userId);
  }
  const loc = chosenAddress || getLatestLocation(userId);
  const etaMin = loc ? loc.eta_min : "20-30";
  const orderNumber = "WPX" + Math.floor(100000 + Math.random() * 900000);
  // 4-digit handover code, only ever shown to the customer.
  const deliveryOtp = String(crypto.randomInt(1000, 10000));

  // Order + its line items must land together — wrap in a transaction so a
  // failure partway through (e.g. a bad item) never leaves an order with
  // some items missing.
  let orderId;
  db.exec("BEGIN");
  try {
    const orderInfo = db
      .prepare(
        `INSERT INTO orders (order_number, user_id, subtotal, delivery_fee, total, eta_min, payment_method, upi_id, lat, lng, address, delivery_otp, address_label, scheduled_for)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        orderNumber, userId, subtotal, deliveryFee, total, etaMin, method,
        method === "upi" ? upiId || null : null,
        loc ? loc.lat : null, loc ? loc.lng : null, loc ? loc.address : null,
        deliveryOtp,
        chosenAddress ? chosenAddress.label : null,
        scheduledFor
      );
    orderId = orderInfo.lastInsertRowid;

    const insertItem = db.prepare(
      "INSERT INTO order_items (order_id, service, name, price, qty, note) VALUES (?, ?, ?, ?, ?, ?)"
    );
    for (const it of priced) {
      if (!it.service || !it.name) throw new Error("each item needs a service and a name");
      insertItem.run(orderId, it.service, it.name, it.price, it.qty || 1, it.note || null);
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    return res.status(400).json({ error: "Could not place order: " + err.message });
  }

  res.json({ orderId, orderNumber, subtotal, deliveryFee, total, etaMin, paymentMethod: method, status: "placed", deliveryOtp, addressLabel: chosenAddress ? chosenAddress.label : null, scheduledFor });
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
      `SELECT * FROM orders
       WHERE driver_id IS NULL AND status != 'delivered'
       ORDER BY id ASC`
    )
    .all();
  const itemsStmt = db.prepare("SELECT * FROM order_items WHERE order_id = ?");
  /* A scheduled order stays off the driver board until its slot is close.
     Showing a 7pm delivery at 10am invites a driver to claim it and then sit
     on it, which looks like progress while nothing is actually moving. */
  const due = orders.filter((o) => isDueForDispatch(o.scheduled_for));
  res.json(due.map((o) => ({ ...withoutOtp(o), items: itemsStmt.all(o.id) })));
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
  const existing = db.prepare("SELECT id FROM orders WHERE id = ?").get(id);
  if (!existing) return res.status(404).json({ error: "No such order." });

  // Reaching 'delivered' through here would skip the handover code entirely,
  // which is the one thing that makes 'delivered' mean anything.
  db.prepare(
    status === "delivered"
      ? "UPDATE orders SET status = ?, delivered_at = COALESCE(delivered_at, datetime('now')) WHERE id = ?"
      : "UPDATE orders SET status = ? WHERE id = ?"
  ).run(status, id);
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
    .prepare("SELECT * FROM orders WHERE driver_id = ? AND status != 'delivered' ORDER BY id ASC")
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
    active: active.map((o) => ({ ...withoutOtp(o), items: itemsStmt.all(o.id) })),
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
  const stats = driverDayStats(driverId);
  res.json({ id, status: "delivered", progress: tierFor(stats.today) });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n  WarpX is running → http://localhost:${PORT}\n`);
});
