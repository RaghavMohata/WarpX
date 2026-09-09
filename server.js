/* WarpX local server — serves the static site and a small JSON API
   backed by SQLite (warpx.db, created automatically on first run). */
const express = require("express");
const crypto = require("crypto");
const path = require("path");
const db = require("./db");
const { classifyZone } = require("./lib/zone");
const { hashPassword, verifyPassword } = require("./lib/auth");
const { tierFor, payFor, payIfOneMore, BASE_PAY_PER_DELIVERY } = require("./lib/tier");
const { feeFor } = require("./lib/fee");
const { validateSchedule, isDueForDispatch } = require("./lib/schedule");

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
  }

  const subtotal = items.reduce((sum, it) => sum + (Number(it.price) || 0) * (it.qty || 1), 0);
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
    for (const it of items) {
      if (!it.service || !it.name) throw new Error("each item needs a service and a name");
      insertItem.run(orderId, it.service, it.name, it.price ?? null, it.qty || 1, it.note || null);
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
app.patch("/api/orders/:id/status", (req, res) => {
  const id = Number(req.params.id);
  const { status } = req.body || {};
  if (!status) return res.status(400).json({ error: "status is required" });
  db.prepare("UPDATE orders SET status = ? WHERE id = ?").run(status, id);
  res.json({ id, status });
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
