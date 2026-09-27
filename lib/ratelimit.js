/* Counts failed attempts per key inside a sliding window — enough to stop a
   script trying a thousand passwords, delivery codes or phone numbers.

   Failures only, not every request: mobile networks in India put many phones
   behind one public IP (CGNAT), and counting every login from that IP would
   lock out customers who typed their password right.

   In memory, one process. A restart forgets the counts, which only ever errs
   toward letting someone try again. */
function createLimiter({ max, windowMs }) {
  const failures = new Map(); // key -> timestamps of recent failures

  function recent(key) {
    const cutoff = Date.now() - windowMs;
    const list = (failures.get(key) || []).filter((t) => t > cutoff);
    if (list.length) failures.set(key, list); else failures.delete(key);
    return list;
  }

  return {
    blocked(key) {
      return recent(key).length >= max;
    },
    // Seconds until the oldest failure in the window ages out.
    retryAfter(key) {
      const list = recent(key);
      if (!list.length) return 0;
      return Math.max(1, Math.ceil((list[0] + windowMs - Date.now()) / 1000));
    },
    fail(key) {
      const list = recent(key);
      list.push(Date.now());
      failures.set(key, list);
      // A flood of distinct keys shouldn't grow this without bound.
      if (failures.size > 5000) for (const k of failures.keys()) recent(k);
    },
    reset(key) {
      failures.delete(key);
    },
  };
}

module.exports = { createLimiter };
