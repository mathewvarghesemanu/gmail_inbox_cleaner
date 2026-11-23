// On-device usage counters (chrome.storage.local, never leaves the device).
(() => {
  const GC = window.__gc;
  if (!GC || GC.skipLoad) return;

  const { STATS_DAYS_KEPT, STATS_KEY, safeStorageGet, safeStorageSet } = GC;

  /** Returns the local-date key (YYYY-MM-DD) used for per-day stats. */
  function getStatsDayKey(date = new Date()) {
    const pad = (n) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  const STAT_FIELDS = ["unsubscribed", "conversationsArchived", "pagesArchived", "deleted", "batches"];
  let statsWriteChain = Promise.resolve();

  /**
   * Adds counts to the on-device stats in chrome.storage.local[STATS_KEY]:
   * { totals: {unsubscribed, conversationsArchived, pagesArchived, batches},
   *   days: { "YYYY-MM-DD": {same fields} } } keeping the last STATS_DAYS_KEPT days.
   * Writes are serialized so concurrent increments are not lost. Never leaves the device.
   */
  function recordStats(delta) {
    statsWriteChain = statsWriteChain.then(
      () =>
        new Promise((resolve) => {
          // safeStorageGet skips the callback on errors; never stall the chain.
          const timer = setTimeout(resolve, 3000);
          safeStorageGet([STATS_KEY], (result) => {
            clearTimeout(timer);
            const stored = result?.[STATS_KEY];
            const stats = stored && typeof stored === "object" ? stored : {};
            const totals = stats.totals && typeof stats.totals === "object" ? stats.totals : {};
            const days = stats.days && typeof stats.days === "object" ? stats.days : {};
            const todayKey = getStatsDayKey();
            const today = days[todayKey] && typeof days[todayKey] === "object" ? days[todayKey] : {};
            STAT_FIELDS.forEach((field) => {
              const add = Math.max(0, Number(delta?.[field]) || 0);
              if (!add) return;
              totals[field] = (Number(totals[field]) || 0) + add;
              today[field] = (Number(today[field]) || 0) + add;
            });
            days[todayKey] = today;
            const cutoff = new Date();
            cutoff.setDate(cutoff.getDate() - (STATS_DAYS_KEPT - 1));
            const cutoffKey = getStatsDayKey(cutoff);
            Object.keys(days).forEach((key) => {
              if (key < cutoffKey) delete days[key];
            });
            safeStorageSet({ [STATS_KEY]: { ...stats, totals, days } });
            resolve();
          });
        })
    );
  }

  Object.assign(GC, { STAT_FIELDS, getStatsDayKey, recordStats });
})();
