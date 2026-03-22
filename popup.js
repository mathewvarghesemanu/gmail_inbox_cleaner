const SHOW_EXTENSION_KEY = "showExtensionEnabled";
const EXECUTE_SELECTED_SHORTCUT_KEY = "executeSelectedShortcut";
const NEXT_SCAN_PAGE_LIMIT_KEY = "nextScanPageLimit";
const DEFAULT_SCAN_PAGE_LIMIT = 1;
const MIN_SCAN_PAGE_LIMIT = 1;
const MAX_SCAN_PAGE_LIMIT = 200;
const DEFAULT_SHORTCUT = {
  enabled: true,
  key: "E",
  alt: true,
  shift: true,
  ctrl: false,
  meta: false
};

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

/** Normalizes shortcut config. */
function normalizeShortcutConfig(raw) {
  const candidate = raw || {};
  const key = String(candidate.key || DEFAULT_SHORTCUT.key)
    .trim()
    .slice(0, 1)
    .toUpperCase();

  return {
    enabled: candidate.enabled !== false,
    key: key || DEFAULT_SHORTCUT.key,
    alt: candidate.alt !== false,
    shift: candidate.shift !== false,
    ctrl: candidate.ctrl === true,
    meta: candidate.meta === true
  };
}

/** Normalizes scan page limit. */
function normalizeScanPageLimit(raw) {
  const parsed = Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_SCAN_PAGE_LIMIT;
  return Math.min(MAX_SCAN_PAGE_LIMIT, Math.max(MIN_SCAN_PAGE_LIMIT, parsed));
}

/** Migrates legacy scan page limit. */
function migrateLegacyScanPageLimit(raw) {
  const normalized = normalizeScanPageLimit(raw);
  if (Number(raw) === 25) {
    chrome.storage.local.set({ [NEXT_SCAN_PAGE_LIMIT_KEY]: DEFAULT_SCAN_PAGE_LIMIT });
    return DEFAULT_SCAN_PAGE_LIMIT;
  }
  return normalized;
}

/** Returns shortcut config. */
function getShortcutConfig() {
  return new Promise((resolve) => {
    chrome.storage.local.get([EXECUTE_SELECTED_SHORTCUT_KEY], (result) => {
      if (chrome.runtime.lastError) {
        resolve(DEFAULT_SHORTCUT);
        return;
      }
      resolve(normalizeShortcutConfig(result[EXECUTE_SELECTED_SHORTCUT_KEY]));
    });
  });
}

/** Returns scan page limit. */
function getScanPageLimit() {
  return new Promise((resolve) => {
    chrome.storage.local.get([NEXT_SCAN_PAGE_LIMIT_KEY], (result) => {
      if (chrome.runtime.lastError) {
        resolve(DEFAULT_SCAN_PAGE_LIMIT);
        return;
      }
      resolve(migrateLegacyScanPageLimit(result[NEXT_SCAN_PAGE_LIMIT_KEY]));
    });
  });
}

/** Formats shortcut. */
function formatShortcut(config) {
  const parts = [];
  if (config.ctrl) parts.push("Ctrl");
  if (config.meta) parts.push("Cmd/Win");
  if (config.alt) parts.push("Alt");
  if (config.shift) parts.push("Shift");
  parts.push(config.key);
  return parts.join(" + ");
}

/** Handles init. */
async function init() {
  const checkbox = document.getElementById("show-extension");
  const shortcutEnabled = document.getElementById("shortcut-enabled");
  const shortcutKey = document.getElementById("shortcut-key");
  const shortcutAlt = document.getElementById("shortcut-alt");
  const shortcutShift = document.getElementById("shortcut-shift");
  const shortcutCtrl = document.getElementById("shortcut-ctrl");
  const shortcutMeta = document.getElementById("shortcut-meta");
  const shortcutPreview = document.getElementById("shortcut-preview");
  const maxScanPages = document.getElementById("max-scan-pages");
  if (
    !checkbox ||
    !shortcutEnabled ||
    !shortcutKey ||
    !shortcutAlt ||
    !shortcutShift ||
    !shortcutCtrl ||
    !shortcutMeta ||
    !shortcutPreview ||
    !maxScanPages
  ) {
    return;
  }

  const enabled = await getShowExtensionEnabled();
  const shortcut = await getShortcutConfig();
  const scanPageLimit = await getScanPageLimit();
  checkbox.checked = enabled;
  shortcutEnabled.checked = shortcut.enabled;
  shortcutKey.value = shortcut.key;
  shortcutAlt.checked = shortcut.alt;
  shortcutShift.checked = shortcut.shift;
  shortcutCtrl.checked = shortcut.ctrl;
  shortcutMeta.checked = shortcut.meta;
  shortcutPreview.textContent = `Current shortcut: ${formatShortcut(shortcut)}`;
  maxScanPages.value = String(scanPageLimit);

  checkbox.addEventListener("change", () => {
    chrome.storage.local.set({ [SHOW_EXTENSION_KEY]: checkbox.checked }, async () => {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const activeTab = tabs[0];
      if (!activeTab?.id) return;

      // Force refresh so the content script re-reads visibility state immediately.
      chrome.tabs.reload(activeTab.id);
    });
  });

  /** Handles save shortcut. */
  const saveShortcut = () => {
    const normalized = normalizeShortcutConfig({
      enabled: shortcutEnabled.checked,
      key: shortcutKey.value,
      alt: shortcutAlt.checked,
      shift: shortcutShift.checked,
      ctrl: shortcutCtrl.checked,
      meta: shortcutMeta.checked
    });

    shortcutKey.value = normalized.key;
    shortcutPreview.textContent = `Current shortcut: ${formatShortcut(normalized)}`;
    chrome.storage.local.set({ [EXECUTE_SELECTED_SHORTCUT_KEY]: normalized });
  };

  shortcutEnabled.addEventListener("change", saveShortcut);
  shortcutKey.addEventListener("input", () => {
    shortcutKey.value = shortcutKey.value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 1);
    saveShortcut();
  });
  shortcutAlt.addEventListener("change", saveShortcut);
  shortcutShift.addEventListener("change", saveShortcut);
  shortcutCtrl.addEventListener("change", saveShortcut);
  shortcutMeta.addEventListener("change", saveShortcut);

  maxScanPages.addEventListener("change", () => {
    const nextLimit = normalizeScanPageLimit(maxScanPages.value);
    maxScanPages.value = String(nextLimit);
    chrome.storage.local.set({ [NEXT_SCAN_PAGE_LIMIT_KEY]: nextLimit });
  });
}

init();
