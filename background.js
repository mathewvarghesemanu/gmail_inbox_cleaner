const EXECUTE_SELECTED_COMMAND = "execute-selected";

/** Sends a message to a tab, ignoring tabs without the content script. */
function sendToTab(tabId, message) {
  chrome.tabs.sendMessage(tabId, message, () => {
    // No content script on this tab (not Gmail, or not yet injected).
    void chrome.runtime.lastError;
  });
}

// Existing users updating from a version without onboarding have already found
// their way around, so skip the first-run welcome and tour for them.
const ONBOARDING_KEYS = ["onboardingPopupSeen", "onboardingSidebarSeen"];
chrome.runtime.onInstalled.addListener(({ reason, previousVersion }) => {
  if (reason !== "update" || !previousVersion) return;
  const [major, minor] = previousVersion.split(".").map(Number);
  if (major > 2 || (major === 2 && minor >= 5)) return;
  chrome.storage.local.set(Object.fromEntries(ONBOARDING_KEYS.map((key) => [key, true])));
});

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
