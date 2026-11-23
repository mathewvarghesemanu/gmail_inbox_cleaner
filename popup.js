const SHOW_EXTENSION_KEY = "showExtensionEnabled";
/** Mirrors src/constants.js. */
const DELETE_ENABLED_KEY = "deleteOpenEmailEnabled";
const DELETE_CONFIRM_SKIP_KEY = "deleteSkipConfirmation";

/** Reads keys from chrome.storage.local, resolving {} on error. */
function storageGet(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.get(keys, (result) => {
      if (chrome.runtime.lastError) {
        resolve({});
        return;
      }
      resolve(result || {});
    });
  });
}

/** Local-only usage counters written by the content script (never leave the device). */
const STATS_KEY = "gcStats";
const STAT_FIELDS = ["unsubscribed", "conversationsArchived", "pagesArchived", "deleted", "batches"];

/** Returns the local-date key (YYYY-MM-DD), matching src/stats.js. */
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


/** Wires the "Show the extension" checkbox. */
function initShowExtension(checkbox, stored) {
  checkbox.checked = stored[SHOW_EXTENSION_KEY] !== false;

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

/**
 * Wires the Delete toggles. "Skip confirmation" and the disclaimer only show while
 * Delete is on; turning Delete off also turns confirmation back on.
 * The sidebar picks up changes live via chrome.storage.onChanged.
 */
function initDeleteSettings(stored) {
  const enabled = document.getElementById("delete-enabled");
  const skip = document.getElementById("delete-skip-confirm");
  const options = document.getElementById("delete-options");
  const warning = document.getElementById("delete-no-confirm-warning");
  if (!enabled || !skip || !options) return;

  const render = () => {
    options.hidden = !enabled.checked;
    if (warning) warning.hidden = !(enabled.checked && skip.checked);
  };

  enabled.checked = stored[DELETE_ENABLED_KEY] === true;
  skip.checked = enabled.checked && stored[DELETE_CONFIRM_SKIP_KEY] === true;
  render();

  enabled.addEventListener("change", () => {
    if (!enabled.checked) skip.checked = false;
    chrome.storage.local.set({
      [DELETE_ENABLED_KEY]: enabled.checked,
      [DELETE_CONFIRM_SKIP_KEY]: skip.checked
    });
    render();
  });

  skip.addEventListener("change", () => {
    chrome.storage.local.set({ [DELETE_CONFIRM_SKIP_KEY]: enabled.checked && skip.checked });
    render();
  });
}

/** Handles init. */
async function init() {
  initStats();
  const stored = await storageGet([SHOW_EXTENSION_KEY, DELETE_ENABLED_KEY, DELETE_CONFIRM_SKIP_KEY]);

  const checkbox = document.getElementById("show-extension");
  if (checkbox) initShowExtension(checkbox, stored);

  initDeleteSettings(stored);
}

init();
