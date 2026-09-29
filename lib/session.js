/* WarpX sessions — who is asking, decided by the server.

   Before this, every request said who it was ("userId": 7, "driverId": 3) and
   the server believed it. Now a login hands the browser a random token in an
   HttpOnly cookie, and the server looks the token up. The browser can't read
   the cookie (so a script injected into a page can't steal it) and can't
   choose what it says.

   One cookie per kind — wx_user, wx_driver, wx_admin — because one browser is
   routinely more than one of them: the owner places a test order, then opens
   the Driver Hub, then the dashboard.

   SameSite=Lax keeps another site from riding these cookies on a POST, PATCH
   or DELETE, and the API only accepts JSON bodies, which a cross-site form
   can't send. Together those stand in for a CSRF token. */
const crypto = require("crypto");

const COOKIE = { user: "wx_user", driver: "wx_driver", admin: "wx_admin", cafe: "wx_cafe" };
// Customers shouldn't be asked to log in every week; the owner's key to the
// whole business should expire sooner.
const TTL_DAYS = { user: 180, driver: 30, admin: 30, cafe: 30 };

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || "").split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const key = part.slice(0, i).trim();
    if (!key || key in out) continue;
    const raw = part.slice(i + 1).trim();
    try { out[key] = decodeURIComponent(raw); } catch (e) { out[key] = raw; }
  }
  return out;
}

function readToken(req, kind) {
  return parseCookies(req.headers.cookie)[COOKIE[kind]] || null;
}

/* Secure only when the request really arrived over HTTPS (ngrok, Caddy). On
   plain http://localhost a Secure cookie would never be sent back, and the
   owner could never stay signed in to their own laptop. */
function cookieAttributes(req, maxAgeSeconds) {
  const bits = ["Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAgeSeconds}`];
  if (req.secure) bits.push("Secure");
  return bits.join("; ");
}

function findSession(db, kind, token) {
  if (!token) return null;
  return db
    .prepare("SELECT * FROM sessions WHERE token_hash = ? AND kind = ? AND expires_at > datetime('now')")
    .get(hashToken(token), kind) || null;
}

/* Creates the session and sets its cookie. Whatever session of the same kind
   this browser already held is deleted rather than orphaned — logging in as
   someone else shouldn't leave the previous login quietly valid. */
function startSession(db, req, res, kind, subjectId, fingerprint = null) {
  const previous = readToken(req, kind);
  if (previous) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(previous));
  db.prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')").run();

  const token = crypto.randomBytes(32).toString("base64url");
  db.prepare(
    `INSERT INTO sessions (token_hash, kind, subject_id, fingerprint, expires_at)
     VALUES (?, ?, ?, ?, datetime('now', ?))`
  ).run(hashToken(token), kind, subjectId, fingerprint, `+${TTL_DAYS[kind]} days`);
  res.append("Set-Cookie", `${COOKIE[kind]}=${token}; ${cookieAttributes(req, TTL_DAYS[kind] * 86400)}`);
  return token;
}

function endSession(db, req, res, kind) {
  const token = readToken(req, kind);
  if (token) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
  res.append("Set-Cookie", `${COOKIE[kind]}=; ${cookieAttributes(req, 0)}`);
}

module.exports = { COOKIE, TTL_DAYS, hashToken, parseCookies, readToken, findSession, startSession, endSession };
