const AUTO_RELOAD_KEY = "autoReloadEnabled";
const ALARM_NAME = "dev-auto-reload";

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

async function ensureAlarm() {
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

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_NAME) return;

  const enabled = await getAutoReloadEnabled();
  if (!enabled) return;

  chrome.runtime.reload();
});
