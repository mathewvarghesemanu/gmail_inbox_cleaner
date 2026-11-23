const AUTO_RELOAD_KEY = "autoReloadEnabled";
const ALARM_NAME = "dev-auto-reload";

/** Returns auto reload enabled. */
async function getAutoReloadEnabled() {
  return new Promise((resolve) => {
    chrome.storage.local.get([AUTO_RELOAD_KEY], (result) => {
      if (chrome.runtime.lastError) {
        resolve(false);
        return;
      }

      const value = result[AUTO_RELOAD_KEY];
      resolve(value !== false);
    });
  });
}

/** Returns whether the alarms API is available (dev auto-reload only). */
function hasAlarmsApi() {
  return typeof chrome.alarms !== "undefined";
}

/** Ensures alarm. */
async function ensureAlarm() {
  if (!hasAlarmsApi()) return;
  const enabled = await getAutoReloadEnabled();
  if (!enabled) {
    chrome.alarms.clear(ALARM_NAME);
    return;
  }

  chrome.alarms.create(ALARM_NAME, {
    periodInMinutes: 1
  });
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get([AUTO_RELOAD_KEY], (result) => {
    if (chrome.runtime.lastError) return;

    if (typeof result[AUTO_RELOAD_KEY] === "undefined") {
      // Keep extension behavior stable by default.
      // Dev auto-reload can be enabled manually when needed.
      chrome.storage.local.set({ [AUTO_RELOAD_KEY]: false });
    }
  });

  ensureAlarm();
});

chrome.runtime.onStartup.addListener(() => {
  ensureAlarm();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  if (!changes[AUTO_RELOAD_KEY]) return;
  ensureAlarm();
});

if (hasAlarmsApi()) {
  chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name !== ALARM_NAME) return;

    const enabled = await getAutoReloadEnabled();
    if (!enabled) return;

    chrome.runtime.reload();
  });
}

const EXECUTE_SELECTED_COMMAND = "execute-selected";

/** Sends a message to a tab, ignoring tabs without the content script. */
function sendToTab(tabId, message) {
  chrome.tabs.sendMessage(tabId, message, () => {
    // No content script on this tab (not Gmail, or not yet injected).
    void chrome.runtime.lastError;
  });
}

// Forward every manifest command to the content script as a generic
// "gc-command" message. Execute Selected keeps the legacy message type so an
// older content script still in an open Gmail tab keeps working.
chrome.commands.onCommand.addListener((command, tab) => {
  if (!tab?.id) return;
  if (command === EXECUTE_SELECTED_COMMAND) {
    sendToTab(tab.id, { type: "gc-execute-selected" });
    return;
  }
  sendToTab(tab.id, { type: "gc-command", command });
});

// chrome.commands is unavailable in content scripts, so the sidebar asks here
// for the user's current bindings (set at chrome://extensions/shortcuts).
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "gc-get-shortcuts") return undefined;
  chrome.commands.getAll((commands) => {
    if (chrome.runtime.lastError) {
      sendResponse({ ok: false, shortcuts: {} });
      return;
    }
    const shortcuts = {};
    (commands || []).forEach((cmd) => {
      if (cmd?.name) shortcuts[cmd.name] = cmd.shortcut || "";
    });
    sendResponse({ ok: true, shortcuts });
  });
  return true;
});
