/* WarpX delivery-driver progress tiers.

   The ladder is a plain table of thresholds rather than arithmetic, and that
   is the whole point. The old version derived every tier from four
   interlocking constants (start, step, orders-per-tier, max), which forced
   every tier to cost the same number of deliveries and made retuning a
   puzzle. A table can be read at a glance, changed by editing one number,
   and — crucially — can make early tiers cheaper than later ones.

   The ladder is a DAILY target: it counts deliveries completed since local
   midnight and resets each night. That is what makes a 25-delivery ladder
   mean anything — as a lifetime count it would be climbed once and then sit
   at the top forever, incentivising nothing.

   It is deliberately front-loaded. A driver's first promotion lands after 3
   deliveries, so a new rider sees the bar move on their first shift instead
   of grinding 10 jobs for nothing. The steps then widen (3 → 5 → 7 → 10) so
   the top tier still means something. Percentages stay odd, and the bar
   fills toward a 50% goal, both as originally specified. */

const TIER_LADDER = [
  { tier: 1, percent: 5, from: 0 },
  { tier: 2, percent: 15, from: 3 },
  { tier: 3, percent: 25, from: 8 },
  { tier: 4, percent: 35, from: 15 },
  { tier: 5, percent: 45, from: 25 },
];

const TIER_GOAL = 50; // the cap the bar fills toward

/* ---- What a driver actually earns ---------------------------------------
   BUSINESS INPUT — check these against your real economics before paying
   anyone from them. They are the only two numbers that decide driver pay.

   Every delivery pays a flat base. On top of that, the tier reached by the
   END of the day pays that percentage of the delivery fees collected that
   day — on ALL of the day's deliveries, not just the ones after the
   promotion. Settling the whole day at the closing tier is what makes "3
   more deliveries" worth chasing: one more job retroactively lifts every
   job already done that day. */
const BASE_PAY_PER_DELIVERY = 15; // ₹, paid on every delivery regardless of tier

/* deliveries — how many were completed today
   feeTotal   — the delivery fees collected across those deliveries
   percent    — the tier percentage the day closed on */
function payFor({ deliveries = 0, feeTotal = 0, percent = 0 }) {
  const n = Math.max(0, Math.floor(Number(deliveries) || 0));
  const fees = Math.max(0, Number(feeTotal) || 0);
  const base = n * BASE_PAY_PER_DELIVERY;
  const bonus = (fees * (Number(percent) || 0)) / 100;
  const round = (v) => Math.round(v * 100) / 100;
  return {
    base: round(base),
    bonus: round(bonus),
    total: round(base + bonus),
    perDelivery: n ? round((base + bonus) / n) : 0,
    basePerDelivery: BASE_PAY_PER_DELIVERY,
  };
}

/* What one more delivery at a given fee would be worth, including any
   promotion it triggers lifting the whole day's rate. */
function payIfOneMore({ deliveries, feeTotal, fee }) {
  const now = payFor({ deliveries, feeTotal, percent: tierFor(deliveries).percent });
  const after = payFor({
    deliveries: deliveries + 1,
    feeTotal: feeTotal + fee,
    percent: tierFor(deliveries + 1).percent,
  });
  return Math.round((after.total - now.total) * 100) / 100;
}

function tierFor(completed) {
  const done = Math.max(0, Math.floor(Number(completed) || 0));

  // The current tier is the last one whose threshold has been reached.
  let idx = 0;
  for (let i = 0; i < TIER_LADDER.length; i++) {
    if (done >= TIER_LADDER[i].from) idx = i;
  }
  const current = TIER_LADDER[idx];
  const next = TIER_LADDER[idx + 1] || null;
  const atMax = !next;

  const inTier = done - current.from;
  const perTier = next ? next.from - current.from : null;

  /* Two different numbers, on purpose:
       percent    — the tier a driver is *on*, the headline figure.
       barPercent — the fill, which slides forward with every single delivery
                    so the bar never looks frozen between promotions. It lands
                    exactly on each tier mark at that tier's threshold.
     Early tiers are short, so each delivery visibly moves the bar; later ones
     are longer, so the movement is smaller but the promotion is a bigger step. */
  const barPercent = next
    ? Math.round((current.percent + (inTier / perTier) * (next.percent - current.percent)) * 10) / 10
    : current.percent;

  return {
    completed: done,
    percent: current.percent,
    barPercent,
    goal: TIER_GOAL,
    ladder: TIER_LADDER,
    tier: current.tier,
    tiers: TIER_LADDER.length,
    atMax,
    nextPercent: next ? next.percent : null,
    ordersToNext: next ? next.from - done : null,
    inTier,
    perTier,
  };
}

module.exports = { tierFor, payFor, payIfOneMore, TIER_LADDER, TIER_GOAL, BASE_PAY_PER_DELIVERY };
