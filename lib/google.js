/* WarpX Google sign-in — token verification and the half-finished-signup ticket.

   The browser hands us a signed ID token and claims it belongs to somebody.
   Nothing in that claim is believed until the signature checks out against
   Google's own keys, so this module is the whole trust boundary for Google
   sign-in. Verification is delegated to google-auth-library rather than
   hand-rolled: key rotation, `kid` selection and the aud/iss/exp checks are
   exactly the code where a silent mistake means anyone can log in as anyone. */

const crypto = require("crypto");
const { OAuth2Client } = require("google-auth-library");

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const ISSUERS = ["accounts.google.com", "https://accounts.google.com"];

// Unconfigured is a normal state, not an error: the site runs exactly as it
// did before, just without the button.
function isEnabled() {
  return Boolean(CLIENT_ID);
}

const client = new OAuth2Client(CLIENT_ID);

/* Resolves to the verified payload, or throws. Callers must treat a throw as
   "this person is not who they say they are" and nothing more specific — the
   message is deliberately vague to the caller's user. */
async function verifyIdToken(idToken, { audience = CLIENT_ID, oauthClient = client } = {}) {
  if (!idToken || typeof idToken !== "string") throw new Error("No sign-in token was supplied.");

  const ticket = await oauthClient.verifyIdToken({ idToken, audience });
  const payload = ticket.getPayload();
  if (!payload) throw new Error("That sign-in token could not be read.");

  // verifyIdToken already checks signature, aud and exp. Issuer and a verified
  // email are ours to insist on: an unverified address would let someone sign
  // up as an email they don't control.
  if (!ISSUERS.includes(payload.iss)) throw new Error("That token wasn't issued by Google.");
  if (!payload.email || payload.email_verified !== true) {
    throw new Error("Your Google account's email address isn't verified.");
  }
  if (!payload.sub) throw new Error("That token is missing an account id.");

  return {
    sub: payload.sub,
    email: payload.email,
    name: payload.name || null,
    picture: payload.picture || null,
  };
}

/* ---- Pending links -------------------------------------------------------
   A first-time Google sign-in can't finish immediately: WarpX needs a phone
   number, and linking to an existing account needs its password. That
   half-finished state is held HERE, server-side, keyed to the verified `sub`
   — never handed to the browser as something it could edit. Otherwise the
   phone step could be replayed with somebody else's email.

   In memory on purpose: these live for minutes, and losing them on restart
   just means signing in again. */
const TICKET_TTL_MS = 10 * 60 * 1000;
const pending = new Map();

function createTicket(profile) {
  const id = crypto.randomBytes(24).toString("hex");
  pending.set(id, { profile, expires: Date.now() + TICKET_TTL_MS });
  return id;
}

function readTicket(id) {
  const entry = pending.get(String(id || ""));
  if (!entry) return null;
  if (Date.now() > entry.expires) {
    pending.delete(id);
    return null;
  }
  return entry.profile;
}

function consumeTicket(id) {
  const profile = readTicket(id);
  if (profile) pending.delete(id);
  return profile;
}

// Cheap sweep so an abandoned signup doesn't sit in memory for the process's life.
function purgeExpiredTickets(now = Date.now()) {
  let removed = 0;
  for (const [id, entry] of pending) {
    if (now > entry.expires) { pending.delete(id); removed++; }
  }
  return removed;
}

module.exports = {
  isEnabled, verifyIdToken, createTicket, readTicket, consumeTicket, purgeExpiredTickets,
  CLIENT_ID, TICKET_TTL_MS,
};
