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

/* ---- Weekly vegetable plans ----------------------------------------------
   A week's plan is one delivery per day the customer put something under, so
   charging the normal per-delivery fee would bill a five-day plan five times.
   Since grocery items are quoted at the market rather than priced up front,
   every one of those days lands on the ₹0 slab — the dearest one — so five
   days would be ₹200 of delivery on a basket the site can't even price yet.
   A single weekly price is what makes planning more days feel like a better
   deal instead of a penalty.

   These two constants are the whole policy: nothing else in the codebase
   decides it. checkout.html quotes from weeklyPlanFee() and server.js charges
   from the same call, so the quote and the charge can't drift. */
const WEEKLY_FEE_MODE = "flat"; // "flat" | "per-day"
const WEEKLY_FLAT_FEE = 99;     // ₹ for the whole week, when mode is "flat"

/* What a plan's deliveries cost, and how that splits across its days.

   The split is not cosmetic: driver pay (lib/tier.js) pays a percentage of the
   delivery fees a driver actually earned, and the owner's earnings panel sums
   delivery_fee per order. Parking the whole weekly fee on the Monday order
   would pay Wednesday's driver a bonus on ₹0 and misreport every day but one,
   so each day's order carries its own share and the shares add up to exactly
   the quoted total. */
function weeklyPlanFee(dayCount, subtotalPerDay) {
  const days = Math.max(0, Number(dayCount) || 0);
  const subtotals = Array.isArray(subtotalPerDay) ? subtotalPerDay : [];
  if (days === 0) return { mode: WEEKLY_FEE_MODE, total: 0, perOrder: [] };

  if (WEEKLY_FEE_MODE === "per-day") {
    const perOrder = [];
    for (let i = 0; i < days; i++) perOrder.push(feeFor(subtotals[i] || 0));
    return { mode: "per-day", total: perOrder.reduce((a, b) => a + b, 0), perOrder };
  }

  // Flat: split evenly, remainder onto the first day so the parts sum exactly.
  const base = Math.floor(WEEKLY_FLAT_FEE / days);
  const perOrder = new Array(days).fill(base);
  perOrder[0] += WEEKLY_FLAT_FEE - base * days;
  return { mode: "flat", total: WEEKLY_FLAT_FEE, perOrder };
}

// Present when required by Node, harmless when this runs as a browser script.
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    feeFor, nextFeeStep, feeLadder, weeklyPlanFee,
    FEE_SLABS, FEE_MIN, FEE_MAX, WEEKLY_FEE_MODE, WEEKLY_FLAT_FEE,
  };
}
