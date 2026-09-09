/* WarpX delivery-driver progress tiers.

   Every driver starts at 5% and climbs 10 points for each 10 deliveries they
   complete — 5, 15, 25, 35, 45 — all odd numbers, stopping at 45% because the
   bar fills toward a 50% cap. */
const TIER_START = 5;
const TIER_STEP = 10;
const ORDERS_PER_TIER = 10;
const TIER_MAX = 45; // last tier below the cap
const TIER_GOAL = 50; // the cap the bar fills toward

const TIER_LADDER = [];
for (let p = TIER_START; p <= TIER_MAX; p += TIER_STEP) TIER_LADDER.push(p);

function tierFor(completed) {
  const done = Math.max(0, Math.floor(Number(completed) || 0));
  const steps = Math.floor(done / ORDERS_PER_TIER);
  const percent = Math.min(TIER_START + steps * TIER_STEP, TIER_MAX);
  const atMax = percent >= TIER_MAX;
  return {
    completed: done,
    percent,
    goal: TIER_GOAL,
    ladder: TIER_LADDER,
    tier: Math.min(steps + 1, TIER_LADDER.length),
    tiers: TIER_LADDER.length,
    atMax,
    nextPercent: atMax ? null : percent + TIER_STEP,
    ordersToNext: atMax ? null : ORDERS_PER_TIER - (done % ORDERS_PER_TIER),
  };
}

module.exports = { tierFor, TIER_LADDER, TIER_GOAL, ORDERS_PER_TIER };
