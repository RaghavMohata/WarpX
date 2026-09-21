/* WarpX local configuration — committed to the repo on purpose.

   A Web OAuth Client ID is public by design: Google renders it into every page
   for every visitor to read, so keeping it here is safe and saves typing an
   environment variable on every launch.

   A Client SECRET is a different thing entirely. It is NOT needed for the
   "Sign in with Google" button flow (which verifies a signed ID token, never
   exchanging an authorization code), and it must never be put in this file or
   anywhere else in this repository. */

module.exports = {
  /* From the Google Cloud Console → Credentials → OAuth 2.0 Client IDs.
     Leave it empty and the button never renders — the site behaves exactly as
     it does without Google sign-in. */
  GOOGLE_CLIENT_ID: "271784652438-b3dihv1ltakiqilr3lago1n1brvrrfrh.apps.googleusercontent.com",

  /* Where n8n's "new order" webhook trigger is listening, e.g.
     "http://localhost:5678/webhook/new-order". Leave it empty and WarpX
     never calls out anywhere — placing an order behaves exactly as it does
     today. n8n itself, and the restaurant-owner / delivery-partner
     notifications it sends, are documented under "n8n order automation" in
     README.md. */
  N8N_WEBHOOK_URL: "http://localhost:5678/webhook/new-order",

  /* Where n8n's "order status changed" webhook trigger is listening, e.g.
     "http://localhost:5678/webhook/order-status". Fired every time an order
     moves to preparing / out for delivery / delivered, so n8n can message
     the *customer* directly instead of them refreshing orders.html. Separate
     from N8N_WEBHOOK_URL above so the two can run as separate, simpler n8n
     workflows. Leave it empty and nothing changes. */
  N8N_STATUS_WEBHOOK_URL: "http://localhost:5678/webhook/order-status",

  /* Where n8n's "customer order confirmation" webhook is listening, e.g.
     "http://localhost:5678/webhook/customer-order". Sent only for customers
     who have an email (Google sign-in) and carries their delivery OTP, so keep
     it a separate workflow from N8N_WEBHOOK_URL. Leave it empty and nothing
     changes. */
  N8N_CUSTOMER_WEBHOOK_URL: "http://localhost:5678/webhook/customer-order",

  /* How many customers can hold the same weekly delivery slot (e.g. 8 – 10
     am). Once a slot has this many, it greys out on weekly.html and the next
     person picks another — that's what keeps a day's deliveries matched to
     how many drivers are actually working. The owner can override it per week
     when opening the window; this is just the number that box starts on. */
  WEEKLY_SLOT_CAPACITY: 12,

  /* Where a driver collects a food order from. Attached to an order (in the
     driver hub and the n8n webhook) only when it includes a food item —
     other services have no single fixed pickup point yet. Never sent to any
     customer-facing page. */
  PICASSO_ADDRESS: "Beside Gold Cinema, Churhe Bada, Brahmapuri, Maharashtra",
};
