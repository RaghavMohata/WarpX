/* Server-side secrets: the owner's admin password, the key n8n sends when it
   calls back into WarpX, and the secret that signs the cafe's one-tap
   "I'm preparing it" links (lib/cafe.js).

   They live in warpx-secrets.json next to warpx.db — gitignored like the
   database, because config.js is committed and a secret committed once is
   public for good. The file is created on first start with random values, so
   no install is ever protected by a password everybody knows (the dashboard
   used to ship with "1234" in its page source).

   Environment variables win, same as everything in config.js:
   WARPX_ADMIN_PASSWORD, WARPX_N8N_KEY. */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const FILE = path.join(__dirname, "..", "warpx-secrets.json");
// No 0/o or 1/l/i, so the password survives being read off a screen.
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

function readablePassword() {
  const group = () => Array.from({ length: 4 }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join("");
  return `${group()}-${group()}-${group()}`;
}

function load() {
  let stored = {};
  try {
    stored = JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch (err) {
    // A missing file is a first start. A file that exists but won't parse is
    // an owner's typo — regenerating would silently change their password and
    // break n8n, so stop and say so instead.
    if (err.code !== "ENOENT") {
      throw new Error(`warpx-secrets.json couldn't be read (${err.message}). Fix the typo, or delete the file to generate new secrets.`);
    }
  }

  const generated = [];
  if (!stored.ADMIN_PASSWORD) { stored.ADMIN_PASSWORD = readablePassword(); generated.push("ADMIN_PASSWORD"); }
  if (!stored.N8N_API_KEY) { stored.N8N_API_KEY = crypto.randomBytes(24).toString("base64url"); generated.push("N8N_API_KEY"); }
  // Added after the file already existed on the owner's Mac, which is why
  // each key is filled in on its own: an older file just gains this one.
  if (!stored.CAFE_LINK_SECRET) { stored.CAFE_LINK_SECRET = crypto.randomBytes(32).toString("base64url"); generated.push("CAFE_LINK_SECRET"); }
  if (generated.length) {
    fs.writeFileSync(FILE, JSON.stringify(stored, null, 2) + "\n", { mode: 0o600 });
  }

  const adminPassword = process.env.WARPX_ADMIN_PASSWORD || String(stored.ADMIN_PASSWORD);
  const n8nKey = process.env.WARPX_N8N_KEY || String(stored.N8N_API_KEY);
  return {
    file: FILE,
    adminPassword,
    n8nKey,
    // Changing it breaks every cafe link already sent — only do that if one leaked.
    cafeLinkSecret: String(stored.CAFE_LINK_SECRET),
    // Which admin password issued a session. Changing the password changes
    // this, and every session carrying the old value stops working.
    adminFingerprint: crypto.createHash("sha256").update("admin:" + adminPassword).digest("hex").slice(0, 16),
    adminPasswordIsNew: generated.includes("ADMIN_PASSWORD") && !process.env.WARPX_ADMIN_PASSWORD,
    adminPasswordFromEnv: Boolean(process.env.WARPX_ADMIN_PASSWORD),
  };
}

// Compared as fixed-length digests so neither a wrong length nor a wrong
// first character answers any faster than a wrong last one.
function safeEqual(a, b) {
  const da = crypto.createHash("sha256").update(String(a)).digest();
  const db = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(da, db);
}

module.exports = { load, safeEqual, FILE };
