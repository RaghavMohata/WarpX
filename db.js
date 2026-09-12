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
    lat REAL,
    lng REAL,
    address TEXT,
    driver_id INTEGER REFERENCES drivers(id),
    delivery_otp TEXT,
    scheduled_for TEXT,
    delivered_at TEXT,
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

  /* A record of what has actually been handed to a driver. What they are OWED
     is derived from delivered orders and never stored; this table only records
     settlement, so the two can't drift. One row per driver per day, enforced by
     the unique index below, because that is the unit pay is calculated in. */
  CREATE TABLE IF NOT EXISTS payouts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    driver_id INTEGER NOT NULL REFERENCES drivers(id),
    day TEXT NOT NULL,
    deliveries INTEGER NOT NULL,
    fees REAL NOT NULL,
    percent REAL NOT NULL,
    amount REAL NOT NULL,
    note TEXT,
    paid_at TEXT DEFAULT (datetime('now'))
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_payouts_driver_day ON payouts(driver_id, day);

  CREATE TABLE IF NOT EXISTS addresses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    label TEXT NOT NULL,
    address TEXT,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    zone TEXT,
    distance_km REAL,
    eta_min TEXT,
    is_default INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_addresses_user_id ON addresses(user_id);

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
for (const col of ["password_hash TEXT", "password_salt TEXT", "email TEXT", "google_sub TEXT", "avatar_url TEXT"]) {
  try { db.exec(`ALTER TABLE users ADD COLUMN ${col}`); } catch (e) {}
}
for (const col of ["google_sub TEXT", "email TEXT"]) {
  try { db.exec(`ALTER TABLE drivers ADD COLUMN ${col}`); } catch (e) {}
}
for (const col of ["payment_method TEXT DEFAULT 'cod'", "upi_id TEXT", "lat REAL", "lng REAL", "address TEXT", "driver_id INTEGER REFERENCES drivers(id)", "delivery_otp TEXT", "address_label TEXT", "scheduled_for TEXT", "delivered_at TEXT"]) {
  try { db.exec(`ALTER TABLE orders ADD COLUMN ${col}`); } catch (e) {}
}

// Indexed after the migrations above, so this still works on a warpx.db that
// predates the column it indexes.
try { db.exec("CREATE INDEX IF NOT EXISTS idx_orders_driver_id ON orders(driver_id)"); } catch (e) {}
try { db.exec("CREATE INDEX IF NOT EXISTS idx_orders_scheduled_for ON orders(scheduled_for)"); } catch (e) {}
// The daily tier count filters on this every time a driver page refreshes.
try { db.exec("CREATE INDEX IF NOT EXISTS idx_orders_delivered_at ON orders(delivered_at)"); } catch (e) {}

/* One Google account maps to at most one customer and one driver. Partial, so
   the many rows with no Google account linked don't all collide on NULL. */
try { db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_sub ON users(google_sub) WHERE google_sub IS NOT NULL"); } catch (e) {}
try { db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_drivers_google_sub ON drivers(google_sub) WHERE google_sub IS NOT NULL"); } catch (e) {}

module.exports = db;
