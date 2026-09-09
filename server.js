/* WarpX local server — serves the static site and a small JSON API
   backed by SQLite (warpx.db, created automatically on first run). */
const express = require("express");
const path = require("path");
const db = require("./db");
const { classifyZone } = require("./lib/zone");
const { hashPassword, verifyPassword } = require("./lib/auth");
const { tierFor } = require("./lib/tier");

const app = express();
app.use(express.json());
app.use(express.static(__dirname));

function getLatestLocation(userId) {
  return db.prepare("SELECT * FROM locations WHERE user_id = ? ORDER BY id DESC LIMIT 1").get(userId);
}

function publicUser(row) {
  return { id: row.id, name: row.name, phone: row.phone };
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

// Place an order — computes totals server-side and persists items.
// Requires a logged-in account: orders are never anonymous.
app.post("/api/orders", (req, res) => {
  const { userId, items, paymentMethod, upiId } = req.body || {};
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "items are required" });
  }
  if (!userId) return res.status(401).json({ error: "Please log in to place an order." });
  const user = db.prepare("SELECT id FROM users WHERE id = ?").get(userId);
  if (!user) return res.status(401).json({ error: "Please log in to place an order." });

  const method = paymentMethod === "upi" ? "upi" : "cod";

  const subtotal = items.reduce((sum, it) => sum + (Number(it.price) || 0) * (it.qty || 1), 0);
  const deliveryFee = 20;
  const total = subtotal + deliveryFee;
  const loc = getLatestLocation(userId);
  const etaMin = loc ? loc.eta_min : "20-30";
  const orderNumber = "WPX" + Math.floor(100000 + Math.random() * 900000);

  // Order + its line items must land together — wrap in a transaction so a
  // failure partway through (e.g. a bad item) never leaves an order with
  // some items missing.
  let orderId;
  db.exec("BEGIN");
  try {
    const orderInfo = db
      .prepare(
        `INSERT INTO orders (order_number, user_id, subtotal, delivery_fee, total, eta_min, payment_method, upi_id, lat, lng, address)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        orderNumber, userId, subtotal, deliveryFee, total, etaMin, method,
        method === "upi" ? upiId || null : null,
        loc ? loc.lat : null, loc ? loc.lng : null, loc ? loc.address : null
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

  res.json({ orderId, orderNumber, subtotal, deliveryFee, total, etaMin, paymentMethod: method, status: "placed" });
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
  res.json(orders.map((o) => ({ ...o, items: itemsStmt.all(o.id) })));
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
  res.json(orders.map((o) => ({ ...o, items: itemsStmt.all(o.id) })));
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
app.get("/api/drivers/:id/summary", (req, res) => {
  const id = Number(req.params.id);
  const driver = db.prepare("SELECT * FROM drivers WHERE id = ?").get(id);
  if (!driver) return res.status(404).json({ error: "Driver not found." });

  const completed = db
    .prepare("SELECT COUNT(*) AS n FROM orders WHERE driver_id = ? AND status = 'delivered'")
    .get(id).n;

  const active = db
    .prepare("SELECT * FROM orders WHERE driver_id = ? AND status != 'delivered' ORDER BY id ASC")
    .all(id);
  const itemsStmt = db.prepare("SELECT * FROM order_items WHERE order_id = ?");

  res.json({
    driver: { id: driver.id, name: driver.name, phone: driver.phone, vehicleType: driver.vehicle_type },
    progress: tierFor(completed),
    active: active.map((o) => ({ ...o, items: itemsStmt.all(o.id) })),
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
  res.json(db.prepare("SELECT * FROM orders WHERE id = ?").get(id));
});

// Mark one of your own orders delivered — this is what moves the progress bar.
app.patch("/api/orders/:id/deliver", (req, res) => {
  const id = Number(req.params.id);
  const { driverId } = req.body || {};
  const info = db
    .prepare("UPDATE orders SET status = 'delivered' WHERE id = ? AND driver_id = ?")
    .run(id, driverId);
  if (info.changes === 0) {
    return res.status(403).json({ error: "That order isn't assigned to you." });
  }
  const completed = db
    .prepare("SELECT COUNT(*) AS n FROM orders WHERE driver_id = ? AND status = 'delivered'")
    .get(driverId).n;
  res.json({ id, status: "delivered", progress: tierFor(completed) });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n  WarpX is running → http://localhost:${PORT}\n`);
});
