/* WarpX database — a single local SQLite file (warpx.db), using Node's
   built-in node:sqlite module. No install, no separate DB server. */
const { DatabaseSync } = require("node:sqlite");
const path = require("path");

const db = new DatabaseSync(path.join(__dirname, "warpx.db"));

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    phone TEXT UNIQUE NOT NULL,
    password_hash TEXT,
    password_salt TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS locations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    method TEXT,
    accuracy REAL,
    address TEXT,
    zone TEXT,
    distance_km REAL,
    eta_min TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_number TEXT UNIQUE NOT NULL,
    user_id INTEGER REFERENCES users(id),
    status TEXT DEFAULT 'placed',
    subtotal REAL NOT NULL,
    delivery_fee REAL NOT NULL,
    total REAL NOT NULL,
    eta_min TEXT,
    payment_method TEXT DEFAULT 'cod',
    upi_id TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL REFERENCES orders(id),
    service TEXT NOT NULL,
    name TEXT NOT NULL,
    price REAL,
    qty INTEGER NOT NULL,
    note TEXT
  );

  -- Every list/lookup query filters by these — cheap now, matters once the
  -- orders table has thousands of rows instead of dozens.
  CREATE INDEX IF NOT EXISTS idx_locations_user_id ON locations(user_id);
  CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
  CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);

  CREATE TABLE IF NOT EXISTS drivers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    vehicle_type TEXT NOT NULL,
    area TEXT,
    availability TEXT,
    notes TEXT,
    status TEXT DEFAULT 'pending',
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

// Safe migrations for a warpx.db created before these columns existed.
for (const col of ["password_hash TEXT", "password_salt TEXT"]) {
  try { db.exec(`ALTER TABLE users ADD COLUMN ${col}`); } catch (e) {}
}
for (const col of ["payment_method TEXT DEFAULT 'cod'", "upi_id TEXT"]) {
  try { db.exec(`ALTER TABLE orders ADD COLUMN ${col}`); } catch (e) {}
}

module.exports = db;
