const SHOW_EXTENSION_KEY = "showExtensionEnabled";
const MAX_SCAN_PAGES_KEY = "maxScanPages";
const DEFAULT_SCAN_PAGE_LIMIT = 5;
const MIN_SCAN_PAGE_LIMIT = 1;
const MAX_SCAN_PAGE_LIMIT = 200;

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

/** Clamps a raw value to a valid scan page limit (mirrors content.js). */
function normalizeScanPageLimit(raw) {
  const parsed = Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_SCAN_PAGE_LIMIT;
  return Math.min(MAX_SCAN_PAGE_LIMIT, Math.max(MIN_SCAN_PAGE_LIMIT, parsed));
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

/** Wires the "Max pages to scan" input. The content script picks up changes live. */
function initMaxScanPages(input, stored) {
  input.value = String(normalizeScanPageLimit(stored[MAX_SCAN_PAGES_KEY]));

  input.addEventListener("change", () => {
    const value = normalizeScanPageLimit(input.value);
    input.value = String(value);
    chrome.storage.local.set({ [MAX_SCAN_PAGES_KEY]: value });
  });
}

/** Handles init. */
async function init() {
  const stored = await storageGet([SHOW_EXTENSION_KEY, MAX_SCAN_PAGES_KEY]);

  const checkbox = document.getElementById("show-extension");
  if (checkbox) initShowExtension(checkbox, stored);

  const maxPagesInput = document.getElementById("max-scan-pages");
  if (maxPagesInput) initMaxScanPages(maxPagesInput, stored);
}

init();
