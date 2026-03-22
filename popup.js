const SHOW_EXTENSION_KEY = "showExtensionEnabled";
const EXECUTE_SELECTED_SHORTCUT_KEY = "executeSelectedShortcut";
const DEFAULT_SHORTCUT = {
  enabled: true,
  key: "E",
  alt: true,
  shift: true,
  ctrl: false,
  meta: false
};

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

function formatShortcut(config) {
  const parts = [];
  if (config.ctrl) parts.push("Ctrl");
  if (config.meta) parts.push("Cmd/Win");
  if (config.alt) parts.push("Alt");
  if (config.shift) parts.push("Shift");
  parts.push(config.key);
  return parts.join(" + ");
}

async function init() {
  const checkbox = document.getElementById("show-extension");
  const shortcutEnabled = document.getElementById("shortcut-enabled");
  const shortcutKey = document.getElementById("shortcut-key");
  const shortcutAlt = document.getElementById("shortcut-alt");
  const shortcutShift = document.getElementById("shortcut-shift");
  const shortcutCtrl = document.getElementById("shortcut-ctrl");
  const shortcutMeta = document.getElementById("shortcut-meta");
  const shortcutPreview = document.getElementById("shortcut-preview");
  if (
    !checkbox ||
    !shortcutEnabled ||
    !shortcutKey ||
    !shortcutAlt ||
    !shortcutShift ||
    !shortcutCtrl ||
    !shortcutMeta ||
    !shortcutPreview
  ) {
    return;
  }

  const enabled = await getShowExtensionEnabled();
  const shortcut = await getShortcutConfig();
  checkbox.checked = enabled;
  shortcutEnabled.checked = shortcut.enabled;
  shortcutKey.value = shortcut.key;
  shortcutAlt.checked = shortcut.alt;
  shortcutShift.checked = shortcut.shift;
  shortcutCtrl.checked = shortcut.ctrl;
  shortcutMeta.checked = shortcut.meta;
  shortcutPreview.textContent = `Current shortcut: ${formatShortcut(shortcut)}`;

  checkbox.addEventListener("change", () => {
    chrome.storage.local.set({ [SHOW_EXTENSION_KEY]: checkbox.checked }, async () => {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const activeTab = tabs[0];
      if (!activeTab?.id) return;

      // Force refresh so the content script re-reads visibility state immediately.
      chrome.tabs.reload(activeTab.id);
    });
  });

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
}

init();
