(() => {
  if (window.__gmailCleanerLoaded) return;
  window.__gmailCleanerLoaded = true;

  const state = {
    openSender: "",
    query: "",
    lockedSender: "",
    lockedQuery: "",
    selectedConversationsText: "",
    shortcut: null,
    working: false,
    batchExecuting: false,
    stopExecutionRequested: false
  };
  const LABELS = {
    UNSUBSCRIBE_OPEN_EMAIL: "Unsubscribe Open Email",
    SELECT_LIKE_OPEN_EMAIL: "Select All Emails Like Open Email",
    ARCHIVE_THIS_PAGE: "Archive Listed Emails in This Page",
    ARCHIVE_ALL_PAGES: "Archive Listed Emails in All Pages",
    GO_TO_INBOX: "Go to Inbox"
  };
  const ACTION_BUTTON_IDS = {
    UNSUBSCRIBE: "gc-unsub",
    SELECT_LIKE_OPEN: "gc-like-open",
    ARCHIVE_THIS_PAGE: "gc-archive",
    ARCHIVE_ALL_PAGES: "gc-archive-rec",
    GO_TO_INBOX: "gc-inbox"
  };
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
  state.shortcut = { ...DEFAULT_SHORTCUT };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  let successTimer = null;
  let proceedConfirmationResolver = null;
  const toastQueue = [];
  let toastQueueActive = false;

  function waitForSelector(selector, timeout = 7000) {
    return new Promise((resolve) => {
      const start = Date.now();
      const timer = setInterval(() => {
        const el = document.querySelector(selector);
        if (el) {
          clearInterval(timer);
          resolve(el);
        }
        if (Date.now() - start > timeout) {
          clearInterval(timer);
          resolve(null);
        }
      }, 150);
    });
  }

  function setLog(msg) {
    const el = document.getElementById("gc-log");
    if (el) el.textContent = msg;
  }

  function flashSuccess(message = "Completed") {
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

  function showToast(message, options = {}) {
    const durationMs = options.durationMs || 2400;
    const toast = document.getElementById("gc-toast");
    if (!toast) return;
    toastQueue.push({ message, durationMs });
    void flushToastQueue();
  }

  function formatElapsedMs(ms) {
    if (ms < 1000) return `${Math.max(1, Math.round(ms))}ms`;
    const seconds = ms / 1000;
    return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  }

  async function runWithElapsedToast(label, runner) {
    const start = performance.now();
    try {
      await runner();
    } finally {
      const elapsed = performance.now() - start;
      showToast(`${label}: ${formatElapsedMs(elapsed)} elapsed`);
    }
  }

  function hideProceedConfirmation() {
    const box = document.getElementById("gc-confirm");
    if (!box) return;
    box.classList.remove("gc-confirm-visible");
  }

  function resolveProceedConfirmation(result) {
    const resolver = proceedConfirmationResolver;
    proceedConfirmationResolver = null;
    hideProceedConfirmation();
    if (resolver) resolver(result);
  }

  function askProceedConfirmation(message) {
    const box = document.getElementById("gc-confirm");
    const messageEl = document.getElementById("gc-confirm-message");
    if (!box || !messageEl) return Promise.resolve(false);

    if (proceedConfirmationResolver) {
      resolveProceedConfirmation(false);
    }

    messageEl.textContent = message;
    box.classList.add("gc-confirm-visible");

    return new Promise((resolve) => {
      proceedConfirmationResolver = resolve;
    });
  }

  function setWorking(next) {
    state.working = next;
    document.querySelectorAll(".gc-btn").forEach((btn) => {
      btn.disabled = next;
    });
    document.querySelectorAll(".gc-action-checkbox").forEach((checkbox) => {
      checkbox.disabled = next;
    });
    const workingEl = document.getElementById("gc-working");
    if (workingEl) {
      workingEl.classList.toggle("gc-working-visible", next);
      workingEl.setAttribute("aria-hidden", next ? "false" : "true");
    }
    updateExecuteSelectedState();
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

  function loadShortcutConfig() {
    chrome.storage.local.get([EXECUTE_SELECTED_SHORTCUT_KEY], (result) => {
      if (chrome.runtime.lastError) {
        state.shortcut = { ...DEFAULT_SHORTCUT };
        return;
      }
      state.shortcut = normalizeShortcutConfig(result[EXECUTE_SELECTED_SHORTCUT_KEY]);
    });
  }

  function isEditableTarget(target) {
    if (!target) return false;
    const tag = (target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return true;
    if (target.isContentEditable) return true;
    return Boolean(target.closest?.("[contenteditable='true']"));
  }

  function matchesShortcut(event) {
    const shortcut = state.shortcut || DEFAULT_SHORTCUT;
    if (!shortcut.enabled) return false;
    if ((event.key || "").toUpperCase() !== shortcut.key) return false;
    if (event.altKey !== shortcut.alt) return false;
    if (event.shiftKey !== shortcut.shift) return false;
    if (event.ctrlKey !== shortcut.ctrl) return false;
    if (event.metaKey !== shortcut.meta) return false;
    return true;
  }

  function onGlobalKeydown(event) {
    if (!matchesShortcut(event)) return;
    if (isEditableTarget(event.target)) return;
    if (state.working || state.batchExecuting) return;

    event.preventDefault();
    event.stopPropagation();
    void runWithElapsedToast("Execute Selected", async () => {
      await executeSelectedActions();
    });
  }

  function getActionHandler(buttonId) {
    const handlers = {
      [ACTION_BUTTON_IDS.UNSUBSCRIBE]: actionUnsubscribe,
      [ACTION_BUTTON_IDS.SELECT_LIKE_OPEN]: actionSelectLikeOpen,
      [ACTION_BUTTON_IDS.ARCHIVE_THIS_PAGE]: actionArchiveAll,
      [ACTION_BUTTON_IDS.ARCHIVE_ALL_PAGES]: actionArchiveRecursive,
      [ACTION_BUTTON_IDS.GO_TO_INBOX]: actionGoInbox
    };
    return handlers[buttonId] || null;
  }

  async function runActionByButtonId(buttonId, options = {}) {
    const handler = getActionHandler(buttonId);
    if (!handler) return;
    await handler(options);
  }

  function getSelectedActionIds() {
    return [...document.querySelectorAll(".gc-action-checkbox:checked")]
      .map((checkbox) => checkbox.getAttribute("data-action-id") || "")
      .filter(Boolean);
  }

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

  function requestStopExecution() {
    if (!state.batchExecuting) return;
    state.stopExecutionRequested = true;
    setLog("Stop requested. Finishing current step...");
  }

  function shouldStopExecution() {
    return state.batchExecuting && state.stopExecutionRequested;
  }

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
        showToast("Execution stopped");
      }
    } finally {
      state.batchExecuting = false;
      state.stopExecutionRequested = false;
      setWorking(false);
    }
  }

  function shouldWaitBetweenActions(currentActionId, nextActionId) {
    void currentActionId;
    // If the next step is navigating to Inbox, waiting for list rows is unnecessary
    // and can add long delays when archive emptied the current filtered results.
    if (nextActionId === ACTION_BUTTON_IDS.GO_TO_INBOX) return false;
    return true;
  }

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
        await waitForSelector("tr.zA", 1200);
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

  function setExtensionVisibility(enabled) {
    const toggle = document.getElementById("gc-toggle");
    const root = document.getElementById("gc-root");
    if (toggle) toggle.style.display = enabled ? "" : "none";
    if (root) {
      if (!enabled) root.classList.add("gc-hidden");
      root.style.display = enabled ? "" : "none";
    }
  }

  function syncExtensionVisibilityFromStorage() {
    chrome.storage.local.get([SHOW_EXTENSION_KEY], (result) => {
      if (chrome.runtime.lastError) {
        setExtensionVisibility(true);
        return;
      }

      setExtensionVisibility(result[SHOW_EXTENSION_KEY] !== false);
    });
  }

  function findOpenEmailSender() {
    const openSender =
      document.querySelector("h3.iw span[email]")?.getAttribute("email") ||
      document.querySelector("span[email][name]")?.getAttribute("email") ||
      "";

    state.openSender = openSender;
    return openSender;
  }

  function getThreadRows() {
    return [...document.querySelectorAll("tr.zA")].filter((row) => {
      if (!isVisible(row)) return false;
      const main = row.closest("div[role='main']");
      if (!main || !isVisible(main)) return false;
      return true;
    });
  }

  function rowToItem(row) {
    const sender =
      row.querySelector("span[email]")?.getAttribute("email") ||
      row.querySelector("span[email]")?.textContent?.trim() ||
      "Unknown sender";
    const subject = row.querySelector("span.bog")?.textContent?.trim() || "(No subject)";
    return { sender, subject };
  }

  function renderList(items, title = "Email list") {
    void items;
    void title;
  }

  function escapeHtml(value) {
    return value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

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

  function normalizeQuery(value) {
    return (value || "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  function normalizeEmail(value) {
    return (value || "").trim().toLowerCase();
  }

  function senderSignalMatchesExpected(signal, expected) {
    const lhs = normalizeEmail(signal);
    const rhs = normalizeEmail(expected);
    if (!lhs || !rhs) return false;
    if (lhs === rhs) return true;

    // Gmail may visually truncate sender text (e.g. "name@subst").
    return rhs.startsWith(lhs) || lhs.startsWith(rhs);
  }

  function extractSenderFromQuery(query) {
    const match = (query || "").match(/\bfrom:([^\s]+)/i);
    if (!match) return "";
    return normalizeEmail(match[1].replace(/^"|"$/g, ""));
  }

  function getCurrentSearchInput() {
    return (
      document.querySelector("input[name='q']") ||
      document.querySelector("input[aria-label='Search mail']") ||
      null
    );
  }

  function getCurrentSearchQuery() {
    const input = getCurrentSearchInput();
    return normalizeQuery(input?.value || "");
  }

  function getRefinementQuery() {
    const chips = [...document.querySelectorAll("div.Ii[data-query]")].filter((el) => isVisible(el));
    const best = chips
      .map((el) => normalizeQuery(el.getAttribute("data-query") || ""))
      .sort((a, b) => b.length - a.length)[0];
    return best || "";
  }

  function getHeaderSenderSignals() {
    const extractEmailFromText = (text) => {
      const match = (text || "").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
      return normalizeEmail(match?.[0] || "");
    };

    const candidates = [
      ...document.querySelectorAll("div.bX div.c5.J-J5-Ji, div.bX div.dp div.dr div.Cz.J-J5-Ji.e")
    ]
      .filter((el) => isVisible(el))
      .map((el) => extractEmailFromText(el.textContent || ""))
      .filter(Boolean)
      .filter((value) => value.includes("@"));

    return [...new Set(candidates)];
  }

  function getRowSenderSignals(limit = 15) {
    const rows = getThreadRows().slice(0, limit);
    return rows
      .map((row) => normalizeEmail(row.querySelector("span[email]")?.getAttribute("email") || ""))
      .filter(Boolean);
  }

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
      console.warn("[GmailCleaner] Safety mismatch: header sender", {
        expectedSender,
        mismatchedHeader,
        headerSenders,
        currentQuery,
        refinementQuery
      });
      throw new Error("Safety check failed: page header sender differs from the sender selected earlier.");
    }

    const hasExpectedInRows = rowSenders.some((sender) =>
      senderSignalMatchesExpected(sender, expectedSender)
    );
    if (rowSenders.length > 0 && !hasExpectedInRows) {
      console.warn("[GmailCleaner] Safety mismatch: expected sender missing from listed rows", {
        expectedSender,
        rowSenders,
        currentQuery,
        refinementQuery
      });
      throw new Error("Safety check failed: expected sender is not present in listed emails.");
    }

    const mismatchedRows = rowSenders.filter(
      (sender) => !senderSignalMatchesExpected(sender, expectedSender)
    );
    if (mismatchedRows.length > 0) {
      console.warn("[GmailCleaner] Mixed row senders detected; proceeding because expected sender is present", {
        expectedSender,
        mismatchedRows,
        rowSenders,
        currentQuery,
        refinementQuery
      });
    }

    const hasAnySignal =
      !!currentQuery ||
      !!refinementQuery ||
      headerSenders.length > 0 ||
      rowSenders.length > 0;
    if (!hasAnySignal) {
      throw new Error("Safety check failed: could not confirm Gmail sender/search context.");
    }
  }

  async function gotoInboxListView() {
    const inThread = !!document.querySelector("div[role='main'] h2.hP, div[role='main'] h2[data-thread-perm-id]");
    if (inThread) {
      window.location.hash = "#inbox";
      await sleep(1000);
      await waitForSelector("tr.zA", 6000);
    }
  }

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
    await sleep(700);

    // Gmail sometimes needs a second Enter to execute from filled search box.
    if (location.href === previousUrl) {
      pressEnterOnSearch();
      await sleep(700);
    }

    // Fallback only if Enter didn't trigger the search route.
    if (location.href === previousUrl) {
      window.location.hash = `#search/${encodeURIComponent(query)}`;
      await sleep(800);
    }

    await waitForSelector("tr.zA", 12000);
    await sleep(500);
    return query;
  }

  async function searchBySender(sender) {
    const query = `from:${sender} in:inbox`;
    return runSearchQuery(query);
  }

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

  function findMasterCheckbox(toolbar) {
    return (
      toolbar.querySelector("span.T-Jo.J-J5-Ji.T-Jo-auq.T-Jo-iAfbIe[role='checkbox']") ||
      toolbar.querySelector("span.T-Jo.J-J5-Ji.T-Jo-auq[role='checkbox']") ||
      toolbar.querySelector("span.T-Jo.J-J5-Ji[role='checkbox']") ||
      null
    );
  }

  function findSelectButton(toolbar) {
    return [...toolbar.querySelectorAll("div[role='button'], span[role='button'], button")].find((el) => {
      const aria = (el.getAttribute("aria-label") || "").toLowerCase();
      const tooltip = (el.getAttribute("data-tooltip") || "").toLowerCase();
      return isVisible(el) && (aria === "select" || tooltip === "select");
    });
  }

  function findAllMenuItem() {
    const direct = [...document.querySelectorAll(".J-M[role='menu'] .J-N, .J-M[role='menu'] [role='menuitem']")]
      .find((el) => {
        if (!isVisible(el)) return false;
        const selector = (el.getAttribute("selector") || "").toLowerCase();
        const text = (el.textContent || "").trim().toLowerCase();
        const aria = (el.getAttribute("aria-label") || "").trim().toLowerCase();
        return selector === "all" || text === "all" || aria === "all";
      });
    if (direct) return direct;

    const nestedLabel = [...document.querySelectorAll(".J-M[role='menu'] .J-N-Jz")].find((el) => {
      if (!isVisible(el)) return false;
      return (el.textContent || "").trim().toLowerCase() === "all";
    });
    if (nestedLabel) return nestedLabel.closest(".J-N") || nestedLabel;

    return null;
  }

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

  function isMasterChecked(toolbar) {
    return findMasterCheckbox(toolbar)?.getAttribute("aria-checked") === "true";
  }

  function findOpenSelectMenu() {
    return [...document.querySelectorAll(".J-M[role='menu']")].find((el) => isVisible(el)) || null;
  }

  async function clickAllMenuItem(allItem) {
    const label = allItem.querySelector(".J-N-Jz");
    robustClick(allItem);
    dispatchMenuClickSequence(allItem);
    if (label) {
      robustClick(label);
      dispatchMenuClickSequence(label);
    }
    await sleep(220);
  }

  function getSelectionDebugState(toolbar) {
    const master = findMasterCheckbox(toolbar);
    return {
      masterChecked: master?.getAttribute("aria-checked") || "missing",
      masterClass: master?.className || "missing",
      masterSelector: master?.getAttribute("selector") || ""
    };
  }

  async function tryClickAllMenuOption(selectButton, attempts = 4) {
    for (let i = 0; i < attempts; i += 1) {
      robustClick(selectButton);
      await sleep(260);
      const menu = findOpenSelectMenu();
      if (!menu) continue;

      const allItem = findAllMenuItem();
      if (!allItem) continue;

      console.log("[GmailCleaner] Found 'All' menu item", {
        attempt: i + 1,
        className: allItem.className,
        selector: allItem.getAttribute("selector"),
        text: (allItem.textContent || "").trim()
      });

      await clickAllMenuItem(allItem);
      console.log("[GmailCleaner] Clicked 'All' menu item", {
        attempt: i + 1,
        className: allItem.className,
        ariaSelected: allItem.getAttribute("aria-selected"),
        ariaChecked: allItem.getAttribute("aria-checked")
      });
      return true;
    }
    return false;
  }

  async function ensureMasterChecked(toolbar, attempts = 6) {
    for (let i = 0; i < attempts; i += 1) {
      const master = findMasterCheckbox(toolbar);
      if (master?.getAttribute("aria-checked") === "true") return true;
      const inner = master?.querySelector(".T-Jo-auh[role='presentation']");
      if (inner) {
        robustClick(inner);
        await sleep(220);
      }
      if (master) {
        robustClick(master);
        await sleep(280);
      }
    }
    return findMasterCheckbox(toolbar)?.getAttribute("aria-checked") === "true";
  }

  async function selectAllMatchingSearch(options = {}) {
    const { includeAllInSearch = true } = options;
    const toolbar = getMailboxToolbar() || document.querySelector("div[gh='tl']") || document;
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
        await sleep(280);
      }
    }
    console.log("[GmailCleaner] Selection state after 'All' click/fallback", getSelectionDebugState(toolbar));

    const selected = await ensureMasterChecked(toolbar, 8);
    console.log("[GmailCleaner] Selection state after ensureMasterChecked", {
      selected,
      ...getSelectionDebugState(toolbar)
    });
    if (!selected) {
      const menu = findOpenSelectMenu();
      if (menu) {
        menu.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
        menu.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", bubbles: true, cancelable: true }));
        await sleep(250);
      }

      // Final fallback: Gmail keyboard shortcut for "select all" (requires shortcuts enabled).
      triggerKeySequence(["*", "a"]);
      await sleep(350);
      console.log("[GmailCleaner] Selection state after keyboard fallback", getSelectionDebugState(toolbar));
    }

    const selectedAfterFallback = isMasterChecked(toolbar) || await ensureMasterChecked(toolbar, 5);
    console.log("[GmailCleaner] Final selection state", {
      selectedAfterFallback,
      ...getSelectionDebugState(toolbar)
    });
    if (!selectedAfterFallback) {
      throw new Error("Could not check the master checkbox. Archive was skipped.");
    }

    const selectAllSearchLink = includeAllInSearch
      ? [...document.querySelectorAll("a")].find((a) =>
      /Select all conversations that match this search/i.test(a.textContent || "") ||
      /all conversations that match this search/i.test(a.textContent || "")
    )
      : null;

    if (selectAllSearchLink) {
      robustClick(selectAllSearchLink);
      await sleep(500);
      state.selectedConversationsText = "All conversations in search selected.";
      return true;
    }

    state.selectedConversationsText = "Selected current page conversations.";
    return false;
  }

  function hasAnySelectedConversationRow() {
    const rows = getThreadRows();
    if (!rows.length) return false;

    return rows.some((row) => {
      if ((row.getAttribute("aria-selected") || "").toLowerCase() === "true") return true;
      const rowCheckbox = row.querySelector("[role='checkbox']");
      return (rowCheckbox?.getAttribute("aria-checked") || "").toLowerCase() === "true";
    });
  }

  async function waitForSelectionToSettle(timeout = 5000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const toolbar = getMailboxToolbar() || document.querySelector("div[gh='tl']") || document;
      const masterChecked = isMasterChecked(toolbar);
      if (masterChecked && hasAnySelectedConversationRow()) {
        await sleep(180);
        return true;
      }
      await sleep(150);
    }
    return false;
  }

  async function archiveSelected() {
    const toolbar = getMailboxToolbar() || document;
    const archiveControl = [...toolbar.querySelectorAll("div[role='button'], button, span[role='button']")].find(
      (el) => {
        if (!isVisible(el)) return false;
        if ((el.getAttribute("aria-disabled") || "").toLowerCase() === "true") return false;
        const label = (el.getAttribute("aria-label") || "").toLowerCase();
        const tooltip = (el.getAttribute("data-tooltip") || "").toLowerCase();
        const text = (el.textContent || "").trim().toLowerCase();
        const act = (el.getAttribute("act") || "").trim();
        return (
          label.includes("archive") ||
          tooltip.includes("archive") ||
          text === "archive" ||
          act === "7"
        );
      }
    );

    if (archiveControl) {
      robustClick(archiveControl);
      await sleep(700);
      return;
    }

    triggerKeySequence(["e"]);
    await sleep(700);
  }

  function isDisabledControl(el) {
    if (!el) return true;
    if ((el.getAttribute("aria-disabled") || "").toLowerCase() === "true") return true;
    if ((el.getAttribute("disabled") || "").toLowerCase() === "true") return true;
    if (el.hasAttribute("disabled")) return true;
    const tabIndex = el.getAttribute("tabindex");
    if (tabIndex === "-1") return true;
    return false;
  }

  function findNextPageButton() {
    const controls = [
      ...document.querySelectorAll("div[role='button'], span[role='button'], button")
    ];

    return controls.find((el) => {
      if (!isVisible(el)) return false;
      if (isDisabledControl(el)) return false;
      const aria = (el.getAttribute("aria-label") || "").toLowerCase();
      const tooltip = (el.getAttribute("data-tooltip") || "").toLowerCase();
      const title = (el.getAttribute("title") || "").toLowerCase();
      const signal = `${aria} ${tooltip} ${title}`;

      // Gmail usually labels this as "Older" (next page), but keep a next-page fallback.
      const looksLikeNext =
        signal.includes("older") ||
        signal.includes("next page") ||
        signal === "next";
      if (!looksLikeNext) return false;

      // Avoid the tiny calendar/date picker arrows.
      if (el.closest("[role='dialog']")) return false;
      return true;
    }) || null;
  }

  function getFirstRowFingerprint() {
    const row = getThreadRows()[0];
    if (!row) return "";
    const threadId = row.getAttribute("data-legacy-thread-id") || "";
    const sender = row.querySelector("span[email]")?.getAttribute("email") || "";
    const subject = row.querySelector("span.bog")?.textContent?.trim() || "";
    return `${threadId}|${sender}|${subject}`;
  }

  async function waitForPageChange(previousFingerprint, timeout = 12000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const currentFingerprint = getFirstRowFingerprint();
      const rows = getThreadRows();
      if (rows.length === 0) return true;
      if (currentFingerprint && currentFingerprint !== previousFingerprint) return true;
      await sleep(250);
    }
    return false;
  }

  async function goToNextResultsPage() {
    const nextButton = findNextPageButton();
    if (!nextButton) return false;
    const before = getFirstRowFingerprint();
    robustClick(nextButton);
    await sleep(500);
    const moved = await waitForPageChange(before, 12000);
    if (moved) {
      await waitForSelector("div[gh='mtb'], tr.zA", 12000);
      await sleep(350);
    }
    return moved;
  }

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

  function getUnsubscribeSignal(el) {
    const text = (el.textContent || "").trim();
    const innerText = (el.innerText || "").trim();
    const ariaLabel = (el.getAttribute("aria-label") || "").trim();
    const tooltip = (el.getAttribute("data-tooltip") || "").trim();
    const title = (el.getAttribute("title") || "").trim();
    const signal = [text, innerText, ariaLabel, tooltip, title].join(" ").toLowerCase();
    return signal;
  }

  function findAlreadyUnsubscribedNotice(sender) {
    const normalizedSender = normalizeEmail(sender);
    if (!normalizedSender) return null;

    const quotedSender = `"${normalizedSender}"`;
    const main = document.querySelector("div[role='main']") || document;
    const nodes = [...main.querySelectorAll("div, span, p")].filter((el) => isVisible(el));
    const keywords = [
      "unsubscribed",
      "you are unsubscribed",
      "no longer receive",
      "won't get messages",
      "will not get messages",
      "won’t get messages"
    ];

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

  function findBestUnsubscribeTarget() {
    const main = document.querySelector("div[role='main']") || document;
    const candidates = [
      ...main.querySelectorAll("button, [role='button'], [role='link'], a, span, div")
    ];

    // Prefer header-level actionable controls inside the open message area.
    const scored = candidates
      .map((el) => {
        const signal = getUnsubscribeSignal(el);
        if (!signal.includes("unsubscribe")) return null;
        if (el.closest("blockquote")) return null;
        if (el.closest("a[href]") && !el.matches("a, [role='button'], button")) return null;

        let score = 0;
        if (el.matches("button, [role='button'], a")) score += 8;
        if (el.matches("[role='link']")) score += 9;
        if (el.classList.contains("Ca")) score += 10;
        if ((el.getAttribute("aria-label") || "").toLowerCase().includes("unsubscribe")) score += 6;
        if ((el.getAttribute("data-tooltip") || "").toLowerCase().includes("unsubscribe")) score += 5;
        if ((el.textContent || "").trim().toLowerCase().includes("unsubscribe")) score += 3;
        if (el.closest("div[role='main']")) score += 1;
        return { el, score };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score);

    return scored[0]?.el || null;
  }

  function findUnsubscribeConfirmButton() {
    const dialogs = [
      ...document.querySelectorAll("div[role='alertdialog'], div[role='dialog']")
    ];

    for (const dialog of dialogs) {
      const explicitOk = dialog.querySelector(
        "button[data-mdc-dialog-action='ok'], [role='button'][data-mdc-dialog-action='ok']"
      );
      if (explicitOk) return explicitOk;

      const buttons = [...dialog.querySelectorAll("button, [role='button'], [role='link'], a, span")];
      const match = buttons.find((btn) => {
        const signal = getUnsubscribeSignal(btn);
        if (signal.includes("cancel")) return false;
        return signal.includes("unsubscribe") || signal.includes("confirm") || signal.includes("ok");
      });
      if (match) return match;
    }

    return null;
  }

  function findUnsubscribeFollowupDismissButton() {
    const dialogs = [
      ...document.querySelectorAll("div[role='alertdialog'], div[role='dialog']")
    ].filter((dialog) => isVisible(dialog));

    for (const dialog of dialogs) {
      const buttons = [...dialog.querySelectorAll("button, [role='button'], [role='link'], a, span")];
      const match = buttons.find((btn) => {
        if (!isVisible(btn)) return false;
        const signal = getUnsubscribeSignal(btn);
        if (!signal || signal.includes("unsubscribe")) return false;
        return (
          signal.includes("done") ||
          signal.includes("ok") ||
          signal.includes("got it") ||
          signal.includes("close") ||
          signal.includes("dismiss") ||
          signal.includes("cancel")
        );
      });
      if (match) return match;
    }

    return null;
  }

  async function dismissUnsubscribeDialogs(maxRounds = 3) {
    for (let i = 0; i < maxRounds; i += 1) {
      const confirm = findUnsubscribeConfirmButton();
      if (confirm) {
        robustClick(confirm);
        await sleep(120);
        continue;
      }

      const dismiss = findUnsubscribeFollowupDismissButton();
      if (dismiss) {
        robustClick(dismiss);
        await sleep(120);
        continue;
      }

      break;
    }
  }

  async function waitForUnsubscribeConfirm(timeout = 5000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const btn = findUnsubscribeConfirmButton();
      if (btn) return btn;
      await sleep(150);
    }
    return null;
  }

  function hasVisibleUnsubscribeDialog() {
    return Boolean(findUnsubscribeConfirmButton() || findUnsubscribeFollowupDismissButton());
  }

  async function waitForUnsubscribeDialogToClear(timeout = 1800) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (!hasVisibleUnsubscribeDialog()) return true;
      await sleep(100);
    }
    return !hasVisibleUnsubscribeDialog();
  }

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
    if (el.matches("[role='link'], [role='button']")) {
      el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
      el.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", bubbles: true, cancelable: true }));
    }
  }

  function isVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  }

  function getMailboxToolbar() {
    return (
      document.querySelector("div.Cq.aqL[gh='mtb']") ||
      document.querySelector("div[gh='mtb']") ||
      null
    );
  }

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

  async function actionSelectLikeOpen(options = {}) {
    const manageWorking = !options.skipWorking;
    if (manageWorking) setWorking(true);
    try {
      setLog("Finding sender from open email...");
      const sender = findOpenEmailSender();
      if (!sender) {
        throw new Error("Open an email first so I can detect its sender.");
      }

      await gotoInboxListView();
      setLog(`Searching ${sender}...`);
      const query = await searchBySender(sender);
      state.lockedSender = normalizeEmail(sender);
      state.lockedQuery = normalizeQuery(query);
      setLog("Search ready.");
      showToast("Search complete");
    } catch (error) {
      setLog(error.message || "Could not select similar emails.");
    } finally {
      if (manageWorking) setWorking(false);
    }
  }

  async function ensureQueryReady() {
    if (!state.lockedQuery || !state.lockedSender) {
      throw new Error(`Run '${LABELS.SELECT_LIKE_OPEN_EMAIL}' first so archive is locked to that sender.`);
    }

    await ensureSearchContext(state.lockedQuery);
    validateLockedArchiveContext();
  }

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
      flashSuccess("Archived");
      showToast("Archive complete");
    } catch (error) {
      setLog(error.message || "Archive failed.");
    } finally {
      if (manageWorking) setWorking(false);
    }
  }

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
          showToast("Execution stopped");
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
        await sleep(2000);

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
            flashSuccess("Archived");
            showToast("Archive complete");
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
      flashSuccess("Archived");
      showToast("Archive complete");
    } catch (error) {
      setLog(error.message || "Recursive archive failed.");
    } finally {
      if (manageWorking) setWorking(false);
    }
  }

  async function actionUnsubscribe(options = {}) {
    const manageWorking = !options.skipWorking;
    if (manageWorking) setWorking(true);
    try {
      setLog("Looking for unsubscribe in open email...");
      const sender = findOpenEmailSender();
      const alreadyUnsubscribedNotice = findAlreadyUnsubscribedNotice(sender);
      if (alreadyUnsubscribedNotice) {
        setLog(`Already unsubscribed from ${sender}.`);
        showToast(`Already unsubscribed: ${sender}`);
        return;
      }
      const result = await clickUnsubscribeInOpenEmail();
      await dismissUnsubscribeDialogs();
      setLog(result);
      showToast("Unsubscribe complete");
    } catch (error) {
      const message = error.message || "Unsubscribe failed.";
      if (message.includes("No unsubscribe button/link found")) {
        const proceed = await askProceedConfirmation(
          "No unsubscribe button/link found in this email. Proceed with remaining selected actions?"
        );
        if (proceed) {
          setLog("No unsubscribe button found. Proceeding to next action.");
          showToast("Proceeding without unsubscribe");
          return;
        }

        setLog("Execution stopped by user (unsubscribe confirmation).");
        if (state.batchExecuting) {
          state.stopExecutionRequested = true;
          showToast("Execution stopped");
        }
        return;
      }
      setLog(message);
    } finally {
      if (manageWorking) setWorking(false);
    }
  }

  async function actionGoInbox(options = {}) {
    const manageWorking = !options.skipWorking;
    if (manageWorking) setWorking(true);
    try {
      window.location.hash = "#inbox";
      await waitForSelector("tr.zA", 8000);
      state.query = "";
      state.lockedQuery = "";
      state.lockedSender = "";
      state.selectedConversationsText = "";
      setLog("Moved to Inbox. Search context reset.");
      showToast("Moved to Inbox");
    } catch (_) {
      setLog("Moved to Inbox.");
      showToast("Moved to Inbox");
    } finally {
      if (manageWorking) setWorking(false);
    }
  }

  function mountSidebar() {
    if (document.getElementById("gc-root") && document.getElementById("gc-toggle")) {
      syncExtensionVisibilityFromStorage();
      return;
    }

    const toggle = document.createElement("button");
    toggle.id = "gc-toggle";
    toggle.type = "button";
    toggle.textContent = "Cleaner";
    document.body.appendChild(toggle);

    const root = document.createElement("aside");
    root.id = "gc-root";
    root.classList.add("gc-hidden");
    root.innerHTML = `
      <div id="gc-header">
        <p id="gc-title">Gmail Unsubscriber Ondevice</p>
        <p id="gc-subtitle">Use Gmail-native actions</p>
      </div>
      <div id="gc-working" aria-live="polite" aria-hidden="true">
        <span class="gc-working-spinner" aria-hidden="true"></span>
        <span class="gc-working-text">Working...</span>
      </div>
      <div id="gc-body">
        <div class="gc-section gc-section-prepare">
          <p class="gc-section-title">Prepare</p>
          <div class="gc-action-row">
            <input class="gc-action-checkbox" type="checkbox" data-action-id="${ACTION_BUTTON_IDS.UNSUBSCRIBE}" aria-label="Select ${escapeHtml(LABELS.UNSUBSCRIBE_OPEN_EMAIL)}" />
            <button class="gc-btn" id="${ACTION_BUTTON_IDS.UNSUBSCRIBE}">${escapeHtml(LABELS.UNSUBSCRIBE_OPEN_EMAIL)}</button>
          </div>
          <div class="gc-action-row">
            <input class="gc-action-checkbox" type="checkbox" data-action-id="${ACTION_BUTTON_IDS.SELECT_LIKE_OPEN}" aria-label="Select ${escapeHtml(LABELS.SELECT_LIKE_OPEN_EMAIL)}" />
            <button class="gc-btn" id="${ACTION_BUTTON_IDS.SELECT_LIKE_OPEN}">${escapeHtml(LABELS.SELECT_LIKE_OPEN_EMAIL)}</button>
          </div>
        </div>
        <div class="gc-section gc-section-archive">
          <p class="gc-section-title">Archive</p>
          <div class="gc-action-row">
            <input class="gc-action-checkbox" type="checkbox" data-action-id="${ACTION_BUTTON_IDS.ARCHIVE_THIS_PAGE}" aria-label="Select ${escapeHtml(LABELS.ARCHIVE_THIS_PAGE)}" />
            <button class="gc-btn" id="${ACTION_BUTTON_IDS.ARCHIVE_THIS_PAGE}">${escapeHtml(LABELS.ARCHIVE_THIS_PAGE)}</button>
          </div>
          <div class="gc-action-row">
            <input class="gc-action-checkbox" type="checkbox" data-action-id="${ACTION_BUTTON_IDS.ARCHIVE_ALL_PAGES}" aria-label="Select ${escapeHtml(LABELS.ARCHIVE_ALL_PAGES)}" />
            <button class="gc-btn" id="${ACTION_BUTTON_IDS.ARCHIVE_ALL_PAGES}">${escapeHtml(LABELS.ARCHIVE_ALL_PAGES)}</button>
          </div>
        </div>
        <div class="gc-section gc-section-inbox">
          <p class="gc-section-title">Inbox</p>
          <div class="gc-action-row">
            <input class="gc-action-checkbox" type="checkbox" data-action-id="${ACTION_BUTTON_IDS.GO_TO_INBOX}" aria-label="Select ${escapeHtml(LABELS.GO_TO_INBOX)}" />
            <button class="gc-btn" id="${ACTION_BUTTON_IDS.GO_TO_INBOX}">${escapeHtml(LABELS.GO_TO_INBOX)}</button>
          </div>
        </div>
        <button class="gc-btn gc-btn-execute" id="gc-execute-selected" data-ready="false" disabled>Execute Selected</button>
        <button class="gc-btn gc-btn-stop" id="gc-stop-execution" disabled>Stop Execution</button>
      </div>
      <div id="gc-confirm" role="alert" aria-live="assertive">
        <p id="gc-confirm-message"></p>
        <div id="gc-confirm-actions">
          <button type="button" id="gc-confirm-proceed">Proceed</button>
          <button type="button" id="gc-confirm-stop">Stop</button>
        </div>
      </div>
      <div id="gc-success" aria-live="polite">
        <span class="gc-success-icon" aria-hidden="true">✓</span>
        <span class="gc-success-text">Completed</span>
      </div>
      <div id="gc-log">Ready.</div>
      <div id="gc-toast" role="status" aria-live="polite"></div>
    `;

    document.body.appendChild(root);

    toggle.addEventListener("click", () => {
      root.classList.toggle("gc-hidden");
    });

    Object.values(ACTION_BUTTON_IDS).forEach((buttonId) => {
      document.getElementById(buttonId)?.addEventListener("click", () => {
        const label = document.getElementById(buttonId)?.textContent?.trim() || "Action";
        void runWithElapsedToast(label, async () => {
          await runActionByButtonId(buttonId);
        });
      });
    });

    document.querySelectorAll(".gc-action-checkbox").forEach((checkbox) => {
      checkbox.addEventListener("change", updateExecuteSelectedState);
    });
    document.getElementById("gc-execute-selected")?.addEventListener("click", () => {
      void runWithElapsedToast("Execute Selected", async () => {
        await executeSelectedActions();
      });
    });
    document.getElementById("gc-stop-execution")?.addEventListener("click", () => {
      void runWithElapsedToast("Stop Execution", async () => {
        requestStopExecution();
      });
    });
    document.getElementById("gc-confirm-proceed")?.addEventListener("click", () => {
      resolveProceedConfirmation(true);
    });
    document.getElementById("gc-confirm-stop")?.addEventListener("click", () => {
      resolveProceedConfirmation(false);
    });
    updateExecuteSelectedState();

    setLog(`Ready. Open an email, then click '${LABELS.SELECT_LIKE_OPEN_EMAIL}'.`);
    syncExtensionVisibilityFromStorage();
  }

  function boot() {
    if (!document.body) return;
    mountSidebar();
    loadShortcutConfig();
  }

  boot();

  let lastHref = location.href;
  const observer = new MutationObserver(() => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      mountSidebar();
    } else if (!document.getElementById("gc-root") || !document.getElementById("gc-toggle")) {
      mountSidebar();
    }
  });

  observer.observe(document.documentElement || document.body, {
    childList: true,
    subtree: true
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    if (changes[SHOW_EXTENSION_KEY]) {
      setExtensionVisibility(changes[SHOW_EXTENSION_KEY].newValue !== false);
    }
    if (changes[EXECUTE_SELECTED_SHORTCUT_KEY]) {
      state.shortcut = normalizeShortcutConfig(changes[EXECUTE_SELECTED_SHORTCUT_KEY].newValue);
    }
  });

  window.addEventListener("hashchange", mountSidebar);
  document.addEventListener("keydown", onGlobalKeydown, true);
})();
