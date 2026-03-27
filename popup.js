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

/** Handles init. */
async function init() {
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
