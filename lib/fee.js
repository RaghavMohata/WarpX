/* WarpX delivery pricing — the single source of truth for what a delivery costs.

   The fee slides down as the basket grows: ₹40 on small orders, ₹20 once the
   order is worth ₹400 or more. Bigger baskets are cheaper to deliver per rupee
   earned, so the discount pays for itself and nudges people to add one more
   item instead of placing two tiny orders.

   This file is loaded two ways — `require`d by server.js and dropped straight
   into the browser as <script src="lib/fee.js"> — so the price the cart shows
   and the price the server charges can never drift apart. */

// Highest threshold first: feeFor() returns the first slab the subtotal clears.
const FEE_SLABS = [
  { min: 400, fee: 20 },
  { min: 200, fee: 30 },
  { min: 100, fee: 35 },
  { min: 0, fee: 40 },
];

const FEE_MIN = 20; // cheapest slab, from ₹400 up
const FEE_MAX = 40; // dearest slab, under ₹100

function feeFor(subtotal) {
  const value = Math.max(0, Number(subtotal) || 0);
  // The ₹0 slab always matches, so this never falls through to undefined.
  return FEE_SLABS.find((slab) => value >= slab.min).fee;
}

/* What the customer would gain by spending a little more, so the cart can say
   "add ₹64 more and delivery drops to ₹30". Returns null once they're already
   on the cheapest slab and there's nothing left to unlock. */
function nextFeeStep(subtotal) {
  const value = Math.max(0, Number(subtotal) || 0);
  const currentFee = feeFor(value);

  // Slabs run highest-threshold first, so walking backwards finds the next one
  // up rather than the top one.
  for (let i = FEE_SLABS.length - 1; i >= 0; i--) {
    const slab = FEE_SLABS[i];
    if (slab.min > value) {
      return {
        addMore: Math.ceil(slab.min - value),
        fee: slab.fee,
        saves: currentFee - slab.fee,
        isCheapest: slab.fee === FEE_MIN,
      };
    }
  }
  return null;
}

// Cheapest-first, for printing the ladder on a page.
function feeLadder() {
  return FEE_SLABS.slice().reverse();
}

// Present when required by Node, harmless when this runs as a browser script.
if (typeof module !== "undefined" && module.exports) {
  module.exports = { feeFor, nextFeeStep, feeLadder, FEE_SLABS, FEE_MIN, FEE_MAX };
}
