/* The cafe's side of a food order: the email Picasso gets, and the one-tap
   link that tells WarpX (and the customer) the food is being made.

   Picasso has no WarpX account, and giving a busy counter a login would
   mean it never gets used. So each order's email carries its own link,
   signed with a server secret. The key is an HMAC of the order id, which
   makes it:
     - useless for any other order, and impossible to guess or forge;
     - able to do exactly one thing — move that order from "placed" to
       "preparing" — so a forwarded or leaked email can't do real harm.

   Two rules this module exists to keep:
     - The cafe never sees WarpX's prices. The menu price includes WarpX's
       ₹15-per-item margin over Picasso's own (see FOOD_MARGIN_PER_ITEM in
       server.js), so the email and the confirm page carry items, quantities
       and notes only — never price, subtotal or total.
     - No customer details. Picasso needs what to make and the order number
       the rider will quote, not who ordered it or where they live. */
const crypto = require("crypto");

// 32 hex characters (128 bits) — plenty to be unguessable, short enough to
// keep the link from wrapping onto three lines in a mail app.
function cafeKey(secret, orderId) {
  return crypto.createHmac("sha256", secret).update("cafe-order:" + Number(orderId)).digest("hex").slice(0, 32);
}

function checkCafeKey(secret, orderId, key) {
  const want = cafeKey(secret, orderId);
  const got = String(key || "");
  if (got.length !== want.length) return false;
  return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/* Subject, HTML and plain text, ready for n8n's Send Email node to use as
   they are — so the design lives here, versioned and tested, and nothing
   has to be templated inside n8n. Notes are typed by customers and are
   escaped: this is HTML going into the cafe's inbox. */
function cafeEmail({ orderNumber, items, whenLabel, confirmUrl }) {
  const count = items.reduce((n, it) => n + (Number(it.qty) || 1), 0);
  const scheduled = whenLabel !== "As soon as possible";
  const subject = scheduled
    ? `🍽️ WarpX order #${orderNumber} for ${whenLabel} — ${count} ${count === 1 ? "item" : "items"}`
    : `🍽️ New WarpX order #${orderNumber} — ${count} ${count === 1 ? "item" : "items"} to prepare`;

  const muted = "#5f5873"; // 6.7:1 on white
  const rows = items.map((it) => `
          <tr><td style="padding:12px 0;border-top:1px solid #ece9f2;font-size:16px;line-height:1.4;">
            <b>${escapeHtml(it.qty || 1)} ×</b> ${escapeHtml(it.name)}${it.note ? `<br><span style="font-size:14px;color:${muted};">Note: ${escapeHtml(it.note)}</span>` : ""}
          </td></tr>`).join("");
  const button = confirmUrl ? `
        <a href="${escapeHtml(confirmUrl)}" style="display:block;margin:24px 0 12px;background:#C6F135;color:#1C2205;text-align:center;padding:15px 18px;border-radius:999px;font-weight:bold;font-size:17px;text-decoration:none;">✅ I'm preparing it</a>
        <p style="margin:0;font-size:13px;line-height:1.5;color:${muted};">Tap it when you start — the customer is told straight away. A WarpX rider will collect the order from you.</p>` : `
        <p style="margin:20px 0 0;font-size:13px;line-height:1.5;color:${muted};">A WarpX rider will collect the order from you.</p>`;

  const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#f4f2f8;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f2f8;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:16px;padding:28px 24px;font-family:Arial,Helvetica,sans-serif;color:#16141f;">
        <tr><td>
        <p style="margin:0 0 6px;font-size:13px;color:${muted};">WarpX · new order to prepare</p>
        <h1 style="margin:0 0 6px;font-size:24px;">Order #${escapeHtml(orderNumber)}</h1>
        <p style="margin:0 0 16px;font-size:15px;">Needed: <b>${escapeHtml(whenLabel)}</b></p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-bottom:1px solid #ece9f2;">${rows}
        </table>${button}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  const text = [
    `New WarpX order #${orderNumber} — please prepare`,
    `Needed: ${whenLabel}`,
    "",
    ...items.map((it) => `${it.qty || 1} × ${it.name}${it.note ? ` (note: ${it.note})` : ""}`),
    "",
    confirmUrl ? `Tap when you start preparing, so the customer knows: ${confirmUrl}` : null,
    "A WarpX rider will collect the order from you.",
  ].filter((line) => line !== null).join("\n");

  return { subject, html, text };
}

module.exports = { cafeKey, checkCafeKey, cafeEmail, escapeHtml };
