(() => {
  if (window.__gmailCleanerLoaded) return;
  window.__gmailCleanerLoaded = true;

  const state = {
    openSender: "",
    query: "",
    lockedSender: "",
    lockedQuery: "",
    selectedConversationsText: "",
    /** Cached "Go to Next Email" target (see createEmptyNextTarget for fields). */
    nextTarget: createEmptyNextTarget(),
    maxScanPages: 1,
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
      noCachedTarget: "No cached email target"
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
  const ROOT_POS_KEY = "gcRootPos";
  const DEFAULT_SCAN_PAGE_LIMIT = 5;
  const MIN_SCAN_PAGE_LIMIT = 1;
  const MAX_SCAN_PAGE_LIMIT = 200;
  state.maxScanPages = DEFAULT_SCAN_PAGE_LIMIT;

  /**
   * Gmail DOM selectors, centralized so Gmail markup changes are fixed in one place.
   *
   * Conventions:
   * - A string is a single CSS selector (may be a comma list; DOM order wins).
   * - An array is an ordered fallback chain: the first selector that matches wins.
   *   Where Gmail's obfuscated class names (e.g. "Cq", "aqL", "T-Jo") are used they
   *   either refine a stable attribute (gh=, role=, data-*) that follows as the
   *   fallback, or are the only known hook and are marked as such.
   */
  const SELECTORS = {
    // Layout / containers
    main: "div[role='main']",
    tabPanel: "div[role='tabpanel']",
    dialog: "[role='dialog']",
    dialogs: "div[role='alertdialog'], div[role='dialog']",
    blockquote: "blockquote",
    /** Mailbox (list view) action toolbar. gh='mtb' is stable; ".Cq.aqL" only refines it. */
    mailboxToolbar: ["div.Cq.aqL[gh='mtb']", "div[gh='mtb']"],
    /** Thread-list container (gh attribute is stable). */
    threadListContainer: "div[gh='tl']",
    /** Signals that a list view (toolbar or at least one row) has rendered. */
    listViewReady: "div[gh='mtb'], tr.zA",
    /** Generic clickable controls. */
    buttons: "div[role='button'], span[role='button'], button",
    roleLinkOrButton: "[role='link'], [role='button']",
    anchors: "a",
    anchorsWithHref: "a[href]",

    // Search
    searchInput: ["input[name='q']", "input[aria-label='Search mail']"],
    /** Search refinement chips (class-only hook; data-query is the payload). */
    refinementChips: "div.Ii[data-query]",
    /** Sender shown in the search header card (class-only hook). */
    headerSenderCandidates: "div.bX div.c5.J-J5-Ji, div.bX div.dp div.dr div.Cz.J-J5-Ji.e",

    // Open thread
    openThreadHeading: "h2.hP, h2[data-thread-perm-id]",
    openThreadHeadingInMain: "div[role='main'] h2.hP, div[role='main'] h2[data-thread-perm-id]",
    openThreadSubject: ["h2.hP", "h2[data-thread-perm-id]"],
    openThreadLegacyId: [
      "div[role='main'] h2[data-legacy-thread-id]",
      "div[role='main'] [data-thread-perm-id][data-legacy-thread-id]"
    ],
    /** Sender header of the open message: span[email] carries the address. */
    openSenderEmail: ["h3.iw span[email]", "h3.iw .gD[email]", "h3.iw span[email][name]"],
    openSenderName: ["h3.iw span[email][name]"],
    openSenderNameText: ["h3.iw .gD", "h3.iw span[email]"],
    openDateCandidates: "time, span.g3, span[title]",

    // Thread list rows
    threadRows: "tr[role='row'][jscontroller='ZdOxDb'], tr.zA",
    anyRow: "tr.zA, tr[role='row']",
    rowSenderPresence: "span[email], span.yP[email]",
    rowSubjectOrPreview: "span.bog, span.bqe, span.y2, td.xW span",
    rowSenderEmailAttr: ["span[email]", "span.yP[email]", "span.zF[email]"],
    rowSenderText: ["span[email]", "span.yP", "span.zF"],
    rowSenderNameAttr: ["span[email][name]", "span.yP[name]", "span.zF[name]"],
    rowSenderNameText: ["span[email]", "span.yP, span.zF, span.bA4 span"],
    rowSenderSpan: "span[email]",
    rowSubject: "span.bog",
    rowSubjectText: ["span.bog", "span.bqe"],
    rowPreview: "span.y2",
    rowDateTitled: "td.xW span[title]",
    rowDateLabeled: "td.xW span[aria-label]",
    rowDateShortText: ["td.xW .bq3", "td.xW span"],
    rowLegacyThreadId: "[data-legacy-thread-id]",
    rowCheckbox: "[role='checkbox']",
    rowOpenControl: ["span.bog", "td.xY a[href*='#']", "a[href*='#']"],

    // Selection
    /** Master "select" checkbox; class variants first, most specific to least. */
    masterCheckbox: [
      "span.T-Jo.J-J5-Ji.T-Jo-auq.T-Jo-iAfbIe[role='checkbox']",
      "span.T-Jo.J-J5-Ji.T-Jo-auq[role='checkbox']",
      "span.T-Jo.J-J5-Ji[role='checkbox']",
      // Locale/class independent: the only checkbox inside the mailbox toolbar.
      "div[gh='mtb'] [role='checkbox']"
    ],
    masterCheckboxInner: ".T-Jo-auh[role='presentation']",
    menu: ".J-M[role='menu']",
    menuItems: ".J-M[role='menu'] .J-N, .J-M[role='menu'] [role='menuitem']",
    menuItemLabelInMenu: ".J-M[role='menu'] .J-N-Jz",
    menuItemLabel: ".J-N-Jz",
    menuItem: ".J-N",

    // Archive
    toolbarControls: "div[role='button'], button, span[role='button']",
    /** Gmail action id for Archive on toolbar buttons (locale independent). */
    archiveAct: "7",

    // Pagination (locale-independent fallbacks used when "Older" text is not found)
    /** Pager group next to the "1–50 of N" counter; its last button is Older/next. */
    pagerButtons: ".Di [role='button']",
    /** Older/next-page button class (class-only hook). */
    olderButtonClass: "div.amJ[role='button']",

    // Unsubscribe
    unsubscribeCandidates: "button, [role='button'], [role='link'], a, span, div",
    unsubscribeActionable: "a, [role='button'], button",
    unsubscribeButtonLike: "button, [role='button'], a",
    roleLink: "[role='link']",
    /** Gmail's header "Unsubscribe" link class (class-only hook). */
    unsubscribeLinkClass: "Ca",
    dialogOkButton: "button[data-mdc-dialog-action='ok'], [role='button'][data-mdc-dialog-action='ok']",
    dialogButtons: "button, [role='button'], [role='link'], a, span",
    /** Material dialog dismiss buttons (locale independent). */
    dialogDismissButton: "[data-mdc-dialog-action='cancel'], [data-mdc-dialog-action='close']",
    noticeNodes: "div, span, p"
  };

  /**
   * English Gmail UI text used for matching aria-label / data-tooltip / text content.
   *
   * KNOWN LOCALE LIMITATIONS: Gmail localizes aria-labels, tooltips and visible text
   * to the user's UI language, so these strings only match English Gmail. Each use
   * site tries the English text first (unchanged behavior) and then a
   * locale-independent fallback where one is known:
   *   - Select dropdown: structural (button that wraps the master checkbox).
   *   - "All" menu item: Gmail's selector="all" attribute (already locale independent).
   *   - Archive: act="7" attribute; keyboard "e" as last resort.
   *   - Older / next page: pager group structure (.Di) and .amJ class.
   *   - Unsubscribe link: Gmail's ".Ca" header link class.
   *   - Unsubscribe dialogs: data-mdc-dialog-action attributes.
   *   - Search box: input[name='q'] (aria-label "Search mail" is only a fallback).
   * Still English-only (no reliable locale-independent hook known):
   *   - "Select all conversations that match this search" link (includeAllInSearch).
   *   - "Already unsubscribed" notice detection (findAlreadyUnsubscribedNotice).
   *   - Date parsing uses English month names (parseDateSignature); thread/legacy id
   *     matching does not depend on it, so next-email matching degrades gracefully.
   */
  const GMAIL_TEXT = {
    select: "select",
    all: "all",
    archive: "archive",
    olderSignals: ["older", "next page"],
    nextExact: "next",
    unsubscribe: "unsubscribe",
    cancel: "cancel",
    confirmSignals: ["unsubscribe", "confirm", "ok"],
    dismissSignals: ["done", "ok", "got it", "close", "dismiss", "cancel"],
    alreadyUnsubscribedKeywords: [
      "unsubscribed",
      "you are unsubscribed",
      "no longer receive",
      "won't get messages",
      "will not get messages",
      "won\u2019t get messages"
    ],
    selectAllInSearch: [
      /Select all conversations that match this search/i,
      /all conversations that match this search/i
    ]
  };

  /** Handles sleep. */
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  /** Returns the first element matching any selector in an ordered list (or a single selector). */
  function queryFirst(root, selectors) {
    if (!root) return null;
    const list = Array.isArray(selectors) ? selectors : [selectors];
    for (const selector of list) {
      const el = root.querySelector(selector);
      if (el) return el;
    }
    return null;
  }

  /** Returns the first non-empty attribute value across an ordered selector list. */
  function firstAttr(root, selectors, attr) {
    if (!root) return "";
    const list = Array.isArray(selectors) ? selectors : [selectors];
    for (const selector of list) {
      const value = root.querySelector(selector)?.getAttribute(attr);
      if (value) return value;
    }
    return "";
  }

  /** Returns the first non-empty trimmed textContent across an ordered selector list. */
  function firstText(root, selectors) {
    if (!root) return "";
    const list = Array.isArray(selectors) ? selectors : [selectors];
    for (const selector of list) {
      const value = root.querySelector(selector)?.textContent?.trim();
      if (value) return value;
    }
    return "";
  }

  /** Applies top/left position to a fixed element, clearing right/transform overrides. */
  function applyElPosition(el, top, left, clamp = true) {
    if (clamp) {
      const w = el.offsetWidth || 40;
      const h = el.offsetHeight || 40;
      top = Math.max(0, Math.min(top, window.innerHeight - h));
      left = Math.max(0, Math.min(left, window.innerWidth - w));
    }
    el.style.top = top + "px";
    el.style.left = left + "px";
    el.style.right = "auto";
    el.style.bottom = "auto";
    el.style.transform = "none";
  }

  /** Clears inline position so the element falls back to its CSS default placement. */
  function resetElPosition(el) {
    ["top", "left", "right", "bottom", "transform"].forEach((prop) => el.style.removeProperty(prop));
  }

  /** Keeps a dragged fixed element inside the viewport; resets to CSS default if barely visible. No-op while hidden or at default placement. */
  function keepElInView(el) {
    if (!el || !el.offsetWidth || !el.style.left) return;
    const minVisible = 40;
    const rect = el.getBoundingClientRect();
    const visibleW = Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0);
    const visibleH = Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0);
    if (visibleW < Math.min(minVisible, rect.width / 2) || visibleH < Math.min(minVisible, rect.height / 2)) {
      resetElPosition(el);
      return;
    }
    applyElPosition(el, rect.top, rect.left);
  }

  /** Makes a fixed element draggable. If posKey provided, persists position via chrome.storage.local. axis: "x"|"y"|null for both. */
  function makeDraggable(el, posKey, handleEl, axis) {
    if (!handleEl) handleEl = el;

    if (posKey) {
      safeStorageGet([posKey], (result) => {
        if (result[posKey]) {
          applyElPosition(el, result[posKey].top, result[posKey].left, false);
          keepElInView(el);
        }
      });
    }

    let drag = null;
    let didMove = false;

    handleEl.style.cursor = "grab";

    handleEl.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      if (e.target !== handleEl && e.target.closest("button,input,a,select,textarea")) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      drag = { startX: e.clientX, startY: e.clientY, origLeft: rect.left, origTop: rect.top };
      didMove = false;
      handleEl.style.cursor = "grabbing";
      document.body.style.userSelect = "none";
    });

    document.addEventListener("mousemove", (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      if (!didMove && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
      didMove = true;
      const newTop = axis === "x" ? drag.origTop : drag.origTop + dy;
      const newLeft = axis === "y" ? drag.origLeft : drag.origLeft + dx;
      applyElPosition(el, newTop, newLeft);
    });

    document.addEventListener("mouseup", () => {
      if (!drag) return;
      drag = null;
      handleEl.style.cursor = "grab";
      document.body.style.userSelect = "";
      if (didMove && posKey) {
        const rect = el.getBoundingClientRect();
        safeStorageSet({ [posKey]: { top: rect.top, left: rect.left } });
      }
    });

    if (el === handleEl) {
      handleEl.addEventListener("click", (e) => {
        if (didMove) {
          e.stopImmediatePropagation();
          e.preventDefault();
          didMove = false;
        }
      }, true);
    }
  }
  let successTimer = null;
  let proceedConfirmationResolver = null;
  let proceedAutoCountdownTimer = null;
  const toastQueue = [];
  let toastQueueActive = false;
  const CONTEXT_INVALIDATED_MESSAGE = "Extension context invalidated";
  const AUTO_PROCEED_SECONDS = 3;
  const AUTO_PROCEED_UNSUBSCRIBE_PROMPT_TEXT = "No unsubscribe button/link found";

  /** Checks whether context invalidated error. */
  function isContextInvalidatedError(error) {
    return String(error?.message || "").toLowerCase().includes("extension context invalidated");
  }

  /** Handles mark extension context invalidated. */
  function markExtensionContextInvalidated(error) {
    if (state.extensionContextInvalidated) return;
    state.extensionContextInvalidated = true;
    console.warn("[GmailCleaner] Extension context invalidated. Waiting for reinjection.", error);
  }

  /** Handles safe storage get. */
  function safeStorageGet(keys, onSuccess) {
    if (state.extensionContextInvalidated) return;
    try {
      chrome.storage.local.get(keys, (result) => {
        if (state.extensionContextInvalidated) return;
        const lastError = chrome.runtime?.lastError;
        if (lastError) {
          if (String(lastError.message || "").includes(CONTEXT_INVALIDATED_MESSAGE)) {
            markExtensionContextInvalidated(lastError);
          }
          return;
        }
        onSuccess(result);
      });
    } catch (error) {
      if (isContextInvalidatedError(error)) {
        markExtensionContextInvalidated(error);
        return;
      }
      throw error;
    }
  }

  /** Handles safe storage set. */
  function safeStorageSet(payload) {
    if (state.extensionContextInvalidated) return;
    try {
      chrome.storage.local.set(payload, () => {
        const lastError = chrome.runtime?.lastError;
        if (lastError && String(lastError.message || "").includes(CONTEXT_INVALIDATED_MESSAGE)) {
          markExtensionContextInvalidated(lastError);
        }
      });
    } catch (error) {
      if (isContextInvalidatedError(error)) {
        markExtensionContextInvalidated(error);
        return;
      }
      throw error;
    }
  }

  /**
   * Polls predicate until it returns a truthy value (which is returned) or the timeout
   * elapses (returns null). shouldAbort() is checked before each poll; when it returns
   * true the wait ends early with null. The predicate gets one last check at timeout.
   */
  async function waitFor(predicate, { timeout = 5000, interval = 100, shouldAbort = null } = {}) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (shouldAbort && shouldAbort()) return null;
      const value = predicate();
      if (value) return value;
      await sleep(interval);
    }
    if (shouldAbort && shouldAbort()) return null;
    return predicate() || null;
  }

  /** Waits for selector. */
  function waitForSelector(selector, timeout = 7000) {
    return waitFor(() => document.querySelector(selector), { timeout, interval: 150 });
  }

  /** Sets log. */
  function setLog(msg) {
    console.log(`[GmailCleaner] ${msg}`);
  }

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

  /**
   * Extracts the raw target fields from a stored cache payload.
   * Accepts both v2 ({ version, nextTarget: {...}, updatedAt }) and the legacy flat v1 shape.
   */
  function unwrapStoredNextTarget(cachedPayload) {
    if (!cachedPayload || typeof cachedPayload !== "object") return null;
    if (cachedPayload.nextTarget && typeof cachedPayload.nextTarget === "object") {
      return cachedPayload.nextTarget;
    }
    return cachedPayload;
  }

  /** Builds a normalized state.nextTarget from a stored cache payload (v1 or v2). */
  function nextTargetFromStored(cachedPayload) {
    const cached = unwrapStoredNextTarget(cachedPayload) || {};
    return {
      url: String(cached.url || ""),
      sender: normalizeEmail(cached.sender || ""),
      subject: String(cached.subject || "").trim(),
      date: String(cached.date || "").trim(),
      threadId: normalizeFingerprintText(cached.threadId || ""),
      threadToken: normalizeFingerprintText(cached.threadToken || ""),
      pageOffset: Math.max(0, Number.parseInt(String(cached.pageOffset ?? ""), 10) || 0),
      listHash: String(cached.listHash || "").trim().toLowerCase(),
      sourceUrl: normalizeComparableUrl(cached.sourceUrl || "")
    };
  }

  /** Returns cached next email payload (v2 shape) for storage. */
  function getCachedNextEmailPayload() {
    const target = state.nextTarget;
    return {
      version: NEXT_TARGET_CACHE_VERSION,
      nextTarget: {
        url: target.url || "",
        sender: target.sender || "",
        subject: target.subject || "",
        date: target.date || "",
        threadId: target.threadId || "",
        threadToken: target.threadToken || "",
        pageOffset: Number.isFinite(target.pageOffset) ? target.pageOffset : 0,
        listHash: target.listHash || "",
        sourceUrl: target.sourceUrl || ""
      },
      updatedAt: Date.now()
    };
  }

  /** Renders next email target section. */
  function renderNextEmailTargetSection() {
    const section = document.getElementById("gc-next-target-section");
    const summaryEl = document.getElementById("gc-next-target-summary-text");
    const urlEl = document.getElementById("gc-next-target-url");
    const senderEl = document.getElementById("gc-next-target-sender");
    const subjectEl = document.getElementById("gc-next-target-subject");
    const dateEl = document.getElementById("gc-next-target-date");
    const threadIdEl = document.getElementById("gc-next-target-thread-id");
    const threadTokenEl = document.getElementById("gc-next-target-thread-token");
    const pageOffsetEl = document.getElementById("gc-next-target-page-offset");
    const listHashEl = document.getElementById("gc-next-target-list-hash");
    if (!section || !summaryEl) return;

    const goNextChecked = isActionChecked(ACTION_BUTTON_IDS.GO_TO_NEXT_PAGE);
    section.classList.toggle("gc-hidden", !goNextChecked);
    if (!goNextChecked) return;

    if (!state.nextTarget.url) {
      const empty = STRINGS.ui.emptyValue;
      summaryEl.textContent = STRINGS.ui.notCached;
      if (urlEl) urlEl.textContent = STRINGS.ui.notCached;
      if (senderEl) senderEl.textContent = empty;
      if (subjectEl) subjectEl.textContent = empty;
      if (dateEl) dateEl.textContent = empty;
      if (threadIdEl) threadIdEl.textContent = empty;
      if (threadTokenEl) threadTokenEl.textContent = empty;
      if (pageOffsetEl) pageOffsetEl.textContent = "0";
      if (listHashEl) listHashEl.textContent = empty;
      return;
    }

    const summaryParts = [
      state.nextTarget.sender || "",
      state.nextTarget.subject || "",
      state.nextTarget.date || ""
    ].filter(Boolean);
    summaryEl.textContent = summaryParts.join(" | ") || STRINGS.ui.cachedTargetReady;
    if (urlEl) urlEl.textContent = state.nextTarget.url;
    if (senderEl) senderEl.textContent = state.nextTarget.sender || STRINGS.ui.emptyValue;
    if (subjectEl) subjectEl.textContent = state.nextTarget.subject || STRINGS.ui.emptyValue;
    if (dateEl) dateEl.textContent = state.nextTarget.date || STRINGS.ui.emptyValue;
    if (threadIdEl) threadIdEl.textContent = state.nextTarget.threadId || STRINGS.ui.emptyValue;
    if (threadTokenEl) threadTokenEl.textContent = state.nextTarget.threadToken || STRINGS.ui.emptyValue;
    if (pageOffsetEl) pageOffsetEl.textContent = String(state.nextTarget.pageOffset || 0);
    if (listHashEl) listHashEl.textContent = state.nextTarget.listHash || STRINGS.ui.emptyValue;
  }

  /** Persists cached next email target. */
  function persistCachedNextEmailTarget() {
    safeStorageSet({ [NEXT_EMAIL_TARGET_CACHE_KEY]: getCachedNextEmailPayload() });
    renderNextEmailTargetSection();
  }

  /** Clears cached next email target. */
  function clearCachedNextEmailTarget() {
    state.nextTarget = createEmptyNextTarget();
    persistCachedNextEmailTarget();
  }

  /** Checks whether cached target valid for current context. */
  function isCachedTargetValidForCurrentContext(cachedPayload) {
    const cached = unwrapStoredNextTarget(cachedPayload);
    const url = String(cached?.url || "").trim();
    if (!url) return false;
    const sourceUrl = normalizeComparableUrl(cached?.sourceUrl || "");
    const currentUrl = normalizeComparableUrl(location.href);
    if (!sourceUrl || !currentUrl) return false;
    return sourceUrl === currentUrl;
  }

  /** Loads cached next email target. */
  function loadCachedNextEmailTarget() {
    safeStorageGet([NEXT_EMAIL_TARGET_CACHE_KEY], (result) => {
      const cached = result[NEXT_EMAIL_TARGET_CACHE_KEY];
      if (!cached || typeof cached !== "object") return;
      if (!isCachedTargetValidForCurrentContext(cached)) {
        state.nextTarget = createEmptyNextTarget();
        renderNextEmailTargetSection();
        return;
      }
      state.nextTarget = nextTargetFromStored(cached);
      renderNextEmailTargetSection();
    });
  }

  /** Handles announce email target status. */
  function announceEmailTargetStatus(prefix = "Email target status") {
    renderNextEmailTargetSection();
    if (state.nextTarget.url) {
      const parts = [
        state.nextTarget.url,
        state.nextTarget.sender || "",
        state.nextTarget.subject || "",
        state.nextTarget.date || ""
      ].filter(Boolean);
      setLog(`${prefix}: ${parts.join(" | ")}`);
      return;
    }
    setLog(`${prefix}: none`);
  }

  /** Handles flash success. */
  function flashSuccess(message = STRINGS.ui.completed) {
    const badge = document.getElementById("gc-success");
    if (!badge) return;

    const label = badge.querySelector(".gc-success-text");
    if (label) label.textContent = message;

    badge.classList.add("gc-success-visible");
    if (successTimer) clearTimeout(successTimer);
    successTimer = setTimeout(() => {
      badge.classList.remove("gc-success-visible");
      successTimer = null;
    }, 2200);
  }

  /** Handles flush toast queue. */
  async function flushToastQueue() {
    if (toastQueueActive) return;
    toastQueueActive = true;

    const toast = document.getElementById("gc-toast");
    if (!toast) {
      toastQueue.length = 0;
      toastQueueActive = false;
      return;
    }

    while (toastQueue.length > 0) {
      const next = toastQueue.shift();
      if (!next) continue;

      toast.textContent = next.message;
      toast.classList.add("gc-toast-visible");
      await sleep(next.durationMs);
      toast.classList.remove("gc-toast-visible");
      await sleep(140);
    }

    toastQueueActive = false;
  }

  /** Handles show toast. */
  function showToast(message, options = {}) {
    const durationMs = options.durationMs || 2400;
    const toast = document.getElementById("gc-toast");
    if (!toast) return;
    toastQueue.push({ message, durationMs });
    void flushToastQueue();
  }

  /** Formats elapsed ms. */
  function formatElapsedMs(ms) {
    if (ms < 1000) return `${Math.max(1, Math.round(ms))}ms`;
    const seconds = ms / 1000;
    return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  }

  /** Runs with elapsed toast. */
  async function runWithElapsedToast(label, runner) {
    const start = performance.now();
    try {
      await runner();
    } finally {
      const elapsed = performance.now() - start;
      showToast(STRINGS.toast.elapsed(label, formatElapsedMs(elapsed)));
    }
  }

  /** Handles hide proceed confirmation. */
  function hideProceedConfirmation() {
    stopProceedAutoCountdown();
    const box = document.getElementById("gc-confirm");
    if (!box) return;
    box.classList.remove("gc-confirm-visible");
  }

  /** Updates proceed button label. */
  function setProceedButtonLabel(label) {
    const proceedBtn = document.getElementById("gc-confirm-proceed");
    if (!proceedBtn) return;
    proceedBtn.textContent = label;
  }

  /** Stops auto proceed countdown. */
  function stopProceedAutoCountdown() {
    if (proceedAutoCountdownTimer) {
      clearInterval(proceedAutoCountdownTimer);
      proceedAutoCountdownTimer = null;
    }
    setProceedButtonLabel(STRINGS.ui.proceed);
  }

  /** Starts auto proceed countdown. */
  function startProceedAutoCountdown(seconds = AUTO_PROCEED_SECONDS) {
    stopProceedAutoCountdown();
    let remainingSeconds = Math.max(1, Number.parseInt(String(seconds ?? ""), 10) || AUTO_PROCEED_SECONDS);
    setProceedButtonLabel(STRINGS.ui.proceedCountdown(remainingSeconds));
    proceedAutoCountdownTimer = setInterval(() => {
      remainingSeconds -= 1;
      if (remainingSeconds <= 0) {
        stopProceedAutoCountdown();
        if (proceedConfirmationResolver) {
          resolveProceedConfirmation(true);
        }
        return;
      }
      setProceedButtonLabel(STRINGS.ui.proceedCountdown(remainingSeconds));
    }, 1000);
  }

  /** Resolves proceed confirmation. */
  function resolveProceedConfirmation(result) {
    const resolver = proceedConfirmationResolver;
    proceedConfirmationResolver = null;
    hideProceedConfirmation();
    if (resolver) resolver(result);
  }

  /** Handles ask proceed confirmation. */
  function askProceedConfirmation(message) {
    const box = document.getElementById("gc-confirm");
    const messageEl = document.getElementById("gc-confirm-message");
    if (!box || !messageEl) return Promise.resolve(false);

    if (proceedConfirmationResolver) {
      resolveProceedConfirmation(false);
    }

    messageEl.textContent = message;
    box.classList.add("gc-confirm-visible");
    if (String(message || "").includes(AUTO_PROCEED_UNSUBSCRIBE_PROMPT_TEXT)) {
      startProceedAutoCountdown(AUTO_PROCEED_SECONDS);
    } else {
      stopProceedAutoCountdown();
    }

    return new Promise((resolve) => {
      proceedConfirmationResolver = resolve;
    });
  }

  /** Sets working. */
  function setWorking(next) {
    state.working = next;
    refreshControlStates();
  }

  /** Refreshes all control enabled/disabled states based on current working and email-open state. */
  function refreshControlStates() {
    const emailOpen = !!state.openSender;
    const working = state.working;
    const noEmailExempt = new Set([ACTION_BUTTON_IDS.GO_TO_INBOX, "gc-show-archived"]);

    document.querySelectorAll(".gc-btn").forEach((btn) => {
      if (working) {
        btn.disabled = true;
      } else if (!emailOpen) {
        btn.disabled = !noEmailExempt.has(btn.id);
      } else {
        btn.disabled = false;
      }
    });

    document.querySelectorAll(".gc-action-checkbox").forEach((checkbox) => {
      checkbox.disabled = working || !emailOpen;
    });

    const workingEl = document.getElementById("gc-working");
    if (workingEl) {
      workingEl.classList.toggle("gc-working-visible", working);
      workingEl.setAttribute("aria-hidden", working ? "false" : "true");
    }

    updateExecuteSelectedState();
  }

  /** Detects current email open state and refreshes controls. No-op while action in progress. */
  function refreshOpenEmailState() {
    if (state.working) return;
    findOpenEmailSender();
    refreshControlStates();
  }

  /** Normalizes scan page limit. */
  function normalizeScanPageLimit(raw) {
    const parsed = Number.parseInt(String(raw ?? ""), 10);
    if (!Number.isFinite(parsed)) return DEFAULT_SCAN_PAGE_LIMIT;
    return Math.min(MAX_SCAN_PAGE_LIMIT, Math.max(MIN_SCAN_PAGE_LIMIT, parsed));
  }

  /** Checks whether editable target. */
  function isEditableTarget(target) {
    if (!target) return false;
    const tag = (target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return true;
    if (target.isContentEditable) return true;
    return Boolean(target.closest?.("[contenteditable='true']"));
  }

  /** Returns action handler. */
  function getActionHandler(buttonId) {
    const handlers = {
      [ACTION_BUTTON_IDS.UNSUBSCRIBE]: actionUnsubscribe,
      [ACTION_BUTTON_IDS.SELECT_LIKE_OPEN]: actionSelectLikeOpen,
      [ACTION_BUTTON_IDS.ARCHIVE_THIS_PAGE]: actionArchiveAll,
      [ACTION_BUTTON_IDS.ARCHIVE_ALL_PAGES]: actionArchiveRecursive,
      [ACTION_BUTTON_IDS.GO_TO_INBOX]: actionGoInbox,
      [ACTION_BUTTON_IDS.GO_TO_NEXT_PAGE]: actionGoNextPage
    };
    return handlers[buttonId] || null;
  }

  /** Runs action by button id. */
  async function runActionByButtonId(buttonId, options = {}) {
    const handler = getActionHandler(buttonId);
    if (!handler) return;
    await handler(options);
  }

  /** Returns selected action ids. */
  function getSelectedActionIds() {
    return [...document.querySelectorAll(".gc-action-checkbox:checked")]
      .map((checkbox) => checkbox.getAttribute("data-action-id") || "")
      .filter(Boolean);
  }

  /** Checks whether action checked. */
  function isActionChecked(actionId) {
    return !!document.querySelector(`.gc-action-checkbox[data-action-id='${actionId}']:checked`);
  }

  /** Persists action checkbox state. */
  function persistActionCheckboxState() {
    const stateByAction = {};
    document.querySelectorAll(".gc-action-checkbox").forEach((checkbox) => {
      const actionId = checkbox.getAttribute("data-action-id") || "";
      if (!actionId) return;
      stateByAction[actionId] = checkbox.checked;
    });
    safeStorageSet({ [ACTION_CHECKBOX_STATE_KEY]: stateByAction });
  }

  /** Restores action checkbox state. */
  function restoreActionCheckboxState() {
    safeStorageGet([ACTION_CHECKBOX_STATE_KEY], (result) => {
      const stored = result[ACTION_CHECKBOX_STATE_KEY];
      const hasSaved = !!stored && typeof stored === "object";
      const saved = hasSaved ? stored : {};

      document.querySelectorAll(".gc-action-checkbox").forEach((checkbox) => {
        const actionId = checkbox.getAttribute("data-action-id") || "";
        if (!actionId) return;
        checkbox.checked = actionId in saved ? saved[actionId] === true : DEFAULT_CHECKED_ACTION_IDS.has(actionId);
      });
      if (!hasSaved) persistActionCheckboxState();
      renderNextEmailTargetSection();
      updateExecuteSelectedState();
    });
  }

  /** Updates execute selected state. */
  function updateExecuteSelectedState() {
    const executeButton = document.getElementById("gc-execute-selected");
    const stopButton = document.getElementById("gc-stop-execution");
    if (!executeButton) return;

    const hasSelections = getSelectedActionIds().length > 0;
    executeButton.dataset.ready = hasSelections ? "true" : "false";
    executeButton.disabled = state.working || !hasSelections;
    if (stopButton) {
      stopButton.disabled = !state.batchExecuting;
    }
  }

  /** Runs Execute Selected with the shared toast wrapper. */
  function triggerExecuteSelected() {
    void runWithElapsedToast(STRINGS.ui.executeSelected, async () => {
      await executeSelectedActions();
    });
  }

  /** Runs Execute Selected from the keyboard shortcut, with UI-state guards. */
  function runExecuteSelectedFromShortcut() {
    const executeButton = document.getElementById("gc-execute-selected");
    if (!executeButton) return;
    // Respect the popup's hide toggle: no hidden actions from a hidden panel.
    const root = document.getElementById("gc-root");
    if (root && root.style.display === "none") return;

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

  /** Listens for the Chrome command relayed by the service worker. */
  function installShortcutCommandListener() {
    if (window.__gmailCleanerShortcutsInstalled) return;
    if (!chrome.runtime?.onMessage) return;
    window.__gmailCleanerShortcutsInstalled = true;
    try {
      chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (message?.type !== "gc-execute-selected") return;
        runExecuteSelectedFromShortcut();
        sendResponse({ ok: true });
      });
    } catch (error) {
      // Extension context can be invalidated after a reload; the next page load re-installs.
      console.log("[GmailCleaner] Shortcut listener not installed", error);
    }
  }

  /** Requests stop execution. */
  function requestStopExecution() {
    if (!state.batchExecuting) return;
    state.stopExecutionRequested = true;
    setLog("Stop requested. Finishing current step...");
  }

  /** Handles should stop execution. */
  function shouldStopExecution() {
    return state.batchExecuting && state.stopExecutionRequested;
  }

  /** Handles should prepare next email target for batch. */
  function shouldPrepareNextEmailTargetForBatch(selectedActionIds) {
    const hasGoNext = selectedActionIds.includes(ACTION_BUTTON_IDS.GO_TO_NEXT_PAGE);
    if (!hasGoNext) return false;
    const hasSelectLikeOpen = selectedActionIds.includes(ACTION_BUTTON_IDS.SELECT_LIKE_OPEN);
    const hasUnsubscribe = selectedActionIds.includes(ACTION_BUTTON_IDS.UNSUBSCRIBE);
    const hasArchive =
      selectedActionIds.includes(ACTION_BUTTON_IDS.ARCHIVE_THIS_PAGE) ||
      selectedActionIds.includes(ACTION_BUTTON_IDS.ARCHIVE_ALL_PAGES);
    return hasSelectLikeOpen || (hasUnsubscribe && hasArchive);
  }

  /** Prepares next email target for batch selection. */
  async function prepareNextEmailTargetForBatchSelection(selectedActionIds) {
    if (!shouldPrepareNextEmailTargetForBatch(selectedActionIds)) return;
    setLog("Execute Selected: preparing next-email target from current open email...");
    const sender = findOpenEmailSender();
    if (!sender) {
      throw new Error("Open an email first so I can prepare the next-email target.");
    }
    const openThreadUrl = location.href;
    const cached = await cacheNextEmailTargetForSender(sender, { returnToUrl: openThreadUrl });
    if (!cached || !state.nextTarget.url) {
      announceEmailTargetStatus("Email target before run");
      throw new Error("Could not prepare next-email target before batch execution.");
    }
    announceEmailTargetStatus("Email target before run");
  }

  /** Executes selected actions. */
  async function executeSelectedActions() {
    if (state.working || state.batchExecuting) return;
    const selectedActionIds = getSelectedActionIds();
    if (!selectedActionIds.length) {
      updateExecuteSelectedState();
      return;
    }

    state.batchExecuting = true;
    state.stopExecutionRequested = false;
    setWorking(true);
    try {
      await prepareNextEmailTargetForBatchSelection(selectedActionIds);
      if (
        selectedActionIds.length === 1 &&
        selectedActionIds[0] === ACTION_BUTTON_IDS.GO_TO_NEXT_PAGE
      ) {
        setLog("Execute All: Go to Next Email selected.");
        announceEmailTargetStatus("Email target before run");
      }
      for (let index = 0; index < selectedActionIds.length; index += 1) {
        if (shouldStopExecution()) break;
        const actionId = selectedActionIds[index];
        const nextActionId = selectedActionIds[index + 1] || "";
        await runActionByButtonId(actionId, { skipWorking: true });
        if (shouldStopExecution()) break;
        if (index < selectedActionIds.length - 1 && shouldWaitBetweenActions(actionId, nextActionId)) {
          await waitForListToLoadForBatchStep();
        }
      }
      if (shouldStopExecution()) {
        setLog("Execution stopped.");
        showToast(STRINGS.toast.executionStopped);
      }
    } finally {
      clearCachedNextEmailTarget();
      setLog("Execution complete. Cleared cached next email target.");
      state.batchExecuting = false;
      state.stopExecutionRequested = false;
      setWorking(false);
    }
  }

  /** Handles should wait between actions. */
  function shouldWaitBetweenActions(currentActionId, nextActionId) {
    // Unsubscribe runs in open-thread view; waiting for list rows here can add
    // unnecessary latency before the next action that already manages navigation.
    if (currentActionId === ACTION_BUTTON_IDS.UNSUBSCRIBE) return false;
    // If the next step navigates away, waiting for list rows is unnecessary
    // and can add long delays when archive emptied the current filtered results.
    if (nextActionId === ACTION_BUTTON_IDS.GO_TO_INBOX) return false;
    if (nextActionId === ACTION_BUTTON_IDS.GO_TO_NEXT_PAGE) return false;
    return true;
  }

  /** Waits for list to load for batch step. */
  async function waitForListToLoadForBatchStep(timeout = 6000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (shouldStopExecution()) return false;
      await dismissUnsubscribeDialogs(1);
      const rows = getThreadRows();
      if (rows.length > 0) {
        await sleep(120);
        return true;
      }

      const hasVisibleToolbar = !!getMailboxToolbar();
      if (hasVisibleToolbar) {
        await waitForThreadRows(1200);
        if (getThreadRows().length > 0) {
          await sleep(120);
          return true;
        }
      }

      await sleep(120);
    }

    // Keep flow resilient if Gmail is slow or there are simply no rows.
    await sleep(200);
    return false;
  }

  /** Sets extension visibility. */
  function setExtensionVisibility(enabled) {
    const toggle = document.getElementById("gc-toggle");
    const root = document.getElementById("gc-root");
    if (toggle) toggle.style.display = enabled ? "" : "none";
    if (root) {
      if (!enabled) root.classList.add("gc-hidden");
      root.style.display = enabled ? "" : "none";
    }
  }

  /** Handles sync extension visibility from storage. */
  function syncExtensionVisibilityFromStorage() {
    if (state.extensionContextInvalidated) return;
    safeStorageGet([SHOW_EXTENSION_KEY], (result) => {
      setExtensionVisibility(result[SHOW_EXTENSION_KEY] !== false);
    });
  }

  /** Returns open thread root. */
  function getOpenThreadRoot() {
    const main = document.querySelector(SELECTORS.main);
    if (!main) return null;
    const hasOpenThread = !!main.querySelector(SELECTORS.openThreadHeading);
    if (!hasOpenThread) return null;
    return main;
  }

  /** Finds open email sender. */
  function findOpenEmailSender() {
    const threadRoot = getOpenThreadRoot();
    if (!threadRoot) {
      state.openSender = "";
      console.log("[GmailCleaner] Step 4 sender-only", {
        senderOnly: "",
        hasOpenThreadRoot: false
      });
      return "";
    }

    const openSender = firstAttr(threadRoot, SELECTORS.openSenderEmail, "email") || "";

    state.openSender = openSender;
    console.log("[GmailCleaner] Step 4 sender-only", {
      senderOnly: normalizeEmail(openSender || ""),
      hasOpenThreadRoot: true
    });
    return openSender;
  }

  /** Returns thread rows. */
  function getThreadRows() {
    const candidates = [
      ...document.querySelectorAll(SELECTORS.threadRows)
    ];

    const uniqueRows = [...new Set(candidates)];
    return uniqueRows.filter((row) => {
      if (!isVisible(row)) return false;
      const main = row.closest(SELECTORS.main);
      if (!main || !isVisible(main)) return false;
      const tabPanel = row.closest(SELECTORS.tabPanel);
      if (tabPanel && !isVisible(tabPanel)) return false;
      const hasSender = !!row.querySelector(SELECTORS.rowSenderPresence);
      const hasSubjectOrPreview = !!row.querySelector(SELECTORS.rowSubjectOrPreview);
      return hasSender && hasSubjectOrPreview;
    });
  }

  /** Waits for thread rows. */
  async function waitForThreadRows(timeout = 12000) {
    const rows = await waitFor(() => {
      const found = getThreadRows();
      return found.length > 0 ? found : null;
    }, { timeout, interval: 140, shouldAbort: shouldStopExecution });
    return rows || [];
  }

  /** Handles row to item. */
  function rowToItem(row) {
    const sender =
      firstAttr(row, SELECTORS.rowSenderSpan, "email") ||
      firstText(row, SELECTORS.rowSenderSpan) ||
      "Unknown sender";
    const subject = firstText(row, SELECTORS.rowSubject) || "(No subject)";
    return { sender, subject };
  }

  /** Renders list. */
  function renderList(items, title = "Email list") {
    void items;
    void title;
  }

  /** Handles escape html. */
  function escapeHtml(value) {
    return value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  /** Triggers key sequence. */
  function triggerKeySequence(sequence) {
    for (const key of sequence) {
      const down = new KeyboardEvent("keydown", {
        key,
        bubbles: true,
        cancelable: true
      });
      document.dispatchEvent(down);

      const up = new KeyboardEvent("keyup", {
        key,
        bubbles: true,
        cancelable: true
      });
      document.dispatchEvent(up);
    }
  }

  /** Normalizes query. */
  function normalizeQuery(value) {
    return (value || "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  /** Normalizes email. */
  function normalizeEmail(value) {
    return (value || "").trim().toLowerCase();
  }

  /** Handles sender signal matches expected. */
  function senderSignalMatchesExpected(signal, expected) {
    const lhs = normalizeEmail(signal);
    const rhs = normalizeEmail(expected);
    if (!lhs || !rhs) return false;
    if (lhs === rhs) return true;

    // Gmail may visually truncate sender text (e.g. "name@subst").
    return rhs.startsWith(lhs) || lhs.startsWith(rhs);
  }

  /** Extracts sender from query. */
  function extractSenderFromQuery(query) {
    const match = (query || "").match(/\bfrom:([^\s]+)/i);
    if (!match) return "";
    return normalizeEmail(match[1].replace(/^"|"$/g, ""));
  }

  /** Returns current search input. */
  function getCurrentSearchInput() {
    return queryFirst(document, SELECTORS.searchInput);
  }

  /** Returns current search query. */
  function getCurrentSearchQuery() {
    const input = getCurrentSearchInput();
    return normalizeQuery(input?.value || "");
  }

  /** Returns refinement query. */
  function getRefinementQuery() {
    const chips = [...document.querySelectorAll(SELECTORS.refinementChips)].filter((el) => isVisible(el));
    const best = chips
      .map((el) => normalizeQuery(el.getAttribute("data-query") || ""))
      .sort((a, b) => b.length - a.length)[0];
    return best || "";
  }

  /** Returns header sender signals. */
  function getHeaderSenderSignals() {
    /** Extracts email from text. */
    const extractEmailFromText = (text) => {
      const match = (text || "").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
      return normalizeEmail(match?.[0] || "");
    };

    const candidates = [
      ...document.querySelectorAll(SELECTORS.headerSenderCandidates)
    ]
      .filter((el) => isVisible(el))
      .map((el) => extractEmailFromText(el.textContent || ""))
      .filter(Boolean)
      .filter((value) => value.includes("@"));

    return [...new Set(candidates)];
  }

  /** Returns row sender signals. */
  function getRowSenderSignals(limit = 15) {
    const rows = getThreadRows().slice(0, limit);
    return rows
      .map((row) => normalizeEmail(firstAttr(row, SELECTORS.rowSenderSpan, "email")))
      .filter(Boolean);
  }

  /** Validates locked archive context. */
  function validateLockedArchiveContext() {
    const expectedQuery = normalizeQuery(state.lockedQuery || state.query || "");
    const expectedSender = normalizeEmail(state.lockedSender || extractSenderFromQuery(expectedQuery));
    if (!expectedQuery || !expectedSender) {
      throw new Error(`Safety check failed: run '${LABELS.SELECT_LIKE_OPEN_EMAIL}' before archiving.`);
    }

    const currentQuery = getCurrentSearchQuery();
    const refinementQuery = getRefinementQuery();
    const headerSenders = getHeaderSenderSignals();
    const rowSenders = getRowSenderSignals();

    if (currentQuery && currentQuery !== expectedQuery) {
      throw new Error("Safety check failed: current search query does not match the selected sender context.");
    }

    if (refinementQuery && refinementQuery !== expectedQuery) {
      throw new Error("Safety check failed: Gmail search filter does not match the selected sender context.");
    }

    const mismatchedHeader = headerSenders.find(
      (sender) => !senderSignalMatchesExpected(sender, expectedSender)
    );
    if (mismatchedHeader) {
      throw new Error("Safety check failed: page header sender differs from the sender selected earlier.");
    }

    const hasExpectedInRows = rowSenders.some((sender) =>
      senderSignalMatchesExpected(sender, expectedSender)
    );
    if (rowSenders.length > 0 && !hasExpectedInRows) {
      throw new Error("Safety check failed: expected sender is not present in listed emails.");
    }

    const mismatchedRows = rowSenders.filter(
      (sender) => !senderSignalMatchesExpected(sender, expectedSender)
    );
    void mismatchedRows;

    const hasAnySignal =
      !!currentQuery ||
      !!refinementQuery ||
      headerSenders.length > 0 ||
      rowSenders.length > 0;
    if (!hasAnySignal) {
      throw new Error("Safety check failed: could not confirm Gmail sender/search context.");
    }
  }

  /** Waits for Gmail to route away from a known URL. */
  async function waitForUrlChange(previousUrl, timeout = 2000) {
    await waitFor(() => location.href !== previousUrl, {
      timeout,
      interval: 60,
      shouldAbort: shouldStopExecution
    });
    return location.href !== previousUrl;
  }

  /** Runs search query. */
  async function runSearchQuery(query) {
    state.query = query;
    const searchInput = getCurrentSearchInput();
    if (!searchInput) {
      throw new Error("Could not find Gmail search box.");
    }

    const previousUrl = location.href;
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;

    searchInput.focus();
    if (nativeSetter) {
      nativeSetter.call(searchInput, query);
    } else {
      searchInput.value = query;
    }
    searchInput.dispatchEvent(new InputEvent("input", { bubbles: true }));
    searchInput.dispatchEvent(new Event("change", { bubbles: true }));

    /** Handles press enter on search. */
    const pressEnterOnSearch = () => {
      searchInput.focus();
      const down = new KeyboardEvent("keydown", {
        key: "Enter",
        code: "Enter",
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true
      });
      const press = new KeyboardEvent("keypress", {
        key: "Enter",
        code: "Enter",
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true
      });
      const up = new KeyboardEvent("keyup", {
        key: "Enter",
        code: "Enter",
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true
      });

      searchInput.dispatchEvent(down);
      searchInput.dispatchEvent(press);
      searchInput.dispatchEvent(up);
      document.dispatchEvent(down);
      document.dispatchEvent(press);
      document.dispatchEvent(up);
    };

    pressEnterOnSearch();

    // Gmail routes to #search asynchronously. Poll for it rather than paying a
    // fixed sleep budget: the common case settles in ~300ms, not 700ms.
    let routed = await waitForUrlChange(previousUrl, 2000);

    // Gmail sometimes needs a second Enter to execute from filled search box.
    if (!routed) {
      pressEnterOnSearch();
      routed = await waitForUrlChange(previousUrl, 1500);
    }

    // Fallback only if Enter didn't trigger the search route.
    if (!routed) {
      window.location.hash = `#search/${encodeURIComponent(query)}`;
      await waitForUrlChange(previousUrl, 1500);
    }

    await waitForThreadRows(12000);
    await sleep(150);
    return query;
  }

  /** Handles search by sender. */
  async function searchBySender(sender) {
    const query = `from:${sender} in:inbox`;
    return runSearchQuery(query);
  }

  /** Ensures search context. */
  async function ensureSearchContext(query) {
    if (!query) {
      throw new Error(`Missing search query. Run '${LABELS.SELECT_LIKE_OPEN_EMAIL}' first.`);
    }

    const currentQuery = getCurrentSearchQuery();
    const expected = normalizeQuery(query);
    if (currentQuery === expected) return;

    setLog(`Restoring search context: ${query}`);
    await runSearchQuery(query);

    const afterQuery = getCurrentSearchQuery();
    if (afterQuery !== expected) {
      throw new Error("Safety check failed: could not confirm the intended search context.");
    }
  }

  /** Finds master checkbox. */
  function findMasterCheckbox(toolbar) {
    return queryFirst(toolbar, SELECTORS.masterCheckbox);
  }

  /** Finds select button. */
  function findSelectButton(toolbar) {
    const byText = [...toolbar.querySelectorAll(SELECTORS.buttons)].find((el) => {
      const aria = (el.getAttribute("aria-label") || "").toLowerCase();
      const tooltip = (el.getAttribute("data-tooltip") || "").toLowerCase();
      return isVisible(el) && (aria === GMAIL_TEXT.select || tooltip === GMAIL_TEXT.select);
    });
    if (byText) return byText;
    // Locale-independent fallback: the Select dropdown is the button wrapping the master checkbox.
    const wrapper = findMasterCheckbox(toolbar)?.closest("[role='button']");
    return wrapper && isVisible(wrapper) ? wrapper : undefined;
  }

  /** Finds all menu item. */
  function findAllMenuItem() {
    const direct = [...document.querySelectorAll(SELECTORS.menuItems)]
      .find((el) => {
        if (!isVisible(el)) return false;
        const selector = (el.getAttribute("selector") || "").toLowerCase();
        const text = (el.textContent || "").trim().toLowerCase();
        const aria = (el.getAttribute("aria-label") || "").trim().toLowerCase();
        return selector === GMAIL_TEXT.all || text === GMAIL_TEXT.all || aria === GMAIL_TEXT.all;
      });
    if (direct) return direct;

    const nestedLabel = [...document.querySelectorAll(SELECTORS.menuItemLabelInMenu)].find((el) => {
      if (!isVisible(el)) return false;
      return (el.textContent || "").trim().toLowerCase() === GMAIL_TEXT.all;
    });
    if (nestedLabel) return nestedLabel.closest(SELECTORS.menuItem) || nestedLabel;

    return null;
  }

  /** Dispatches menu click sequence. */
  function dispatchMenuClickSequence(el) {
    if (!el) return;
    const events = ["pointerdown", "mousedown", "pointerup", "mouseup", "click"];
    for (const type of events) {
      const event =
        type.startsWith("pointer")
          ? new PointerEvent(type, { bubbles: true, cancelable: true, pointerType: "mouse" })
          : new MouseEvent(type, { bubbles: true, cancelable: true, view: window });
      el.dispatchEvent(event);
    }
  }

  /** Checks whether master checked. */
  function isMasterChecked(toolbar) {
    return findMasterCheckbox(toolbar)?.getAttribute("aria-checked") === "true";
  }

  /** Finds open select menu. */
  function findOpenSelectMenu() {
    return [...document.querySelectorAll(SELECTORS.menu)].find((el) => isVisible(el)) || null;
  }

  /** Clicks all menu item. */
  async function clickAllMenuItem(allItem) {
    const label = allItem.querySelector(SELECTORS.menuItemLabel);
    robustClick(allItem);
    dispatchMenuClickSequence(allItem);
    if (label) {
      robustClick(label);
      dispatchMenuClickSequence(label);
    }
    await waitFor(() => isMasterChecked(getSelectionToolbar()), { timeout: 220, interval: 40 });
  }

  /** Returns the toolbar used for selection (mailbox toolbar, list container, or document). */
  function getSelectionToolbar() {
    return getMailboxToolbar() || document.querySelector(SELECTORS.threadListContainer) || document;
  }

  /** Returns selection debug state. */
  function getSelectionDebugState(toolbar) {
    const master = findMasterCheckbox(toolbar);
    return {
      masterChecked: master?.getAttribute("aria-checked") || "missing",
      masterClass: master?.className || "missing",
      masterSelector: master?.getAttribute("selector") || ""
    };
  }

  /** Handles try click all menu option. */
  async function tryClickAllMenuOption(selectButton, attempts = 4) {
    for (let i = 0; i < attempts; i += 1) {
      robustClick(selectButton);
      await waitFor(() => findOpenSelectMenu() && findAllMenuItem(), { timeout: 260, interval: 40 });
      const menu = findOpenSelectMenu();
      if (!menu) continue;

      const allItem = findAllMenuItem();
      if (!allItem) continue;

      await clickAllMenuItem(allItem);
      return true;
    }
    return false;
  }

  /** Ensures master checked. */
  async function ensureMasterChecked(toolbar, attempts = 6) {
    for (let i = 0; i < attempts; i += 1) {
      const master = findMasterCheckbox(toolbar);
      if (master?.getAttribute("aria-checked") === "true") return true;
      const inner = master?.querySelector(SELECTORS.masterCheckboxInner);
      if (inner) {
        robustClick(inner);
        // Gmail settle time: the master click below follows unconditionally.
        await sleep(220);
      }
      if (master) {
        robustClick(master);
        await waitFor(() => isMasterChecked(toolbar), { timeout: 280, interval: 40 });
      }
    }
    return findMasterCheckbox(toolbar)?.getAttribute("aria-checked") === "true";
  }

  /** Handles select all matching search. */
  async function selectAllMatchingSearch(options = {}) {
    const { includeAllInSearch = true } = options;
    const toolbar = getSelectionToolbar();
    const selectButton = findSelectButton(toolbar);

    if (!selectButton) {
      throw new Error("Could not find the Select button in Gmail toolbar.");
    }

    const clickedAllMenuOption = await tryClickAllMenuOption(selectButton, 5);
    if (!clickedAllMenuOption) {
      // Fallback: direct master checkbox toggle.
      const master = findMasterCheckbox(toolbar);
      if (master) {
        robustClick(master);
        await waitFor(() => isMasterChecked(toolbar), { timeout: 280, interval: 40 });
      }
    }
    void getSelectionDebugState;

    const selected = await ensureMasterChecked(toolbar, 8);
    if (!selected) {
      const menu = findOpenSelectMenu();
      if (menu) {
        menu.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
        menu.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", bubbles: true, cancelable: true }));
        await waitFor(() => isMasterChecked(toolbar), { timeout: 250, interval: 40 });
      }

      // Final fallback: Gmail keyboard shortcut for "select all" (requires shortcuts enabled).
      triggerKeySequence(["*", "a"]);
      await waitFor(() => isMasterChecked(toolbar), { timeout: 350, interval: 40 });
    }

    const selectedAfterFallback = isMasterChecked(toolbar) || await ensureMasterChecked(toolbar, 5);
    if (!selectedAfterFallback) {
      throw new Error("Could not check the master checkbox. Archive was skipped.");
    }

    const selectAllSearchLink = includeAllInSearch
      ? [...document.querySelectorAll(SELECTORS.anchors)].find((a) =>
      GMAIL_TEXT.selectAllInSearch.some((pattern) => pattern.test(a.textContent || ""))
    )
      : null;

    if (selectAllSearchLink) {
      robustClick(selectAllSearchLink);
      // No reliable DOM signal for "all in search" selection; give Gmail settle time.
      await sleep(500);
      state.selectedConversationsText = "All conversations in search selected.";
      return true;
    }

    state.selectedConversationsText = "Selected current page conversations.";
    return false;
  }

  /** Checks whether has any selected conversation row. */
  function hasAnySelectedConversationRow() {
    const rows = getThreadRows();
    if (!rows.length) return false;

    return rows.some((row) => {
      if ((row.getAttribute("aria-selected") || "").toLowerCase() === "true") return true;
      const rowCheckbox = row.querySelector(SELECTORS.rowCheckbox);
      return (rowCheckbox?.getAttribute("aria-checked") || "").toLowerCase() === "true";
    });
  }

  /** Waits for selection to settle. */
  async function waitForSelectionToSettle(timeout = 5000) {
    const settled = await waitFor(
      () => isMasterChecked(getSelectionToolbar()) && hasAnySelectedConversationRow(),
      { timeout, interval: 150 }
    );
    if (!settled) return false;
    // Short settle so Gmail finishes applying the selection before archive.
    await sleep(180);
    return true;
  }

  /** Archives selected. */
  async function archiveSelected() {
    const toolbar = getMailboxToolbar() || document;
    const archiveControl = [...toolbar.querySelectorAll(SELECTORS.toolbarControls)].find(
      (el) => {
        if (!isVisible(el)) return false;
        if ((el.getAttribute("aria-disabled") || "").toLowerCase() === "true") return false;
        const label = (el.getAttribute("aria-label") || "").toLowerCase();
        const tooltip = (el.getAttribute("data-tooltip") || "").toLowerCase();
        const text = (el.textContent || "").trim().toLowerCase();
        const act = (el.getAttribute("act") || "").trim();
        return (
          label.includes(GMAIL_TEXT.archive) ||
          tooltip.includes(GMAIL_TEXT.archive) ||
          text === GMAIL_TEXT.archive ||
          act === SELECTORS.archiveAct
        );
      }
    );

    // When rows were visibly selected, finish as soon as Gmail clears them (archived);
    // otherwise there is no signal to watch, so keep the full wait.
    const hadSelection = hasAnySelectedConversationRow();
    if (archiveControl) {
      robustClick(archiveControl);
    } else {
      triggerKeySequence(["e"]);
    }
    if (hadSelection) {
      await waitFor(() => !hasAnySelectedConversationRow(), { timeout: 700, interval: 70 });
    } else {
      await sleep(700);
    }
  }

  /** Checks whether disabled control. */
  function isDisabledControl(el) {
    if (!el) return true;
    if ((el.getAttribute("aria-disabled") || "").toLowerCase() === "true") return true;
    if ((el.getAttribute("disabled") || "").toLowerCase() === "true") return true;
    if (el.hasAttribute("disabled")) return true;
    const tabIndex = el.getAttribute("tabindex");
    if (tabIndex === "-1") return true;
    return false;
  }

  /** Finds next page button. */
  function findNextPageButton() {
    const controls = [
      ...document.querySelectorAll(SELECTORS.buttons)
    ];

    const byText = controls.find((el) => {
      if (!isVisible(el)) return false;
      if (isDisabledControl(el)) return false;
      const aria = (el.getAttribute("aria-label") || "").toLowerCase();
      const tooltip = (el.getAttribute("data-tooltip") || "").toLowerCase();
      const title = (el.getAttribute("title") || "").toLowerCase();
      const signal = `${aria} ${tooltip} ${title}`;

      // Gmail usually labels this as "Older" (next page), but keep a next-page fallback.
      const looksLikeNext =
        GMAIL_TEXT.olderSignals.some((needle) => signal.includes(needle)) ||
        signal === GMAIL_TEXT.nextExact;
      if (!looksLikeNext) return false;

      // Avoid the tiny calendar/date picker arrows.
      if (el.closest(SELECTORS.dialog)) return false;
      return true;
    });
    if (byText) return byText;

    // Locale-independent fallbacks (non-English Gmail): Older button class, then the
    // last button of the pager group ("Newer", "Older").
    /** Checks whether usable pager control. */
    const usable = (el) => !!el && isVisible(el) && !isDisabledControl(el) && !el.closest(SELECTORS.dialog);
    const byClass = [...document.querySelectorAll(SELECTORS.olderButtonClass)].find(usable);
    if (byClass) return byClass;
    const pagerButtons = [...document.querySelectorAll(SELECTORS.pagerButtons)].filter((el) => isVisible(el));
    const lastPager = pagerButtons[pagerButtons.length - 1];
    return pagerButtons.length >= 2 && usable(lastPager) ? lastPager : null;
  }

  /** Returns first row fingerprint. */
  function getFirstRowFingerprint() {
    const row = getThreadRows()[0];
    if (!row) return "";
    const threadId =
      row.getAttribute("data-legacy-thread-id") ||
      firstAttr(row, SELECTORS.rowLegacyThreadId, "data-legacy-thread-id") ||
      "";
    const sender = firstAttr(row, SELECTORS.rowSenderSpan, "email");
    const subject = firstText(row, SELECTORS.rowSubject);
    return `${threadId}|${sender}|${subject}`;
  }

  /** Waits for page change. */
  async function waitForPageChange(previousFingerprint, timeout = 12000) {
    const changed = await waitFor(() => {
      const currentFingerprint = getFirstRowFingerprint();
      const rows = getThreadRows();
      if (rows.length === 0) return true;
      return !!(currentFingerprint && currentFingerprint !== previousFingerprint);
    }, { timeout, interval: 250, shouldAbort: shouldStopExecution });
    return !!changed;
  }

  /** Navigates next results page. */
  async function goToNextResultsPage() {
    if (shouldStopExecution()) return false;
    const nextButton = findNextPageButton();
    if (!nextButton) return false;
    const before = getFirstRowFingerprint();
    robustClick(nextButton);
    // Wait until the new page's rows render (a transient empty list is not enough).
    await waitFor(() => {
      const fingerprint = getFirstRowFingerprint();
      return !!(fingerprint && fingerprint !== before);
    }, { timeout: 500, interval: 50, shouldAbort: shouldStopExecution });
    if (shouldStopExecution()) return false;
    const moved = await waitForPageChange(before, 12000);
    if (moved) {
      await waitForSelector(SELECTORS.listViewReady, 12000);
      await sleep(350);
    }
    return moved;
  }

  /** Returns row sender email. */
  function getRowSenderEmail(row) {
    return normalizeEmail(
      firstAttr(row, SELECTORS.rowSenderEmailAttr, "email") ||
      firstText(row, SELECTORS.rowSenderText) ||
      ""
    );
  }

  /** Returns thread url from row. */
  function getThreadUrlFromRow(row) {
    const threadId = (
      row.getAttribute("data-legacy-thread-id") ||
      firstAttr(row, SELECTORS.rowLegacyThreadId, "data-legacy-thread-id") ||
      ""
    )
      .trim()
      .toLowerCase();
    const currentHash = String(location.hash || "").toLowerCase();
    const contextPrefix = currentHash.startsWith("#label/")
      ? currentHash.split("/").slice(0, 2).join("/")
      : currentHash.startsWith("#category/")
        ? currentHash.split("/").slice(0, 2).join("/")
        : currentHash.startsWith("#all")
          ? "#all"
          : "#inbox";

    /** Handles looks like thread hash. */
    const looksLikeThreadHash = (hash) =>
      /^#(?:inbox|all|label\/[^/]+|category\/[^/]+)\/[^/?#]+/i.test(hash || "");

    const anchors = [...row.querySelectorAll(SELECTORS.anchorsWithHref)];
    for (const anchor of anchors) {
      const href = anchor.getAttribute("href") || "";
      if (!href.includes("#")) continue;
      let resolved = "";
      let resolvedHash = "";
      try {
        const url = new URL(href, location.href);
        resolved = url.toString();
        resolvedHash = url.hash || "";
      } catch (_) {
        continue;
      }

      // Only accept real thread hashes, not list/navigation hashes.
      if (!looksLikeThreadHash(resolvedHash)) continue;

      // Prefer links that explicitly include row thread id when available.
      if (threadId && !resolvedHash.toLowerCase().includes(threadId)) {
        continue;
      }

      return resolved;
    }

    // Fallback: build a thread URL from row thread id and current mailbox context.
    if (threadId) {
      return `${location.origin}${location.pathname}${contextPrefix}/${threadId}`;
    }

    return "";
  }

  /** Normalizes fingerprint text. */
  function normalizeFingerprintText(value) {
    return (value || "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  /** Normalizes subject for match. */
  function normalizeSubjectForMatch(value) {
    return normalizeFingerprintText(value)
      // Remove zero-width / variation selector noise.
      .replace(/[\u200B-\u200D\uFE0E\uFE0F]/g, " ")
      // Remove most emoji blocks.
      .replace(/[\u{1F300}-\u{1FAFF}]/gu, " ")
      // Keep letters/numbers from any language; drop symbols/punctuation.
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  /** Returns normalized words. */
  function getNormalizedWords(value) {
    return normalizeSubjectForMatch(value)
      .split(" ")
      .map((token) => token.trim())
      .filter((token) => token.length >= 3);
  }

  /** Returns word overlap score. */
  function getWordOverlapScore(aWords, bWords) {
    if (!aWords.length || !bWords.length) return 0;
    const aSet = new Set(aWords);
    const bSet = new Set(bWords);
    let overlap = 0;
    for (const token of aSet) {
      if (bSet.has(token)) overlap += 1;
    }
    return overlap / Math.max(1, Math.min(aSet.size, bSet.size));
  }

  /** Parses date signature. */
  function parseDateSignature(value) {
    const raw = normalizeFingerprintText(value);
    if (!raw) return { canonical: "", dayMonth: "" };

    const monthMap = {
      jan: "01",
      feb: "02",
      mar: "03",
      apr: "04",
      may: "05",
      jun: "06",
      jul: "07",
      aug: "08",
      sep: "09",
      oct: "10",
      nov: "11",
      dec: "12"
    };

    /** Normalizes month. */
    const normalizeMonth = (monthText) => monthMap[(monthText || "").slice(0, 3).toLowerCase()] || "";
    const currentYear = String(new Date().getFullYear());

    const dayMonthYear =
      raw.match(/\b(?:mon|tue|wed|thu|fri|sat|sun),?\s+(\d{1,2})\s+([a-z]{3,9})\.?,?\s*(\d{4})?/i) ||
      raw.match(/\b(\d{1,2})\s+([a-z]{3,9})\.?,?\s*(\d{4})?/i);

    if (dayMonthYear) {
      const day = String(dayMonthYear[1]).padStart(2, "0");
      const month = normalizeMonth(dayMonthYear[2]);
      const year = dayMonthYear[3] || currentYear;
      if (month) {
        return {
          canonical: `${year}-${month}-${day}`,
          dayMonth: `${month}-${day}`
        };
      }
    }

    const monthDayYear =
      raw.match(/\b([a-z]{3,9})\s+(\d{1,2}),?\s*(\d{4})?/i);
    if (monthDayYear) {
      const month = normalizeMonth(monthDayYear[1]);
      const day = String(monthDayYear[2]).padStart(2, "0");
      const year = monthDayYear[3] || currentYear;
      if (month) {
        return {
          canonical: `${year}-${month}-${day}`,
          dayMonth: `${month}-${day}`
        };
      }
    }

    return { canonical: "", dayMonth: "" };
  }

  /** Checks whether hash string. */
  function hashString(value) {
    let hash = 2166136261;
    for (let i = 0; i < value.length; i += 1) {
      hash ^= value.charCodeAt(i);
      hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  /** Handles build message signature. */
  function buildMessageSignature({ sender, heading, subject, dateText }) {
    const normalizedSubject = normalizeSubjectForMatch(subject || "");
    const normalizedHeading = normalizeFingerprintText(heading || "");
    const dateSignature = parseDateSignature(dateText || "");
    const subjectCore = normalizedSubject.slice(0, 28);
    const rawSignature = [
      normalizeEmail(sender || ""),
      subjectCore,
      dateSignature.dayMonth
    ].join("|");

    return {
      sender: normalizeEmail(sender || ""),
      heading: normalizedHeading,
      subject: normalizedSubject,
      subjectWords: getNormalizedWords(normalizedSubject),
      subjectCore,
      dateCanonical: dateSignature.canonical,
      dateDayMonth: dateSignature.dayMonth,
      fingerprint: hashString(rawSignature)
    };
  }

  /** Returns open thread legacy id. */
  function getOpenThreadLegacyId() {
    return normalizeFingerprintText(
      firstAttr(document, SELECTORS.openThreadLegacyId, "data-legacy-thread-id") || ""
    );
  }

  /** Returns thread token from hash. */
  function getThreadTokenFromHash(hashValue) {
    const hash = String(hashValue || "").trim();
    const match = hash.match(/^#(?:inbox|all|label\/[^/]+|category\/[^/]+)\/([^/?#]+)/i);
    return normalizeFingerprintText(match?.[1] || "");
  }

  /** Returns list context hash from hash value. */
  function getListContextHashFromHash(hashValue) {
    const hash = String(hashValue || "").trim().toLowerCase();
    if (!hash) return "#inbox";
    if (hash.startsWith("#inbox")) return "#inbox";
    if (hash.startsWith("#all")) return "#all";
    const labelMatch = hash.match(/^#label\/[^/?#]+/i);
    if (labelMatch) return labelMatch[0];
    const categoryMatch = hash.match(/^#category\/[^/?#]+/i);
    if (categoryMatch) return categoryMatch[0];
    const searchMatch = hash.match(/^#search\/[^/?#]+/i);
    if (searchMatch) return searchMatch[0];
    return "#inbox";
  }

  /** Returns open thread url token. */
  function getOpenThreadUrlToken() {
    return getThreadTokenFromHash(location.hash || "");
  }

  /** Returns current list context hash. */
  function getCurrentListContextHash() {
    return getListContextHashFromHash(location.hash || "");
  }

  /** Returns row thread url token. */
  function getRowThreadUrlToken(row) {
    const url = getThreadUrlFromRow(row);
    if (!url) return "";
    try {
      const parsed = new URL(url, location.href);
      return getThreadTokenFromHash(parsed.hash || "");
    } catch (_) {
      return getThreadTokenFromHash(url);
    }
  }

  /** Returns row thread legacy id. */
  function getRowThreadLegacyId(row) {
    return normalizeFingerprintText(
      row.getAttribute("data-legacy-thread-id") ||
      firstAttr(row, SELECTORS.rowLegacyThreadId, "data-legacy-thread-id") ||
      ""
    );
  }

  /** Returns open email subject. */
  function getOpenEmailSubject() {
    const threadRoot = getOpenThreadRoot();
    if (!threadRoot) return "";
    return firstText(threadRoot, SELECTORS.openThreadSubject) || "";
  }

  /** Returns open email heading. */
  function getOpenEmailHeading() {
    const threadRoot = getOpenThreadRoot();
    if (!threadRoot) return "";
    return (
      firstAttr(threadRoot, SELECTORS.openSenderName, "name") ||
      firstText(threadRoot, SELECTORS.openSenderNameText) ||
      ""
    );
  }

  /** Returns open email date text. */
  function getOpenEmailDateText() {
    const threadRoot = getOpenThreadRoot();
    if (!threadRoot) return "";
    const candidates = [
      ...threadRoot.querySelectorAll(SELECTORS.openDateCandidates)
    ]
      .filter((el) => isVisible(el) && !el.closest(SELECTORS.anyRow))
      .map((el) => (el.getAttribute("datetime") || el.getAttribute("title") || el.textContent || "").trim())
      .filter(Boolean)
      .sort((a, b) => b.length - a.length);
    return candidates[0] || "";
  }

  /** Returns open email fingerprint. */
  function getOpenEmailFingerprint() {
    const signature = buildMessageSignature({
      sender: findOpenEmailSender(),
      subject: getOpenEmailSubject(),
      heading: getOpenEmailHeading(),
      dateText: getOpenEmailDateText()
    });
    signature.threadId = getOpenThreadLegacyId();
    signature.threadToken = getOpenThreadUrlToken();
    console.log("[GmailCleaner] Email signature", signature);
    return signature;
  }

  /** Returns row heading text. */
  function getRowHeadingText(row) {
    return (
      firstAttr(row, SELECTORS.rowSenderNameAttr, "name") ||
      firstText(row, SELECTORS.rowSenderNameText) ||
      ""
    );
  }

  /** Returns row subject text. */
  function getRowSubjectText(row) {
    const subject = firstText(row, SELECTORS.rowSubjectText);
    const preview = firstText(row, SELECTORS.rowPreview);
    return `${subject} ${preview}`.trim();
  }

  /** Returns row date text. */
  function getRowDateText(row) {
    return (
      firstAttr(row, SELECTORS.rowDateTitled, "title") ||
      firstAttr(row, SELECTORS.rowDateLabeled, "aria-label") ||
      firstText(row, SELECTORS.rowDateShortText) ||
      ""
    );
  }

  /** Returns row fingerprint. */
  function getRowFingerprint(row) {
    return buildMessageSignature({
      sender: getRowSenderEmail(row),
      subject: getRowSubjectText(row),
      heading: getRowHeadingText(row),
      dateText: getRowDateText(row)
    });
  }

  /** Handles score row against email signature. */
  function scoreRowAgainstEmailSignature(rowSignature, emailSignature) {
    if (!rowSignature.sender || !emailSignature.sender) {
      return { total: 0, sender: 0, subject: 0, heading: 0, date: 0, fingerprint: 0 };
    }
    if (rowSignature.sender !== emailSignature.sender) {
      return { total: 0, sender: 0, subject: 0, heading: 0, date: 0, fingerprint: 0 };
    }

    let subjectScore = 0;
    if (emailSignature.subject && rowSignature.subject) {
      const directContains =
        rowSignature.subject.includes(emailSignature.subject) ||
        emailSignature.subject.includes(rowSignature.subject);
      const coreContains =
        rowSignature.subject.includes(emailSignature.subjectCore) ||
        emailSignature.subject.includes(rowSignature.subjectCore);
      const overlapScore = getWordOverlapScore(emailSignature.subjectWords, rowSignature.subjectWords);

      if (directContains) {
        subjectScore = 4;
      } else if (coreContains || overlapScore >= 0.7) {
        subjectScore = 3;
      } else if (overlapScore >= 0.45) {
        subjectScore = 2;
      }
    }

    const headingMatches = !!(
      emailSignature.heading &&
      rowSignature.heading &&
      (
        rowSignature.heading.includes(emailSignature.heading) ||
        emailSignature.heading.includes(rowSignature.heading)
      )
    );
    const headingScore = headingMatches ? 1 : 0;

    let dateScore = 0;
    if (
      emailSignature.dateCanonical &&
      rowSignature.dateCanonical &&
      emailSignature.dateCanonical === rowSignature.dateCanonical
    ) {
      dateScore = 2;
    } else if (
      emailSignature.dateDayMonth &&
      rowSignature.dateDayMonth &&
      emailSignature.dateDayMonth === rowSignature.dateDayMonth
    ) {
      dateScore = 1;
    }

    const fingerprintScore =
      emailSignature.fingerprint &&
      rowSignature.fingerprint &&
      emailSignature.fingerprint === rowSignature.fingerprint
        ? 2
        : 0;
    const senderScore = 5;
    const total = senderScore + subjectScore + headingScore + dateScore + fingerprintScore;

    return {
      total,
      sender: senderScore,
      subject: subjectScore,
      heading: headingScore,
      date: dateScore,
      fingerprint: fingerprintScore
    };
  }

  /** Finds current row index. */
  function findCurrentRowIndex(rows, emailSignature, options = {}) {
    const { onStatus = null, pageNumber = null } = options;
    /** Handles report. */
    const report = (message) => {
      if (typeof onStatus !== "function") return;
      const prefix = pageNumber ? `Page ${pageNumber}: ` : "";
      onStatus(`${prefix}${message}`);
    };

    if (emailSignature?.threadToken) {
      report("Approach 1/4 (thread token): trying...");
      for (let i = 0; i < rows.length; i += 1) {
        if (getRowThreadUrlToken(rows[i]) === emailSignature.threadToken) {
          report(`Approach 1/4 (thread token): matched row ${i + 1}.`);
          return { index: i, approach: "thread-token" };
        }
      }
      report("Approach 1/4 (thread token): no match.");
    } else {
      report("Approach 1/4 (thread token): skipped (missing open-thread token).");
    }
    if (emailSignature?.threadId) {
      report("Approach 2/4 (legacy thread id): trying...");
      for (let i = 0; i < rows.length; i += 1) {
        if (getRowThreadLegacyId(rows[i]) === emailSignature.threadId) {
          report(`Approach 2/4 (legacy thread id): matched row ${i + 1}.`);
          return { index: i, approach: "thread-id" };
        }
      }
      report("Approach 2/4 (legacy thread id): no match.");
    } else {
      report("Approach 2/4 (legacy thread id): skipped (missing open-thread id).");
    }

    let bestIndex = -1;
    let bestScore = 0;
    let bestDetail = null;
    let bestScoreCount = 0;

    report("Approach 3/4 (strict signature): trying...");
    for (let i = 0; i < rows.length; i += 1) {
      const rowSignature = getRowFingerprint(rows[i]);
      const score = scoreRowAgainstEmailSignature(rowSignature, emailSignature);
      if (score.total > bestScore) {
        bestScore = score.total;
        bestIndex = i;
        bestDetail = score;
        bestScoreCount = 1;
      } else if (score.total > 0 && score.total === bestScore) {
        bestScoreCount += 1;
      }
    }

    if (bestIndex >= 0 && bestScore >= 8) {
      report(`Approach 3/4 (strict signature): matched row ${bestIndex + 1} (score ${bestScore}).`);
      return { index: bestIndex, approach: "strict-signature", score: bestScore };
    }
    report(`Approach 3/4 (strict signature): no match (best score ${bestScore}).`);

    // Fallback for sparse inbox rows where Gmail omits subject/heading/thread-id:
    // accept sender+exact-date (score 7) only when it is the unique strongest candidate.
    report("Approach 4/4 (sparse signature fallback): trying...");
    if (
      bestIndex >= 0 &&
      bestScore === 7 &&
      bestScoreCount === 1 &&
      bestDetail?.sender === 5 &&
      bestDetail?.date >= 2
    ) {
      console.log("[GmailCleaner] Using sparse-row fallback signature match", bestDetail);
      report(`Approach 4/4 (sparse signature fallback): matched row ${bestIndex + 1}.`);
      return { index: bestIndex, approach: "sparse-signature-fallback", score: bestScore };
    }
    report("Approach 4/4 (sparse signature fallback): no match.");
    return { index: -1, approach: "none" };
  }

  /** Navigates to inbox for discovery. */
  async function navigateToInboxForDiscovery() {
    if (shouldStopExecution()) return;
    const hash = String(location.hash || "").toLowerCase();
    const isInboxListView = hash === "#inbox" || hash.startsWith("#inbox?");
    if (!isInboxListView) {
      window.location.hash = "#inbox";
      await waitForThreadRows(12000);
      await sleep(250);
      return;
    }
    await waitForThreadRows(5000);
  }

  /** Normalizes comparable url. */
  function normalizeComparableUrl(url) {
    try {
      return new URL(String(url || ""), location.href).toString();
    } catch (_) {
      return String(url || "");
    }
  }

  /** Navigates within gmail. */
  function navigateWithinGmail(url) {
    const target = String(url || "").trim();
    if (!target) return;
    try {
      const parsed = new URL(target, location.href);
      const sameOrigin = parsed.origin === location.origin;
      const samePath = parsed.pathname === location.pathname;
      if (sameOrigin && samePath && parsed.hash) {
        window.location.hash = parsed.hash;
        return;
      }
      window.location.href = parsed.toString();
    } catch (_) {
      if (target.startsWith("#")) {
        window.location.hash = target;
      } else {
        window.location.href = target;
      }
    }
  }

  const SIGNATURE_MATCH_LOG_STYLE = "color: #0a8a3a; font-weight: 700;";

  /** Handles can use locked search for discovery. */
  function canUseLockedSearchForDiscovery(expectedSender) {
    const lockedQuery = normalizeQuery(state.lockedQuery || state.query || "");
    if (!lockedQuery) return false;
    if (!expectedSender) return true;
    const lockedSender = normalizeEmail(state.lockedSender || extractSenderFromQuery(lockedQuery));
    if (!lockedSender) return false;
    return senderSignalMatchesExpected(lockedSender, expectedSender);
  }

  /** Navigates to discovery list context. */
  async function navigateToDiscoveryListContext(expectedSender) {
    if (canUseLockedSearchForDiscovery(expectedSender)) {
      const lockedQuery = normalizeQuery(state.lockedQuery || state.query || "");
      await ensureSearchContext(lockedQuery);
      await waitForThreadRows(5000);
      return;
    }
    await navigateToInboxForDiscovery();
  }

  /** Finds next different sender thread url. */
  async function findNextDifferentSenderThreadUrl(sender, options = {}) {
    const configuredMaxPages = normalizeScanPageLimit(state.maxScanPages);
    const { maxPages = configuredMaxPages, onProgress = null } = options;
    /** Handles report. */
    const report = (message) => {
      if (typeof onProgress === "function") onProgress(message);
    };
    const safeMaxPages = normalizeScanPageLimit(maxPages);
    const expectedSender = normalizeEmail(sender);
    let signatureMatched = false;

    const fp = getOpenEmailFingerprint();
    const fingerprintSender = normalizeEmail(fp?.sender || "");
    const matchedSender = normalizeEmail(fingerprintSender || expectedSender || "");
    console.log("[GmailCleaner] Step 3 fingerprint object sender", {
      senderFromFingerprintObject: fingerprintSender
    });
    console.log("[GmailCleaner] Step 4 sender-only vs Step 3 object sender", {
      senderOnly: expectedSender,
      senderFromFingerprintObject: fingerprintSender,
      same: !!(expectedSender && fingerprintSender && expectedSender === fingerprintSender),
      different: !!(expectedSender && fingerprintSender && expectedSender !== fingerprintSender)
    });
    if (expectedSender && fingerprintSender && expectedSender !== fingerprintSender) {
      console.warn("[GmailCleaner] Sender mismatch: using open-email fingerprint sender for matching", {
        expectedSender,
        fingerprintSender
      });
      report("Sender mismatch detected; using open-email sender fingerprint for matching.");
    }

    /** Finds different sender target in rows. */
    const findDifferentSenderTargetInRows = (rows, startIndex = 0) => {
      for (let i = Math.max(0, startIndex); i < rows.length; i += 1) {
        const row = rows[i];
        const rowSender = getRowSenderEmail(row);
        if (matchedSender) {
          if (!rowSender) continue;
          if (rowSender === matchedSender) continue;
        }
        const url = getThreadUrlFromRow(row);
        if (!url) continue;
        return {
          url,
          sender: rowSender,
          subject: getRowSubjectText(row),
          date: getRowDateText(row),
          threadId: getRowThreadLegacyId(row),
          threadToken: getRowThreadUrlToken(row),
          listHash: getCurrentListContextHash()
        };
      }
      return null;
    };

    await navigateToDiscoveryListContext(expectedSender);

    for (let page = 0; page < safeMaxPages; page += 1) {
      if (shouldStopExecution()) return null;
      report(`Scanning inbox page ${page + 1}/${safeMaxPages}...`);

      const rows = getThreadRows();
      for (let i = 0; i < rows.length; i += 1) {
        if (shouldStopExecution()) return null;
        const scannedSignature = getRowFingerprint(rows[i]);
        console.log("[GmailCleaner] Scanned inbox row signature", {
          page: page + 1,
          row: i + 1,
          signature: scannedSignature
        });
        console.log("--------------------------------------------------");
      }
      let searchStartIndex = 0;
      if (!signatureMatched) {
        const currentMatch = findCurrentRowIndex(rows, fp, {
          onStatus: report,
          pageNumber: page + 1
        });
        const currentIndex = currentMatch.index;
        if (currentIndex >= 0) {
          signatureMatched = true;
          searchStartIndex = currentIndex + 1;
          console.log("%c[GmailCleaner] Email signature matched", SIGNATURE_MATCH_LOG_STYLE);
          report(
            `Page ${page + 1}: anchored current email with ${currentMatch.approach}; searching from row ${searchStartIndex}.`
          );
        } else if (matchedSender) {
          report(`Page ${page + 1}: Approach 5/5 (sender-only fallback): trying...`);
          let senderOnlyIndex = -1;
          let senderOnlyBestScore = -1;
          let senderOnlyBestScoreCount = 0;
          for (let i = 0; i < rows.length; i += 1) {
            const rowSignature = getRowFingerprint(rows[i]);
            if (rowSignature.sender !== matchedSender) continue;
            const score = scoreRowAgainstEmailSignature(rowSignature, fp).total;
            if (score > senderOnlyBestScore) {
              senderOnlyBestScore = score;
              senderOnlyIndex = i;
              senderOnlyBestScoreCount = 1;
            } else if (score > 0 && score === senderOnlyBestScore) {
              senderOnlyBestScoreCount += 1;
            }
          }
          if (senderOnlyIndex >= 0 && senderOnlyBestScore >= 7 && senderOnlyBestScoreCount === 1) {
            signatureMatched = true;
            searchStartIndex = senderOnlyIndex + 1;
            console.log("%c[GmailCleaner] Email sender fallback matched", SIGNATURE_MATCH_LOG_STYLE, {
              sender: matchedSender,
              row: senderOnlyIndex + 1,
              page: page + 1,
              score: senderOnlyBestScore
            });
            report(
              `Page ${page + 1}: Approach 5/5 (sender-only fallback): matched row ${senderOnlyIndex + 1} (score ${senderOnlyBestScore}).`
            );
          } else {
            report("Page " + (page + 1) + ": Approach 5/5 (sender-only fallback): no match.");
          }
        } else {
          report(`Page ${page + 1}: Approach 5/5 (sender-only fallback): skipped (no sender).`);
        }
      }

      if (signatureMatched) {
        const target = findDifferentSenderTargetInRows(rows, searchStartIndex);
        if (target) {
          target.pageOffset = page;
          return target;
        }
      }

      if (shouldStopExecution()) return null;
      const moved = await goToNextResultsPage();
      if (!moved) break;
    }

    if (!signatureMatched) {
      console.log("[GmailCleaner] Email signature did not match");
      report("No signature match found after trying all approaches (including fallbacks).");
    }
    void expectedSender;
    return null;
  }

  /** Handles cache next email target for sender. */
  async function cacheNextEmailTargetForSender(sender, options = {}) {
    const { returnToUrl = "", forceRefresh = false } = options;
    const expectedSender = normalizeEmail(sender);
    if (!expectedSender) {
      throw new Error("Open an email first so I can identify its sender before caching next target.");
    }
    const currentSourceUrl = normalizeComparableUrl(returnToUrl || location.href);
    const cachedSourceUrl = normalizeComparableUrl(state.nextTarget.sourceUrl || "");
    const cachedSender = normalizeEmail(state.nextTarget.sender || "");
    if (cachedSourceUrl && currentSourceUrl && cachedSourceUrl !== currentSourceUrl) {
      clearCachedNextEmailTarget();
    }
    const cachedMatchesSource = !!(
      state.nextTarget.url &&
      cachedSourceUrl &&
      cachedSourceUrl === currentSourceUrl
    );
    const cachedMatchesSender = !expectedSender || (cachedSender && cachedSender === expectedSender);
    if (!forceRefresh && cachedMatchesSource && cachedMatchesSender) {
      announceEmailTargetStatus("Email target already cached (persisted)");
      return true;
    }
    if (cachedMatchesSource && expectedSender && cachedSender && cachedSender !== expectedSender) {
      clearCachedNextEmailTarget();
    }
    if (
      expectedSender &&
      state.nextTarget.url &&
      state.nextTarget.sender &&
      normalizeEmail(state.nextTarget.sender) === expectedSender
    ) {
      return true;
    }

    const priorUrl = String(returnToUrl || "");
    try {
      setLog("Go to Next Email selected: finding the immediate next email...");
      const target = await findNextDifferentSenderThreadUrl(expectedSender, {
        onProgress: (message) => setLog(message)
      });
      if (!target?.url) {
        clearCachedNextEmailTarget();
        announceEmailTargetStatus("Email target after inbox scan");
        return false;
      }
      state.nextTarget = {
        url: target.url,
        sender: normalizeEmail(target.sender || expectedSender || sender || ""),
        subject: (target.subject || "").trim(),
        date: (target.date || "").trim(),
        threadId: normalizeFingerprintText(target.threadId || ""),
        threadToken: normalizeFingerprintText(target.threadToken || ""),
        pageOffset: Math.max(0, Number.parseInt(String(target.pageOffset ?? ""), 10) || 0),
        listHash: getListContextHashFromHash(target.listHash || ""),
        sourceUrl: currentSourceUrl
      };
      persistCachedNextEmailTarget();
      const preview = [
        state.nextTarget.sender || "unknown sender",
        state.nextTarget.subject || "(no subject)",
        state.nextTarget.date || ""
      ]
        .filter(Boolean)
        .join(" | ");
      setLog(`Next email target cached: ${preview}`);
      announceEmailTargetStatus("Email target after inbox scan");
      showToast(STRINGS.toast.nextTargetCached);
      return true;
    } finally {
      if (priorUrl && normalizeComparableUrl(location.href) !== normalizeComparableUrl(priorUrl)) {
        setLog("Returning to current open email...");
        navigateWithinGmail(priorUrl);
        await waitForSelector(SELECTORS.openThreadHeadingInMain, 12000);
        await sleep(180);
        setLog("Returned to current email. Continuing flow...");
      }
    }
  }

  /** Archives current page. */
  async function archiveCurrentPage(pageNumber) {
    const rows = getThreadRows();
    if (!rows.length) return false;

    setLog(`Page ${pageNumber}: selecting conversations...`);
    await selectAllMatchingSearch({ includeAllInSearch: false });
    setLog(`Page ${pageNumber}: ${state.selectedConversationsText} Archiving...`);
    await archiveSelected();
    await sleep(800);
    return true;
  }

  /** Archives current page with retry. */
  async function archiveCurrentPageWithRetry(pageNumber, attempts = 2) {
    let lastError = null;
    for (let i = 0; i < attempts; i += 1) {
      try {
        const archived = await archiveCurrentPage(pageNumber);
        if (!archived) return false;
        return true;
      } catch (error) {
        lastError = error;
        await sleep(600);
      }
    }
    throw lastError || new Error(`Failed to archive page ${pageNumber}.`);
  }

  /** Returns unsubscribe signal. */
  function getUnsubscribeSignal(el) {
    const text = (el.textContent || "").trim();
    const innerText = (el.innerText || "").trim();
    const ariaLabel = (el.getAttribute("aria-label") || "").trim();
    const tooltip = (el.getAttribute("data-tooltip") || "").trim();
    const title = (el.getAttribute("title") || "").trim();
    const signal = [text, innerText, ariaLabel, tooltip, title].join(" ").toLowerCase();
    return signal;
  }

  /** Finds already unsubscribed notice. */
  function findAlreadyUnsubscribedNotice(sender) {
    const normalizedSender = normalizeEmail(sender);
    if (!normalizedSender) return null;

    const quotedSender = `"${normalizedSender}"`;
    const main = document.querySelector(SELECTORS.main) || document;
    const nodes = [...main.querySelectorAll(SELECTORS.noticeNodes)].filter((el) => isVisible(el));
    const keywords = GMAIL_TEXT.alreadyUnsubscribedKeywords;

    return nodes.find((el) => {
      const rawText = (el.textContent || "").trim().toLowerCase();
      const text = normalizeQuery(rawText);
      if (!text) return false;
      if (rawText === quotedSender) return true;
      const hasSender = text.includes(normalizedSender) || text.includes(quotedSender);
      if (!hasSender) return false;
      return keywords.some((keyword) => text.includes(keyword));
    }) || null;
  }

  /** Finds best unsubscribe target. */
  function findBestUnsubscribeTarget() {
    const main = document.querySelector(SELECTORS.main) || document;
    const candidates = [
      ...main.querySelectorAll(SELECTORS.unsubscribeCandidates)
    ];

    // Prefer header-level actionable controls inside the open message area.
    const scored = candidates
      .map((el) => {
        const signal = getUnsubscribeSignal(el);
        if (!signal.includes(GMAIL_TEXT.unsubscribe)) return null;
        if (el.closest(SELECTORS.blockquote)) return null;
        if (el.closest(SELECTORS.anchorsWithHref) && !el.matches(SELECTORS.unsubscribeActionable)) return null;

        let score = 0;
        if (el.matches(SELECTORS.unsubscribeButtonLike)) score += 8;
        if (el.matches(SELECTORS.roleLink)) score += 9;
        if (el.classList.contains(SELECTORS.unsubscribeLinkClass)) score += 10;
        if ((el.getAttribute("aria-label") || "").toLowerCase().includes(GMAIL_TEXT.unsubscribe)) score += 6;
        if ((el.getAttribute("data-tooltip") || "").toLowerCase().includes(GMAIL_TEXT.unsubscribe)) score += 5;
        if ((el.textContent || "").trim().toLowerCase().includes(GMAIL_TEXT.unsubscribe)) score += 3;
        if (el.closest(SELECTORS.main)) score += 1;
        return { el, score };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score);

    if (scored[0]?.el) return scored[0].el;

    // Locale-independent fallback (non-English Gmail): Gmail's header unsubscribe link class.
    return [...main.getElementsByClassName(SELECTORS.unsubscribeLinkClass)].find(
      (el) => isVisible(el) && !el.closest(SELECTORS.blockquote)
    ) || null;
  }

  /** Finds unsubscribe confirm button. */
  function findUnsubscribeConfirmButton() {
    const dialogs = [
      ...document.querySelectorAll(SELECTORS.dialogs)
    ];

    for (const dialog of dialogs) {
      const explicitOk = dialog.querySelector(SELECTORS.dialogOkButton);
      if (explicitOk) return explicitOk;

      const buttons = [...dialog.querySelectorAll(SELECTORS.dialogButtons)];
      const match = buttons.find((btn) => {
        const signal = getUnsubscribeSignal(btn);
        if (signal.includes(GMAIL_TEXT.cancel)) return false;
        return GMAIL_TEXT.confirmSignals.some((needle) => signal.includes(needle));
      });
      if (match) return match;
    }

    return null;
  }

  /** Finds unsubscribe followup dismiss button. */
  function findUnsubscribeFollowupDismissButton() {
    const dialogs = [
      ...document.querySelectorAll(SELECTORS.dialogs)
    ].filter((dialog) => isVisible(dialog));

    for (const dialog of dialogs) {
      const buttons = [...dialog.querySelectorAll(SELECTORS.dialogButtons)];
      const match = buttons.find((btn) => {
        if (!isVisible(btn)) return false;
        const signal = getUnsubscribeSignal(btn);
        if (!signal || signal.includes(GMAIL_TEXT.unsubscribe)) return false;
        return GMAIL_TEXT.dismissSignals.some((needle) => signal.includes(needle));
      });
      if (match) return match;

      // Locale-independent fallback: Material dialog cancel/close action.
      const mdcDismiss = [...dialog.querySelectorAll(SELECTORS.dialogDismissButton)].find((btn) => isVisible(btn));
      if (mdcDismiss) return mdcDismiss;
    }

    return null;
  }

  /** Dismisses unsubscribe dialogs. */
  async function dismissUnsubscribeDialogs(maxRounds = 3) {
    for (let i = 0; i < maxRounds; i += 1) {
      const confirm = findUnsubscribeConfirmButton();
      if (confirm) {
        robustClick(confirm);
        await waitFor(() => !confirm.isConnected || !isVisible(confirm), { timeout: 120, interval: 30 });
        continue;
      }

      const dismiss = findUnsubscribeFollowupDismissButton();
      if (dismiss) {
        robustClick(dismiss);
        await waitFor(() => !dismiss.isConnected || !isVisible(dismiss), { timeout: 120, interval: 30 });
        continue;
      }

      break;
    }
  }

  /** Waits for unsubscribe confirm. */
  async function waitForUnsubscribeConfirm(timeout = 5000) {
    return waitFor(() => findUnsubscribeConfirmButton(), { timeout, interval: 150 });
  }

  /** Checks whether has visible unsubscribe dialog. */
  function hasVisibleUnsubscribeDialog() {
    return Boolean(findUnsubscribeConfirmButton() || findUnsubscribeFollowupDismissButton());
  }

  /** Waits for unsubscribe dialog to clear. */
  async function waitForUnsubscribeDialogToClear(timeout = 1800) {
    return !!(await waitFor(() => !hasVisibleUnsubscribeDialog(), { timeout, interval: 100 }));
  }

  /** Handles robust click. */
  function robustClick(el) {
    if (!el) return;
    try {
      el.scrollIntoView({ block: "center", inline: "center" });
    } catch (_) {}

    try {
      el.focus?.();
    } catch (_) {}

    try {
      el.click();
    } catch (_) {}

    const mouseDown = new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window });
    const mouseUp = new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window });
    const click = new MouseEvent("click", { bubbles: true, cancelable: true, view: window });

    el.dispatchEvent(mouseDown);
    el.dispatchEvent(mouseUp);
    el.dispatchEvent(click);

    // Fallback for role=link elements that react to keyboard activation.
    if (el.matches(SELECTORS.roleLinkOrButton)) {
      el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
      el.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", bubbles: true, cancelable: true }));
    }
  }

  /** Checks whether visible. */
  function isVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  }

  /** Returns mailbox toolbar. */
  function getMailboxToolbar() {
    return queryFirst(document, SELECTORS.mailboxToolbar);
  }

  /** Clicks unsubscribe in open email. */
  async function clickUnsubscribeInOpenEmail() {
    const btn = findBestUnsubscribeTarget();

    if (!btn) {
      throw new Error("No unsubscribe button/link found in the currently open email.");
    }

    robustClick(btn);
    const confirm = await waitForUnsubscribeConfirm(1800);
    if (confirm) {
      robustClick(confirm);
      await waitForUnsubscribeDialogToClear(1800);
      return "Clicked unsubscribe and confirmed popup.";
    }

    await dismissUnsubscribeDialogs(1);
    return "Clicked unsubscribe. Confirm popup was not detected.";
  }

  /** Handles action select like open. */
  async function actionSelectLikeOpen(options = {}) {
    const manageWorking = !options.skipWorking;
    if (manageWorking) setWorking(true);
    try {
      setLog("Finding sender from open email...");
      const sender = findOpenEmailSender();
      if (!sender) {
        throw new Error("Open an email first so I can detect its sender.");
      }

      // No inbox hop first: runSearchQuery navigates to #search from thread view
      // anyway, so loading the inbox list only to discard it was pure latency.
      setLog(`Searching ${sender}...`);
      const query = await searchBySender(sender);
      state.lockedSender = normalizeEmail(sender);
      state.lockedQuery = normalizeQuery(query);
      setLog("Search ready.");
      showToast(STRINGS.toast.searchComplete);
    } catch (error) {
      setLog(error.message || "Could not select similar emails.");
    } finally {
      if (manageWorking) setWorking(false);
    }
  }

  /** Ensures query ready. */
  async function ensureQueryReady() {
    if (!state.lockedQuery || !state.lockedSender) {
      throw new Error(`Run '${LABELS.SELECT_LIKE_OPEN_EMAIL}' first so archive is locked to that sender.`);
    }

    await ensureSearchContext(state.lockedQuery);
    validateLockedArchiveContext();
  }

  /** Handles action archive all. */
  async function actionArchiveAll(options = {}) {
    const manageWorking = !options.skipWorking;
    if (manageWorking) setWorking(true);
    try {
      await ensureQueryReady();
      validateLockedArchiveContext();
      setLog("Selecting conversations on current page...");
      await selectAllMatchingSearch({ includeAllInSearch: false });
      await waitForSelectionToSettle();
      setLog(`${state.selectedConversationsText} Archiving current page...`);
      await archiveSelected();
      setLog("Archive action sent for current page.");
      flashSuccess(STRINGS.toast.archived);
      showToast(STRINGS.toast.archiveComplete);
    } catch (error) {
      setLog(error.message || "Archive failed.");
    } finally {
      if (manageWorking) setWorking(false);
    }
  }

  /** Handles action archive recursive. */
  async function actionArchiveRecursive(options = {}) {
    const manageWorking = !options.skipWorking;
    if (manageWorking) setWorking(true);
    try {
      await ensureQueryReady();
      await waitForListToLoadForBatchStep(20000);
      if (!getThreadRows().length) {
        throw new Error("No emails found in the current filtered list to archive.");
      }

      let cycles = 0;
      let unchangedCycles = 0;
      const maxCycles = 300;
      const maxUnchangedCycles = 4;

      while (cycles < maxCycles) {
        if (shouldStopExecution()) {
          setLog(`Stopped after ${cycles} cycle(s).`);
          showToast(STRINGS.toast.executionStopped);
          return;
        }
        validateLockedArchiveContext();
        const rows = getThreadRows();
        if (!rows.length) break;

        const beforeFingerprint = getFirstRowFingerprint();
        setLog(`Cycle ${cycles + 1}: selecting listed emails...`);
        await selectAllMatchingSearch({ includeAllInSearch: false });
        await waitForSelectionToSettle();
        setLog(`Cycle ${cycles + 1}: archiving...`);
        await archiveSelected();
        // Wait (up to the previous fixed 2s) for Gmail to repopulate the list with
        // different rows; then a short settle before the next cycle reads it.
        const refreshed = await waitFor(() => {
          if (!getThreadRows().length) return false;
          const fingerprint = getFirstRowFingerprint();
          return !!(fingerprint && fingerprint !== beforeFingerprint);
        }, { timeout: 2000, interval: 150, shouldAbort: shouldStopExecution });
        if (refreshed) await sleep(300);

        cycles += 1;

        const afterRows = getThreadRows();
        const afterFingerprint = getFirstRowFingerprint();
        if (!afterRows.length) break;

        if (beforeFingerprint && afterFingerprint && beforeFingerprint === afterFingerprint) {
          unchangedCycles += 1;
          if (unchangedCycles < maxUnchangedCycles) {
            setLog(`Cycle ${cycles}: list unchanged, retrying (${unchangedCycles}/${maxUnchangedCycles})...`);
            await sleep(800);
          } else {
            setLog(`Stopped after ${cycles} cycles: list did not change after retries.`);
            flashSuccess(STRINGS.toast.archived);
            showToast(STRINGS.toast.archiveComplete);
            return;
          }
        } else {
          unchangedCycles = 0;
        }
      }

      if (cycles === 0) {
        setLog("No emails found to archive.");
        return;
      }
      setLog(`Archive loop completed after ${cycles} cycle(s).`);
      flashSuccess(STRINGS.toast.archived);
      showToast(STRINGS.toast.archiveComplete);
    } catch (error) {
      setLog(error.message || "Recursive archive failed.");
    } finally {
      if (manageWorking) setWorking(false);
    }
  }

  /** Handles action unsubscribe. */
  async function actionUnsubscribe(options = {}) {
    const manageWorking = !options.skipWorking;
    if (manageWorking) setWorking(true);
    try {
      setLog("Looking for unsubscribe in open email...");
      const sender = findOpenEmailSender();
      const alreadyUnsubscribedNotice = findAlreadyUnsubscribedNotice(sender);
      if (alreadyUnsubscribedNotice) {
        setLog(`Already unsubscribed from ${sender}.`);
        showToast(STRINGS.toast.alreadyUnsubscribed(sender));
        return;
      }
      const result = await clickUnsubscribeInOpenEmail();
      await dismissUnsubscribeDialogs();
      setLog(result);
      showToast(STRINGS.toast.unsubscribeComplete);
    } catch (error) {
      const message = error.message || "Unsubscribe failed.";
      if (message.includes("No unsubscribe button/link found")) {
        const proceed = await askProceedConfirmation(STRINGS.prompt.noUnsubscribe);
        if (proceed) {
          setLog("No unsubscribe button found. Proceeding to next action.");
          showToast(STRINGS.toast.proceedingWithoutUnsubscribe);
          return;
        }

        setLog("Execution stopped by user (unsubscribe confirmation).");
        if (state.batchExecuting) {
          state.stopExecutionRequested = true;
          showToast(STRINGS.toast.executionStopped);
        }
        return;
      }
      setLog(message);
    } finally {
      if (manageWorking) setWorking(false);
    }
  }

  /** Handles action go inbox. */
  async function actionGoInbox(options = {}) {
    const manageWorking = !options.skipWorking;
    if (manageWorking) setWorking(true);
    try {
      window.location.hash = "#inbox";
      await waitForThreadRows(8000);
      state.query = "";
      state.lockedQuery = "";
      state.lockedSender = "";
      state.selectedConversationsText = "";
      clearCachedNextEmailTarget();
      setLog("Moved to Inbox. Search context reset.");
      showToast(STRINGS.toast.movedToInbox);
    } catch (_) {
      setLog("Moved to Inbox.");
      showToast(STRINGS.toast.movedToInbox);
    } finally {
      if (manageWorking) setWorking(false);
    }
  }

  /** Shows archived emails by running the archived search query. */
  async function actionShowArchived() {
    setWorking(true);
    try {
      await runSearchQuery("-in:inbox -in:sent -in:drafts -in:spam -in:trash");
      setLog("Showing archived emails.");
      showToast(STRINGS.toast.showingArchived);
    } catch (err) {
      setLog("Could not run archived search: " + err.message);
    } finally {
      setWorking(false);
    }
  }

  /** Returns row open control. */
  function getRowOpenControl(row) {
    return queryFirst(row, SELECTORS.rowOpenControl) || row;
  }

  /** Finds cached target row index. */
  function findCachedTargetRowIndex(rows) {
    const targetThreadId = normalizeFingerprintText(state.nextTarget.threadId || "");
    const targetThreadToken = normalizeFingerprintText(state.nextTarget.threadToken || "");
    const targetUrl = normalizeComparableUrl(state.nextTarget.url || "");
    const targetSender = normalizeEmail(state.nextTarget.sender || "");
    const targetSubject = normalizeSubjectForMatch(state.nextTarget.subject || "");
    const targetDate = parseDateSignature(state.nextTarget.date || "");

    if (targetThreadId) {
      for (let i = 0; i < rows.length; i += 1) {
        if (getRowThreadLegacyId(rows[i]) === targetThreadId) return i;
      }
    }

    if (targetThreadToken) {
      for (let i = 0; i < rows.length; i += 1) {
        if (getRowThreadUrlToken(rows[i]) === targetThreadToken) return i;
      }
    }

    if (targetUrl) {
      for (let i = 0; i < rows.length; i += 1) {
        const rowUrl = normalizeComparableUrl(getThreadUrlFromRow(rows[i]) || "");
        if (rowUrl && rowUrl === targetUrl) return i;
      }
    }

    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      const rowSender = getRowSenderEmail(row);
      if (targetSender && rowSender !== targetSender) continue;

      const rowSubject = normalizeSubjectForMatch(getRowSubjectText(row));
      const subjectMatches = !!(
        targetSubject &&
        rowSubject &&
        (rowSubject.includes(targetSubject) || targetSubject.includes(rowSubject))
      );

      if (targetSubject && !subjectMatches) continue;

      if (targetDate.canonical || targetDate.dayMonth) {
        const rowDate = parseDateSignature(getRowDateText(row));
        const dateMatches = !!(
          (targetDate.canonical && rowDate.canonical && targetDate.canonical === rowDate.canonical) ||
          (targetDate.dayMonth && rowDate.dayMonth && targetDate.dayMonth === rowDate.dayMonth)
        );
        if (!dateMatches) continue;
      }

      return i;
    }

    return -1;
  }

  /** Opens cached next email from list context. */
  async function openCachedNextEmailFromListContext() {
    const listHash = getListContextHashFromHash(state.nextTarget.listHash || "");
    if (listHash) {
      navigateWithinGmail(listHash);
      await waitForThreadRows(12000);
      await sleep(200);
    } else {
      await navigateToDiscoveryListContext(state.nextTarget.sender || "");
    }

    const pageOffset = Math.max(0, Number.parseInt(String(state.nextTarget.pageOffset ?? ""), 10) || 0);
    for (let i = 0; i < pageOffset; i += 1) {
      if (shouldStopExecution()) return false;
      const moved = await goToNextResultsPage();
      if (!moved) return false;
    }

    const rows = await waitForThreadRows(10000);
    if (!rows.length) return false;
    const rowIndex = findCachedTargetRowIndex(rows);
    if (rowIndex < 0) return false;

    const openControl = getRowOpenControl(rows[rowIndex]);
    robustClick(openControl);
    const openThread = await waitForSelector(SELECTORS.openThreadHeadingInMain, 12000);
    return !!openThread;
  }

  /** Handles action go next page. */
  async function actionGoNextPage(options = {}) {
    const manageWorking = !options.skipWorking;
    if (manageWorking) setWorking(true);
    let targetLogTimer = null;
    /** Handles stop target log timer. */
    const stopTargetLogTimer = () => {
      if (targetLogTimer) {
        clearInterval(targetLogTimer);
        targetLogTimer = null;
      }
    };
    try {
      setLog("Load Next Email [1/8]: Starting action...");
      const cached = !!state.nextTarget.url;
      if (cached) {
        setLog("Load Next Email [2/8]: Cached target found.");
      } else {
        setLog("Load Next Email [2/8]: No cached target present.");
      }
      setLog("Load Next Email [3/8]: Checking stop-request flag...");
      if (shouldStopExecution()) {
        setLog("Load Next Email [3/8]: Stop requested. Aborting.");
        showToast(STRINGS.toast.executionStopped);
        return;
      }
      setLog("Load Next Email [4/8]: Validating target URL...");
      if (!cached || !state.nextTarget.url) {
        setLog("Load Next Email [4/8]: No cache — trying Gmail's Older button...");
        const olderBtn = findNextPageButton();
        if (olderBtn) {
          robustClick(olderBtn);
          await waitForSelector(SELECTORS.openThreadHeadingInMain, 12000);
          setLog("Load Next Email: Opened next email via Older button.");
          showToast(STRINGS.toast.openedNextEmail);
          return;
        }
        setLog("Load Next Email [4/8]: No cached target and no Older button found.");
        announceEmailTargetStatus("Email target before open");
        showToast(STRINGS.toast.noCachedTarget);
        return;
      }

      const targetUrl = state.nextTarget.url;
      setLog("Load Next Email [5/8]: Target URL resolved.");
      announceEmailTargetStatus("Email target before open");
      const targetMessage = `Cached email target: ${targetUrl}`;
      setLog(targetMessage);
      setLog("Load Next Email [6/8]: Opening target from list context...");
      const openedFromList = await openCachedNextEmailFromListContext();
      if (openedFromList) {
        stopTargetLogTimer();
        setLog("Load Next Email [7/8]: Opened via list-row context.");
        setLog("Load Next Email [8/8]: Completed. j/k navigation should remain in context.");
        showToast(STRINGS.toast.openedNextEmail);
        return;
      }
      setLog("Load Next Email [7/8]: List-row open failed. Falling back to direct URL...");
      targetLogTimer = setInterval(() => {
        setLog(targetMessage);
      }, 450);
      navigateWithinGmail(targetUrl);
      setLog("Load Next Email [8/8]: Waiting for next email view to load...");
      await waitForSelector(SELECTORS.openThreadHeadingInMain, 12000);
      stopTargetLogTimer();
      setLog("Load Next Email: Completed via URL fallback.");
      showToast(STRINGS.toast.openedNextEmail);
    } catch (error) {
      stopTargetLogTimer();
      setLog(`Load Next Email failed: ${error.message || "Go to next page failed."}`);
    } finally {
      stopTargetLogTimer();
      if (manageWorking) setWorking(false);
    }
  }

  /**
   * Tiny DOM builder: h(tag, attrs, ...children).
   * attrs are set with setAttribute (true -> empty attribute, false/null/undefined -> skipped);
   * children may be strings (text nodes), nodes, arrays, or null.
   */
  function h(tag, attrs = {}, ...children) {
    const el = document.createElement(tag);
    for (const [name, value] of Object.entries(attrs || {})) {
      if (value === false || value === null || value === undefined) continue;
      el.setAttribute(name, value === true ? "" : String(value));
    }
    const append = (child) => {
      if (child === null || child === undefined || child === false) return;
      if (Array.isArray(child)) {
        child.forEach(append);
        return;
      }
      el.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
    };
    children.forEach(append);
    return el;
  }

  /** Builds the floating toggle button. */
  function buildToggle() {
    return h(
      "button",
      { id: "gc-toggle", type: "button" },
      h("span", { id: "gc-toggle-grip", "aria-hidden": "true" }, "\u283f"),
      STRINGS.ui.toggle
    );
  }

  /** Builds one checkbox/radio + button action row. */
  function buildActionRow(actionId, label, inputType = "checkbox", radioName = null) {
    return h(
      "div",
      { class: "gc-action-row" },
      h("input", {
        class: "gc-action-checkbox",
        type: inputType,
        name: radioName,
        "data-action-id": actionId,
        "aria-label": STRINGS.ui.selectActionAria(label)
      }),
      h("button", { class: "gc-btn", id: actionId }, label)
    );
  }

  /** Builds the next-email target details accordion section. */
  function buildNextTargetSection() {
    const labels = STRINGS.ui.nextTargetLabels;
    const empty = STRINGS.ui.emptyValue;
    const rows = [
      ["url", "gc-next-target-url", STRINGS.ui.notCached],
      ["sender", "gc-next-target-sender", empty],
      ["subject", "gc-next-target-subject", empty],
      ["date", "gc-next-target-date", empty],
      ["threadId", "gc-next-target-thread-id", empty],
      ["threadToken", "gc-next-target-thread-token", empty],
      ["pageOffset", "gc-next-target-page-offset", "0"],
      ["listHash", "gc-next-target-list-hash", empty]
    ];
    return h(
      "div",
      { id: "gc-next-target-section", class: "gc-section gc-hidden" },
      h(
        "details",
        { id: "gc-next-target-accordion" },
        h(
          "summary",
          { id: "gc-next-target-summary-text", class: "gc-next-target-summary" },
          STRINGS.ui.notCached
        ),
        h(
          "div",
          { class: "gc-next-target-grid" },
          rows.map(([key, id, initial]) => [
            h("div", { class: "gc-next-target-label" }, labels[key]),
            h("div", { id, class: "gc-next-target-value" }, initial)
          ])
        )
      )
    );
  }

  /** Builds the sidebar root (same ids/classes/structure styles.css expects). */
  function buildSidebarRoot() {
    const ui = STRINGS.ui;
    const root = h("aside", { id: "gc-root", class: "gc-hidden" });
    root.append(
      h(
        "div",
        { id: "gc-header" },
        h("span", { id: "gc-drag-handle", "aria-hidden": "true" }, "\u283f"),
        h(
          "button",
          { type: "button", id: "gc-minimize", title: ui.minimizeTitle, "aria-label": ui.minimizeAria },
          "\u2013"
        ),
        h("p", { id: "gc-title" }, ui.title)
      ),
      h(
        "div",
        { id: "gc-working", "aria-live": "polite", "aria-hidden": "true" },
        h("span", { class: "gc-working-spinner", "aria-hidden": "true" }),
        h("span", { class: "gc-working-text" }, ui.working)
      ),
      h(
        "div",
        { id: "gc-body" },
        h(
          "div",
          { class: "gc-section gc-section-prepare" },
          h("p", { class: "gc-section-title" }, ui.sectionPrepare),
          buildActionRow(ACTION_BUTTON_IDS.UNSUBSCRIBE, LABELS.UNSUBSCRIBE_OPEN_EMAIL),
          buildActionRow(ACTION_BUTTON_IDS.SELECT_LIKE_OPEN, LABELS.SELECT_LIKE_OPEN_EMAIL)
        ),
        h(
          "div",
          { class: "gc-section gc-section-archive" },
          h("p", { class: "gc-section-title" }, ui.sectionArchive),
          buildActionRow(ACTION_BUTTON_IDS.ARCHIVE_THIS_PAGE, LABELS.ARCHIVE_THIS_PAGE, "radio", "gc-archive-mode"),
          buildActionRow(ACTION_BUTTON_IDS.ARCHIVE_ALL_PAGES, LABELS.ARCHIVE_ALL_PAGES, "radio", "gc-archive-mode")
        ),
        h(
          "div",
          { class: "gc-section gc-section-inbox" },
          h("p", { class: "gc-section-title" }, ui.sectionInbox),
          buildActionRow(ACTION_BUTTON_IDS.GO_TO_INBOX, LABELS.GO_TO_INBOX, "radio", "gc-inbox-mode"),
          buildActionRow(ACTION_BUTTON_IDS.GO_TO_NEXT_PAGE, LABELS.GO_TO_NEXT_PAGE, "radio", "gc-inbox-mode"),
          h(
            "div",
            { class: "gc-action-row", style: "display:flex;justify-content:center;" },
            h(
              "button",
              { class: "gc-btn", id: "gc-show-archived", style: "width:100%;text-align:center;" },
              ui.showArchived
            )
          )
        ),
        buildNextTargetSection(),
        h(
          "button",
          {
            class: "gc-btn gc-btn-execute",
            id: "gc-execute-selected",
            "data-ready": "false",
            disabled: true,
            title: `${ui.executeSelected} (${EXECUTE_SELECTED_SHORTCUT_LABEL})`
          },
          `${ui.executeSelected} `,
          h("span", { class: "gc-shortcut-hint" }, EXECUTE_SELECTED_SHORTCUT_LABEL)
        ),
        h("button", { class: "gc-btn gc-btn-stop", id: "gc-stop-execution", disabled: true }, ui.stopExecution)
      ),
      h(
        "div",
        { id: "gc-confirm", role: "alert", "aria-live": "assertive" },
        h("p", { id: "gc-confirm-message" }),
        h(
          "div",
          { id: "gc-confirm-actions" },
          h("button", { type: "button", id: "gc-confirm-proceed" }, ui.proceed),
          h("button", { type: "button", id: "gc-confirm-stop" }, ui.stop)
        )
      ),
      h(
        "div",
        { id: "gc-success", "aria-live": "polite" },
        h("span", { class: "gc-success-icon", "aria-hidden": "true" }, "\u2713"),
        h("span", { class: "gc-success-text" }, ui.completed)
      ),
      h("div", { id: "gc-log" }, ui.ready),
      h("div", { id: "gc-toast", role: "status", "aria-live": "polite" })
    );
    return root;
  }

  /** Mounts sidebar. */
  function mountSidebar() {
    if (state.extensionContextInvalidated) return;
    // Gmail print view (Print all / print thread) — never inject UI there.
    if (new URLSearchParams(location.search).get("view") === "pt") return;
    if (document.getElementById("gc-root") && document.getElementById("gc-toggle")) {
      renderNextEmailTargetSection();
      syncExtensionVisibilityFromStorage();
      return;
    }

    const toggle = buildToggle();
    document.body.appendChild(toggle);

    const root = buildSidebarRoot();
    document.body.appendChild(root);

    toggle.addEventListener("click", () => {
      root.classList.toggle("gc-hidden");
      keepElInView(root);
    });

    document.getElementById("gc-minimize")?.addEventListener("click", () => {
      root.classList.add("gc-hidden");
    });

    Object.values(ACTION_BUTTON_IDS).forEach((buttonId) => {
      document.getElementById(buttonId)?.addEventListener("click", () => {
        const label = document.getElementById(buttonId)?.textContent?.trim() || STRINGS.ui.actionFallback;
        void runWithElapsedToast(label, async () => {
          await runActionByButtonId(buttonId);
        });
      });
    });

    document.getElementById("gc-show-archived")?.addEventListener("click", () => {
      void runWithElapsedToast(STRINGS.ui.showArchived, async () => {
        await actionShowArchived();
      });
    });

    document.querySelectorAll(".gc-action-checkbox").forEach((checkbox) => {
      checkbox.addEventListener("change", () => {
        renderNextEmailTargetSection();
        updateExecuteSelectedState();
        persistActionCheckboxState();
      });
    });
    document.getElementById("gc-execute-selected")?.addEventListener("click", () => {
      triggerExecuteSelected();
    });
    document.getElementById("gc-stop-execution")?.addEventListener("click", () => {
      void runWithElapsedToast(STRINGS.ui.stopExecution, async () => {
        requestStopExecution();
      });
    });
    document.getElementById("gc-confirm-proceed")?.addEventListener("click", () => {
      resolveProceedConfirmation(true);
    });
    document.getElementById("gc-confirm-stop")?.addEventListener("click", () => {
      resolveProceedConfirmation(false);
    });
    restoreActionCheckboxState();
    renderNextEmailTargetSection();
    findOpenEmailSender();
    refreshControlStates();

    makeDraggable(toggle, null, null, "y");
    makeDraggable(root, ROOT_POS_KEY, document.getElementById("gc-header"));

    setLog(`Ready. Open an email, then click '${LABELS.SELECT_LIKE_OPEN_EMAIL}'.`);
    syncExtensionVisibilityFromStorage();
  }

  /** Bootstraps startup. */
  function boot() {
    if (!document.body) return;
    mountSidebar();
    installShortcutCommandListener();
    loadCachedNextEmailTarget();
  }

  boot();

  let resizeFrame = 0;
  window.addEventListener("resize", () => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => {
      keepElInView(document.getElementById("gc-root"));
      keepElInView(document.getElementById("gc-toggle"));
    });
  });

  let lastHref = location.href;
  let refreshControlsDebounceTimer = null;
  const observer = new MutationObserver(() => {
    if (state.extensionContextInvalidated) return;
    if (location.href !== lastHref) {
      lastHref = location.href;
      mountSidebar();
    } else if (!document.getElementById("gc-root") || !document.getElementById("gc-toggle")) {
      mountSidebar();
    } else {
      clearTimeout(refreshControlsDebounceTimer);
      refreshControlsDebounceTimer = setTimeout(refreshOpenEmailState, 300);
    }
  });

  observer.observe(document.documentElement || document.body, {
    childList: true,
    subtree: true
  });

  /** Handles on storage changed. */
  const onStorageChanged = (changes, areaName) => {
    if (state.extensionContextInvalidated) return;
    if (areaName !== "local") return;
    if (changes[SHOW_EXTENSION_KEY]) {
      setExtensionVisibility(changes[SHOW_EXTENSION_KEY].newValue !== false);
    }
    if (changes[NEXT_EMAIL_TARGET_CACHE_KEY]) {
      const cached = changes[NEXT_EMAIL_TARGET_CACHE_KEY].newValue || {};
      if (!isCachedTargetValidForCurrentContext(cached)) {
        state.nextTarget = createEmptyNextTarget();
        renderNextEmailTargetSection();
        return;
      }
      state.nextTarget = nextTargetFromStored(cached);
      renderNextEmailTargetSection();
    }
  };
  try {
    chrome.storage.onChanged.addListener(onStorageChanged);
  } catch (error) {
    if (isContextInvalidatedError(error)) {
      markExtensionContextInvalidated(error);
    } else {
      throw error;
    }
  }

  window.addEventListener("hashchange", () => {
    if (state.extensionContextInvalidated) return;
    mountSidebar();
  });
})();
