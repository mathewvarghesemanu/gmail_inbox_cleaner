// Keyboard shortcut (Chrome command) handling and shortcut hints.
(() => {
  const GC = window.__gc;
  if (!GC || GC.skipLoad) return;

  const { ARCHIVE_ALL_PAGES_LIKE_OPEN_COMMAND, COMMAND_ACTION_IDS, DEFAULT_COMMAND_SHORTCUTS,
    EXECUTE_SELECTED_COMMAND, SHORTCUT_HINT_TARGETS, STOP_EXECUTION_COMMAND, STRINGS, actionArchiveRecursive,
    actionSelectLikeOpen, findOpenEmailSender, getButtonLabel, getSelectedActionIds,
    isContextInvalidatedError, markExtensionContextInvalidated, normalizeEmail, recordStats,
    refreshControlStates, requestStopExecution, runActionByButtonId, runWithElapsedToast, setLog, setWorking,
    shouldStopExecution, showToast, state, triggerExecuteSelected } = GC;

  /** Runs Execute Selected from the keyboard shortcut, with UI-state guards. */
  function runExecuteSelectedFromShortcut() {
    const executeButton = document.getElementById("gc-execute-selected");
    if (!executeButton) return;
    // Respect the popup's hide toggle: no hidden actions from a hidden panel.
    if (isSidebarHiddenByToggle()) return;

    if (state.working || state.batchExecuting) {
      showToast(STRINGS.toast.alreadyRunning);
      return;
    }
    if (!getSelectedActionIds().length) {
      showToast(STRINGS.toast.selectActionFirst);
      return;
    }
    triggerExecuteSelected();
  }

  /** Returns whether the sidebar is hidden by the popup's "Show the extension" toggle. */
  function isSidebarHiddenByToggle() {
    const root = document.getElementById("gc-root");
    return !!root && root.style.display === "none";
  }

  /** Runs Select Like Open then Archive All Pages as one stoppable batch. */
  async function actionArchiveAllPagesLikeOpen() {
    if (state.working || state.batchExecuting) return;
    state.batchExecuting = true;
    state.stopExecutionRequested = false;
    setWorking(true);
    try {
      const sender = findOpenEmailSender();
      if (!sender) {
        setLog("Open an email first so I can detect its sender.");
        return;
      }
      // Drop any previous lock so a failed search cannot archive the old sender.
      state.lockedSender = "";
      state.lockedQuery = "";
      await actionSelectLikeOpen({ skipWorking: true });
      if (shouldStopExecution()) {
        setLog("Execution stopped.");
        showToast("Execution stopped");
        return;
      }
      if (!state.lockedQuery || state.lockedSender !== normalizeEmail(sender)) return;
      await actionArchiveRecursive({ skipWorking: true });
      recordStats({ batches: 1 });
    } finally {
      state.batchExecuting = false;
      state.stopExecutionRequested = false;
      setWorking(false);
    }
  }

  /** Dispatches a manifest command (relayed by the service worker) to its sidebar action. */
  function runCommandFromShortcut(command) {
    if (!document.getElementById("gc-root")) return;
    // Respect the popup's hide toggle: no hidden actions from a hidden panel.
    if (isSidebarHiddenByToggle()) return;

    if (command === EXECUTE_SELECTED_COMMAND) {
      runExecuteSelectedFromShortcut();
      return;
    }
    if (command === STOP_EXECUTION_COMMAND) {
      if (state.batchExecuting) {
        requestStopExecution();
        showToast("Stop requested");
      } else {
        showToast("Nothing to stop");
      }
      return;
    }
    if (state.working || state.batchExecuting) {
      showToast("Already running");
      return;
    }

    // Same enable rules as the sidebar buttons (e.g. most actions need an open email).
    findOpenEmailSender();
    refreshControlStates();

    if (command === ARCHIVE_ALL_PAGES_LIKE_OPEN_COMMAND) {
      if (!state.openSender) {
        showToast("Open an email first");
        return;
      }
      void runWithElapsedToast("Select Like Open + Archive All Pages", async () => {
        await actionArchiveAllPagesLikeOpen();
      });
      return;
    }

    const actionId = COMMAND_ACTION_IDS[command];
    if (!actionId) return;
    const button = document.getElementById(actionId);
    if (!button || button.disabled) {
      showToast("Open an email first");
      return;
    }
    void runWithElapsedToast(getButtonLabel(button), async () => {
      await runActionByButtonId(actionId);
    });
  }

  /** Renders shortcut hints (command name -> shortcut string) onto sidebar buttons. */
  function applyShortcutHints(shortcuts) {
    Object.entries(SHORTCUT_HINT_TARGETS).forEach(([elementId, command]) => {
      const el = document.getElementById(elementId);
      if (!el) return;
      const label = getButtonLabel(el);
      el.querySelector(".gc-shortcut-hint")?.remove();
      const shortcut = String(shortcuts?.[command] || "").trim();
      if (!shortcut) {
        el.removeAttribute("title");
        return;
      }
      const hint = document.createElement("span");
      hint.className = "gc-shortcut-hint";
      hint.textContent = shortcut;
      el.appendChild(hint);
      el.title = `${label} (${shortcut})`;
    });
  }

  /** Shows default shortcuts, then the user's real bindings fetched from the service worker. */
  function loadShortcutHints() {
    applyShortcutHints(DEFAULT_COMMAND_SHORTCUTS);
    if (state.extensionContextInvalidated) return;
    try {
      chrome.runtime.sendMessage({ type: "gc-get-shortcuts" }, (response) => {
        if (chrome.runtime?.lastError || !response?.ok || !response.shortcuts) return;
        applyShortcutHints(response.shortcuts);
      });
    } catch (error) {
      if (isContextInvalidatedError(error)) markExtensionContextInvalidated(error);
    }
  }

  /** Listens for Chrome commands relayed by the service worker. */
  function installShortcutCommandListener() {
    if (window.__gmailCleanerShortcutsInstalled) return;
    if (!chrome.runtime?.onMessage) return;
    window.__gmailCleanerShortcutsInstalled = true;
    try {
      chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (message?.type === "gc-execute-selected") {
          // Legacy message type, still sent for the execute-selected command.
          runCommandFromShortcut(EXECUTE_SELECTED_COMMAND);
        } else if (message?.type === "gc-command" && typeof message.command === "string") {
          runCommandFromShortcut(message.command);
        } else {
          return;
        }
        sendResponse({ ok: true });
      });
    } catch (error) {
      // Extension context can be invalidated after a reload; the next page load re-installs.
      console.log("[GmailCleaner] Shortcut listener not installed", error);
    }
  }

  Object.assign(GC, { actionArchiveAllPagesLikeOpen, applyShortcutHints, installShortcutCommandListener,
    isSidebarHiddenByToggle, loadShortcutHints, runCommandFromShortcut, runExecuteSelectedFromShortcut });
})();
