const SHOW_EXTENSION_KEY = "showExtensionEnabled";

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

async function init() {
  const checkbox = document.getElementById("show-extension");
  if (!checkbox) return;

  const enabled = await getShowExtensionEnabled();
  checkbox.checked = enabled;

  checkbox.addEventListener("change", async () => {
    chrome.storage.local.set({ [SHOW_EXTENSION_KEY]: checkbox.checked });

    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const activeTab = tabs[0];
    if (!activeTab?.id) return;

    // Reload Gmail so the content script state and UI are refreshed immediately.
    if ((activeTab.url || "").startsWith("https://mail.google.com/")) {
      chrome.tabs.reload(activeTab.id);
    }
  });
}

init();
