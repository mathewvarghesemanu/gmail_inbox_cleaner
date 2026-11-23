// Load guard, shared namespace (window.__gc), constants, UI strings and state.
(() => {
  // Double-load guard: if the content scripts were already injected into this page,
  // flag the existing namespace so the remaining src/*.js files skip themselves.
  if (window.__gmailCleanerLoaded) {
    if (window.__gc) window.__gc.skipLoad = true;
    return;
  }
  window.__gmailCleanerLoaded = true;
  /** Shared namespace for all content-script files (see manifest content_scripts order). */
  const GC = (window.__gc = { skipLoad: false });

  const state = {
    openSender: "",
    query: "",
    lockedSender: "",
    lockedQuery: "",
    selectedConversationsText: "",
    /** Cached "Go to Next Email" target (see createEmptyNextTarget for fields). */
    nextTarget: createEmptyNextTarget(),
    working: false,
    batchExecuting: false,
    stopExecutionRequested: false,
    extensionContextInvalidated: false
  };
  /**
   * The extension's own user-facing strings (sidebar, toasts, prompts), kept in one
   * place so they can be translated later (e.g. via chrome.i18n). Console/debug log
   * lines are intentionally left inline.
   */
  const STRINGS = {
    actions: {
      UNSUBSCRIBE_OPEN_EMAIL: "Unsubscribe Open Email",
      SELECT_LIKE_OPEN_EMAIL: "Select All Emails Like Open Email",
      ARCHIVE_THIS_PAGE: "Archive Listed Emails in This Page",
      ARCHIVE_ALL_PAGES: "Archive Listed Emails in All Pages",
      GO_TO_INBOX: "Go to Inbox",
      GO_TO_NEXT_PAGE: "Go to Next Email"
    },
    ui: {
      toggle: "Gmail unsubscriber",
      title: "Gmail Unsubscriber Ondevice",
      minimizeTitle: "Minimize",
      minimizeAria: "Minimize panel",
      working: "Working...",
      sectionPrepare: "Prepare",
      sectionArchive: "Archive",
      sectionInbox: "Inbox",
      selectActionAria: (label) => `Select ${label}`,
      showArchived: "Show Archived",
      executeSelected: "Execute Selected",
      stopExecution: "Stop Execution",
      proceed: "Proceed",
      proceedCountdown: (seconds) => `Proceed (${seconds})`,
      stop: "Stop",
      completed: "Completed",
      ready: "Ready.",
      actionFallback: "Action",
      undoArchive: "Undo archive",
      undoDismissAria: "Dismiss undo",
      notCached: "Not cached yet.",
      cachedTargetReady: "Cached target ready",
      emptyValue: "-",
      nextTargetLabels: {
        url: "URL",
        sender: "Sender",
        subject: "Subject",
        date: "Date",
        threadId: "Thread ID",
        threadToken: "Thread Token",
        pageOffset: "Page Offset",
        listHash: "List Context"
      }
    },
    toast: {
      elapsed: (label, elapsed) => `${label}: ${elapsed} elapsed`,
      alreadyRunning: "Already running",
      selectActionFirst: "Select at least one action first",
      executionStopped: "Execution stopped",
      nextTargetCached: "Next email target cached",
      searchComplete: "Search complete",
      archived: "Archived",
      archiveComplete: "Archive complete",
      alreadyUnsubscribed: (sender) => `Already unsubscribed: ${sender}`,
      unsubscribeComplete: "Unsubscribe complete",
      proceedingWithoutUnsubscribe: "Proceeding without unsubscribe",
      movedToInbox: "Moved to Inbox",
      showingArchived: "Showing archived",
      openedNextEmail: "Opened next email",
      noCachedTarget: "No cached email target",
      nextTargetUnavailable: "Couldn't find the next email; skipping Go to Next Email",
      executionFailed: "Execute Selected failed"
    },
    prompt: {
      noUnsubscribe:
        "No unsubscribe button/link found in this email. Proceed with remaining selected actions?"
    }
  };
  const LABELS = STRINGS.actions;
  const ACTION_BUTTON_IDS = {
    UNSUBSCRIBE: "gc-unsub",
    SELECT_LIKE_OPEN: "gc-like-open",
    ARCHIVE_THIS_PAGE: "gc-archive",
    ARCHIVE_ALL_PAGES: "gc-archive-rec",
    GO_TO_INBOX: "gc-inbox",
    GO_TO_NEXT_PAGE: "gc-next-page"
  };
  const SHOW_EXTENSION_KEY = "showExtensionEnabled";
  const ACTION_CHECKBOX_STATE_KEY = "actionCheckboxState";
  /** Actions checked on first run, before the user has saved any selection. */
  const DEFAULT_CHECKED_ACTION_IDS = new Set([
    ACTION_BUTTON_IDS.UNSUBSCRIBE,
    ACTION_BUTTON_IDS.SELECT_LIKE_OPEN,
    ACTION_BUTTON_IDS.ARCHIVE_ALL_PAGES,
    ACTION_BUTTON_IDS.GO_TO_NEXT_PAGE
  ]);
  const NEXT_EMAIL_TARGET_CACHE_KEY = "nextEmailTargetCache";
  /** Chrome command (manifest "commands") that runs Execute Selected. */
  const EXECUTE_SELECTED_COMMAND = "execute-selected";
  const IS_MAC = /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent || "");
  /** Default suggested_key, shown on the button; users can rebind it in Chrome. */
  const EXECUTE_SELECTED_SHORTCUT_LABEL = IS_MAC ? "\u2318\u21e7E" : "Ctrl+Shift+E";
  /** Composite command: Select Like Open, then Archive All Pages. */
  const ARCHIVE_ALL_PAGES_LIKE_OPEN_COMMAND = "archive-all-pages-like-open";
  const STOP_EXECUTION_COMMAND = "stop-execution";
  /** Manifest command name -> sidebar action button id. */
  const COMMAND_ACTION_IDS = {
    "unsubscribe-open": ACTION_BUTTON_IDS.UNSUBSCRIBE,
    "select-like-open": ACTION_BUTTON_IDS.SELECT_LIKE_OPEN,
    "archive-this-page": ACTION_BUTTON_IDS.ARCHIVE_THIS_PAGE,
    "archive-all-pages": ACTION_BUTTON_IDS.ARCHIVE_ALL_PAGES,
    "go-to-inbox": ACTION_BUTTON_IDS.GO_TO_INBOX,
    "go-to-next-email": ACTION_BUTTON_IDS.GO_TO_NEXT_PAGE
  };
  /** Manifest suggested_key defaults, used until the real bindings are fetched. */
  const DEFAULT_COMMAND_SHORTCUTS = {
    [EXECUTE_SELECTED_COMMAND]: EXECUTE_SELECTED_SHORTCUT_LABEL,
    "unsubscribe-open": IS_MAC ? "\u2318\u21e7U" : "Ctrl+Shift+U",
    "go-to-next-email": IS_MAC ? "\u2318\u21e7Y" : "Ctrl+Shift+Y",
    [ARCHIVE_ALL_PAGES_LIKE_OPEN_COMMAND]: IS_MAC ? "\u2318\u21e7K" : "Ctrl+Shift+K"
  };
  /** Sidebar element id -> command whose shortcut is shown on it. */
  const SHORTCUT_HINT_TARGETS = {
    "gc-execute-selected": EXECUTE_SELECTED_COMMAND,
    [ACTION_BUTTON_IDS.UNSUBSCRIBE]: "unsubscribe-open",
    [ACTION_BUTTON_IDS.SELECT_LIKE_OPEN]: "select-like-open",
    [ACTION_BUTTON_IDS.ARCHIVE_THIS_PAGE]: "archive-this-page",
    [ACTION_BUTTON_IDS.ARCHIVE_ALL_PAGES]: "archive-all-pages",
    [ACTION_BUTTON_IDS.GO_TO_INBOX]: "go-to-inbox",
    [ACTION_BUTTON_IDS.GO_TO_NEXT_PAGE]: "go-to-next-email",
    "gc-stop-execution": STOP_EXECUTION_COMMAND
  };
  /** Local-only usage counters (never sent anywhere). Shape documented in recordStats. */
  const STATS_KEY = "gcStats";
  const STATS_DAYS_KEPT = 30;
  const ROOT_POS_KEY = "gcRootPos";
  const CONTEXT_INVALIDATED_MESSAGE = "Extension context invalidated";
  const AUTO_PROCEED_SECONDS = 3;
  const AUTO_PROCEED_UNSUBSCRIBE_PROMPT_TEXT = "No unsubscribe button/link found";

  /** Returns an empty next-email target. */
  function createEmptyNextTarget() {
    return {
      url: "",
      sender: "",
      subject: "",
      date: "",
      threadId: "",
      threadToken: "",
      pageOffset: 0,
      listHash: "",
      sourceUrl: ""
    };
  }

  /** Persisted cache payload version; v1 was the flat shape {url, sender, ..., updatedAt}. */
  const NEXT_TARGET_CACHE_VERSION = 2;

  const SIGNATURE_MATCH_LOG_STYLE = "color: #0a8a3a; font-weight: 700;";

  const UNDO_GMAIL_OFFER_MS = 10000;
  const UNDO_ALL_OFFER_MS = 60000;

  Object.assign(GC, { ACTION_BUTTON_IDS, ACTION_CHECKBOX_STATE_KEY, ARCHIVE_ALL_PAGES_LIKE_OPEN_COMMAND,
    AUTO_PROCEED_SECONDS, AUTO_PROCEED_UNSUBSCRIBE_PROMPT_TEXT, COMMAND_ACTION_IDS,
    CONTEXT_INVALIDATED_MESSAGE, DEFAULT_CHECKED_ACTION_IDS, DEFAULT_COMMAND_SHORTCUTS,
    EXECUTE_SELECTED_COMMAND, EXECUTE_SELECTED_SHORTCUT_LABEL, IS_MAC, LABELS,
    NEXT_EMAIL_TARGET_CACHE_KEY, NEXT_TARGET_CACHE_VERSION, ROOT_POS_KEY, SHORTCUT_HINT_TARGETS,
    SHOW_EXTENSION_KEY, SIGNATURE_MATCH_LOG_STYLE, STATS_DAYS_KEPT, STATS_KEY, STOP_EXECUTION_COMMAND,
    STRINGS, UNDO_ALL_OFFER_MS, UNDO_GMAIL_OFFER_MS, createEmptyNextTarget, state });
})();
