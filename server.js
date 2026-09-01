/* WarpX local server — serves the static site and a small JSON API
   backed by SQLite (warpx.db, created automatically on first run). */
const express = require("express");
const path = require("path");
const db = require("./db");
const { classifyZone } = require("./lib/zone");

const app = express();
app.use(express.json());
app.use(express.static(__dirname));

function getLatestLocation(userId) {
  return db.prepare("SELECT * FROM locations WHERE user_id = ? ORDER BY id DESC LIMIT 1").get(userId);
}

// Create or fetch a user by phone number (demo auth — no real OTP check).
app.post("/api/users", (req, res) => {
  const { name, phone } = req.body || {};
  if (!phone) return res.status(400).json({ error: "phone is required" });

  const existing = db.prepare("SELECT * FROM users WHERE phone = ?").get(phone);
  if (existing) {
    if (name && name !== existing.name) {
      db.prepare("UPDATE users SET name = ? WHERE id = ?").run(name, existing.id);
      existing.name = name;
    }
    return res.json(existing);
  }
  const info = db.prepare("INSERT INTO users (name, phone) VALUES (?, ?)").run(name || null, phone);
  res.json(db.prepare("SELECT * FROM users WHERE id = ?").get(info.lastInsertRowid));
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
app.post("/api/orders", (req, res) => {
  const { userId, items } = req.body || {};
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "items are required" });
  }

  const subtotal = items.reduce((sum, it) => sum + (Number(it.price) || 0) * (it.qty || 1), 0);
  const deliveryFee = 20;
  const total = subtotal + deliveryFee;
  const loc = userId ? getLatestLocation(userId) : null;
  const etaMin = loc ? loc.eta_min : "20-30";
  const orderNumber = "WPX" + Math.floor(100000 + Math.random() * 900000);

  const orderInfo = db
    .prepare(`INSERT INTO orders (order_number, user_id, subtotal, delivery_fee, total, eta_min) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(orderNumber, userId || null, subtotal, deliveryFee, total, etaMin);
  const orderId = orderInfo.lastInsertRowid;

  const insertItem = db.prepare(
    "INSERT INTO order_items (order_id, service, name, price, qty, note) VALUES (?, ?, ?, ?, ?, ?)"
  );
  for (const it of items) {
    insertItem.run(orderId, it.service, it.name, it.price ?? null, it.qty || 1, it.note || null);
  }

  res.json({ orderId, orderNumber, subtotal, deliveryFee, total, etaMin, status: "placed" });
});

// Order history for a user.
app.get("/api/orders/:userId", (req, res) => {
  const userId = Number(req.params.userId);
  const orders = db.prepare("SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC").all(userId);
  const itemsStmt = db.prepare("SELECT * FROM order_items WHERE order_id = ?");
  res.json(orders.map((o) => ({ ...o, items: itemsStmt.all(o.id) })));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n  WarpX is running → http://localhost:${PORT}\n`);
});
