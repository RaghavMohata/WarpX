/* WarpX delivery-driver progress tiers.

   The ladder is a plain table of thresholds rather than arithmetic, and that
   is the whole point. The old version derived every tier from four
   interlocking constants (start, step, orders-per-tier, max), which forced
   every tier to cost the same number of deliveries and made retuning a
   puzzle. A table can be read at a glance, changed by editing one number,
   and — crucially — can make early tiers cheaper than later ones.

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

module.exports = { tierFor, TIER_LADDER, TIER_GOAL };
