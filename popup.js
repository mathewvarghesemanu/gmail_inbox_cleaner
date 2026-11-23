const SHOW_EXTENSION_KEY = "showExtensionEnabled";

/** Returns show extension enabled. */
function getShowExtensionEnabled() {
  return new Promise((resolve) => {
    chrome.storage.local.get([SHOW_EXTENSION_KEY], (result) => {
      if (chrome.runtime.lastError) {
        resolve(true);
        return;
      }

      const value = result[SHOW_EXTENSION_KEY];
      resolve(value !== false);
    });
  });
}

/** Local-only usage counters written by the content script (never leave the device). */
const STATS_KEY = "gcStats";
const STAT_FIELDS = ["unsubscribed", "conversationsArchived", "pagesArchived", "batches"];

/** Returns the local-date key (YYYY-MM-DD), matching content.js. */
function getStatsDayKey(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Renders today / all-time stats into the popup table. */
function renderStats(stats) {
  const totals = stats?.totals || {};
  const today = stats?.days?.[getStatsDayKey()] || {};
  STAT_FIELDS.forEach((field) => {
    const todayEl = document.querySelector(`[data-stat="today-${field}"]`);
    const totalEl = document.querySelector(`[data-stat="total-${field}"]`);
    if (todayEl) todayEl.textContent = String(Number(today[field]) || 0);
    if (totalEl) totalEl.textContent = String(Number(totals[field]) || 0);
  });
}

/** Loads stats, keeps them live while the popup is open, and wires Reset. */
function initStats() {
  chrome.storage.local.get([STATS_KEY], (result) => {
    if (chrome.runtime.lastError) return;
    renderStats(result[STATS_KEY]);
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes[STATS_KEY]) return;
    renderStats(changes[STATS_KEY].newValue);
  });

  // Two-click confirm (native confirm() dialogs are unreliable in action popups).
  const resetButton = document.getElementById("reset-stats");
  let armedTimer = null;
  resetButton?.addEventListener("click", () => {
    if (!armedTimer) {
      resetButton.textContent = "Click again to reset";
      armedTimer = setTimeout(() => {
        armedTimer = null;
        resetButton.textContent = "Reset stats";
      }, 3000);
      return;
    }
    clearTimeout(armedTimer);
    armedTimer = null;
    resetButton.textContent = "Reset stats";
    chrome.storage.local.remove(STATS_KEY, () => renderStats(null));
  });
}

/** Handles init. */
async function init() {
  initStats();
  const checkbox = document.getElementById("show-extension");
  if (!checkbox) {
    return;
  }

  const enabled = await getShowExtensionEnabled();
  checkbox.checked = enabled;

  checkbox.addEventListener("change", () => {
    chrome.storage.local.set({ [SHOW_EXTENSION_KEY]: checkbox.checked }, async () => {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const activeTab = tabs[0];
      if (!activeTab?.id) return;

      // Force refresh so the content script re-reads visibility state immediately.
      chrome.tabs.reload(activeTab.id);
    });
  });
}

init();
