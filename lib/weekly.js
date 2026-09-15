/* WarpX weekly grocery windows — is one currently taking submissions? */
const { parseSchedule } = require("./schedule");

/* Whether a weekly window is still accepting new submissions right now: the
   owner hasn't closed it AND the cutoff moment hasn't passed. Two
   independent gates on purpose — the cutoff is a hard, always-enforced
   deadline; "closed" is the owner's own early-stop button. Either one alone
   is enough to shut submissions off. */
function isWindowOpen(window, now) {
  if (!window || window.status !== "open") return false;
  const cutoff = parseSchedule(window.cutoff_at);
  if (!cutoff) return false;
  const today = now instanceof Date ? now : new Date();
  return today.getTime() < cutoff.getTime();
}

module.exports = { isWindowOpen };
