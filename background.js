const EXECUTE_SELECTED_COMMAND = "execute-selected";

chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== EXECUTE_SELECTED_COMMAND) return;
  if (!tab?.id) return;

  chrome.tabs.sendMessage(tab.id, { type: "gc-execute-selected" }, () => {
    // No content script on this tab (not Gmail, or not yet injected).
    void chrome.runtime.lastError;
  });
});
