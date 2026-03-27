(() => {
  if (window.__gmailCleanerLoaded) return;
  window.__gmailCleanerLoaded = true;

  const state = {
    openSender: "",
    query: "",
    lockedSender: "",
    lockedQuery: "",
    selectedConversationsText: "",
    cachedNextEmailUrl: "",
    cachedNextEmailSender: "",
    cachedNextEmailSubject: "",
    cachedNextEmailDate: "",
    cachedNextEmailThreadId: "",
    cachedNextEmailThreadToken: "",
    cachedNextEmailPageOffset: 0,
    cachedNextEmailListHash: "",
    cachedNextEmailSourceUrl: "",
    maxScanPages: 1,
    shortcut: null,
    working: false,
    batchExecuting: false,
    stopExecutionRequested: false,
    extensionContextInvalidated: false
  };
  const LABELS = {
    UNSUBSCRIBE_OPEN_EMAIL: "Unsubscribe Open Email",
    SELECT_LIKE_OPEN_EMAIL: "Select All Emails Like Open Email",
    ARCHIVE_THIS_PAGE: "Archive Listed Emails in This Page",
    ARCHIVE_ALL_PAGES: "Archive Listed Emails in All Pages",
    GO_TO_INBOX: "Go to Inbox",
    GO_TO_NEXT_PAGE: "Go to Next Email"
  };
  const ACTION_BUTTON_IDS = {
    UNSUBSCRIBE: "gc-unsub",
    SELECT_LIKE_OPEN: "gc-like-open",
    ARCHIVE_THIS_PAGE: "gc-archive",
    ARCHIVE_ALL_PAGES: "gc-archive-rec",
    GO_TO_INBOX: "gc-inbox",
    GO_TO_NEXT_PAGE: "gc-next-page"
  };
  const SHOW_EXTENSION_KEY = "showExtensionEnabled";
  const EXECUTE_SELECTED_SHORTCUT_KEY = "executeSelectedShortcut";
  const ACTION_CHECKBOX_STATE_KEY = "actionCheckboxState";
  const NEXT_SCAN_PAGE_LIMIT_KEY = "nextScanPageLimit";
  const NEXT_EMAIL_TARGET_CACHE_KEY = "nextEmailTargetCache";
  const DEFAULT_SCAN_PAGE_LIMIT = 1;
  const MIN_SCAN_PAGE_LIMIT = 1;
  const MAX_SCAN_PAGE_LIMIT = 200;
  const DEFAULT_SHORTCUT = {
    enabled: true,
    key: "E",
    alt: true,
    shift: true,
    ctrl: false,
    meta: false
  };
  state.shortcut = { ...DEFAULT_SHORTCUT };
  state.maxScanPages = DEFAULT_SCAN_PAGE_LIMIT;

  /** Handles sleep. */
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
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

  /** Waits for selector. */
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

  /** Sets log. */
  function setLog(msg) {
    console.log(`[GmailCleaner] ${msg}`);
  }

  /** Returns cached next email payload. */
  function getCachedNextEmailPayload() {
    return {
      url: state.cachedNextEmailUrl || "",
      sender: state.cachedNextEmailSender || "",
      subject: state.cachedNextEmailSubject || "",
      date: state.cachedNextEmailDate || "",
      threadId: state.cachedNextEmailThreadId || "",
      threadToken: state.cachedNextEmailThreadToken || "",
      pageOffset: Number.isFinite(state.cachedNextEmailPageOffset) ? state.cachedNextEmailPageOffset : 0,
      listHash: state.cachedNextEmailListHash || "",
      sourceUrl: state.cachedNextEmailSourceUrl || "",
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

    if (!state.cachedNextEmailUrl) {
      summaryEl.textContent = "Not cached yet.";
      if (urlEl) urlEl.textContent = "Not cached yet.";
      if (senderEl) senderEl.textContent = "-";
      if (subjectEl) subjectEl.textContent = "-";
      if (dateEl) dateEl.textContent = "-";
      if (threadIdEl) threadIdEl.textContent = "-";
      if (threadTokenEl) threadTokenEl.textContent = "-";
      if (pageOffsetEl) pageOffsetEl.textContent = "0";
      if (listHashEl) listHashEl.textContent = "-";
      return;
    }

    const summaryParts = [
      state.cachedNextEmailSender || "",
      state.cachedNextEmailSubject || "",
      state.cachedNextEmailDate || ""
    ].filter(Boolean);
    summaryEl.textContent = summaryParts.join(" | ") || "Cached target ready";
    if (urlEl) urlEl.textContent = state.cachedNextEmailUrl;
    if (senderEl) senderEl.textContent = state.cachedNextEmailSender || "-";
    if (subjectEl) subjectEl.textContent = state.cachedNextEmailSubject || "-";
    if (dateEl) dateEl.textContent = state.cachedNextEmailDate || "-";
    if (threadIdEl) threadIdEl.textContent = state.cachedNextEmailThreadId || "-";
    if (threadTokenEl) threadTokenEl.textContent = state.cachedNextEmailThreadToken || "-";
    if (pageOffsetEl) pageOffsetEl.textContent = String(state.cachedNextEmailPageOffset || 0);
    if (listHashEl) listHashEl.textContent = state.cachedNextEmailListHash || "-";
  }

  /** Persists cached next email target. */
  function persistCachedNextEmailTarget() {
    safeStorageSet({ [NEXT_EMAIL_TARGET_CACHE_KEY]: getCachedNextEmailPayload() });
    renderNextEmailTargetSection();
  }

  /** Clears cached next email target. */
  function clearCachedNextEmailTarget() {
    state.cachedNextEmailUrl = "";
    state.cachedNextEmailSender = "";
    state.cachedNextEmailSubject = "";
    state.cachedNextEmailDate = "";
    state.cachedNextEmailThreadId = "";
    state.cachedNextEmailThreadToken = "";
    state.cachedNextEmailPageOffset = 0;
    state.cachedNextEmailListHash = "";
    state.cachedNextEmailSourceUrl = "";
    persistCachedNextEmailTarget();
  }

  /** Checks whether cached target valid for current context. */
  function isCachedTargetValidForCurrentContext(cachedPayload) {
    const url = String(cachedPayload?.url || "").trim();
    if (!url) return false;
    const sourceUrl = normalizeComparableUrl(cachedPayload?.sourceUrl || "");
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
        state.cachedNextEmailUrl = "";
        state.cachedNextEmailSender = "";
        state.cachedNextEmailSubject = "";
        state.cachedNextEmailDate = "";
        state.cachedNextEmailThreadId = "";
        state.cachedNextEmailThreadToken = "";
        state.cachedNextEmailPageOffset = 0;
        state.cachedNextEmailListHash = "";
        state.cachedNextEmailSourceUrl = "";
        renderNextEmailTargetSection();
        return;
      }
      state.cachedNextEmailUrl = String(cached.url || "");
      state.cachedNextEmailSender = normalizeEmail(cached.sender || "");
      state.cachedNextEmailSubject = String(cached.subject || "").trim();
      state.cachedNextEmailDate = String(cached.date || "").trim();
      state.cachedNextEmailThreadId = normalizeFingerprintText(cached.threadId || "");
      state.cachedNextEmailThreadToken = normalizeFingerprintText(cached.threadToken || "");
      state.cachedNextEmailPageOffset = Math.max(
        0,
        Number.parseInt(String(cached.pageOffset ?? ""), 10) || 0
      );
      state.cachedNextEmailListHash = String(cached.listHash || "").trim().toLowerCase();
      state.cachedNextEmailSourceUrl = normalizeComparableUrl(cached.sourceUrl || "");
      renderNextEmailTargetSection();
    });
  }

  /** Handles announce email target status. */
  function announceEmailTargetStatus(prefix = "Email target status") {
    renderNextEmailTargetSection();
    if (state.cachedNextEmailUrl) {
      const parts = [
        state.cachedNextEmailUrl,
        state.cachedNextEmailSender || "",
        state.cachedNextEmailSubject || "",
        state.cachedNextEmailDate || ""
      ].filter(Boolean);
      setLog(`${prefix}: ${parts.join(" | ")}`);
      return;
    }
    setLog(`${prefix}: none`);
  }

  /** Handles flash success. */
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
      showToast(`${label}: ${formatElapsedMs(elapsed)} elapsed`);
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
    setProceedButtonLabel("Proceed");
  }

  /** Starts auto proceed countdown. */
  function startProceedAutoCountdown(seconds = AUTO_PROCEED_SECONDS) {
    stopProceedAutoCountdown();
    let remainingSeconds = Math.max(1, Number.parseInt(String(seconds ?? ""), 10) || AUTO_PROCEED_SECONDS);
    setProceedButtonLabel(`Proceed (${remainingSeconds})`);
    proceedAutoCountdownTimer = setInterval(() => {
      remainingSeconds -= 1;
      if (remainingSeconds <= 0) {
        stopProceedAutoCountdown();
        if (proceedConfirmationResolver) {
          resolveProceedConfirmation(true);
        }
        return;
      }
      setProceedButtonLabel(`Proceed (${remainingSeconds})`);
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

  /** Normalizes shortcut config. */
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

  /** Normalizes scan page limit. */
  function normalizeScanPageLimit(raw) {
    const parsed = Number.parseInt(String(raw ?? ""), 10);
    if (!Number.isFinite(parsed)) return DEFAULT_SCAN_PAGE_LIMIT;
    return Math.min(MAX_SCAN_PAGE_LIMIT, Math.max(MIN_SCAN_PAGE_LIMIT, parsed));
  }

  /** Migrates legacy scan page limit. */
  function migrateLegacyScanPageLimit(raw) {
    const normalized = normalizeScanPageLimit(raw);
    if (Number(raw) === 25) {
      safeStorageSet({ [NEXT_SCAN_PAGE_LIMIT_KEY]: DEFAULT_SCAN_PAGE_LIMIT });
      return DEFAULT_SCAN_PAGE_LIMIT;
    }
    return normalized;
  }

  /** Loads shortcut config. */
  function loadShortcutConfig() {
    safeStorageGet([EXECUTE_SELECTED_SHORTCUT_KEY], (result) => {
      state.shortcut = normalizeShortcutConfig(result[EXECUTE_SELECTED_SHORTCUT_KEY]);
    });
  }

  /** Loads scan page limit. */
  function loadScanPageLimit() {
    safeStorageGet([NEXT_SCAN_PAGE_LIMIT_KEY], (result) => {
      state.maxScanPages = migrateLegacyScanPageLimit(result[NEXT_SCAN_PAGE_LIMIT_KEY]);
    });
  }

  /** Checks whether editable target. */
  function isEditableTarget(target) {
    if (!target) return false;
    const tag = (target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return true;
    if (target.isContentEditable) return true;
    return Boolean(target.closest?.("[contenteditable='true']"));
  }

  /** Handles matches shortcut. */
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

  /** Handles on global keydown. */
  function onGlobalKeydown(event) {
    if (!event.isTrusted) return;
    if (isEditableTarget(event.target)) return;
    if (state.working || state.batchExecuting) return;

    if (!matchesShortcut(event)) return;

    event.preventDefault();
    event.stopPropagation();
    void runWithElapsedToast("Execute Selected", async () => {
      await executeSelectedActions();
    });
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
      const saved = result[ACTION_CHECKBOX_STATE_KEY];
      if (!saved || typeof saved !== "object") return;

      document.querySelectorAll(".gc-action-checkbox").forEach((checkbox) => {
        const actionId = checkbox.getAttribute("data-action-id") || "";
        if (!actionId) return;
        checkbox.checked = saved[actionId] === true;
      });
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
    if (!cached || !state.cachedNextEmailUrl) {
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
        showToast("Execution stopped");
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
    const main = document.querySelector("div[role='main']");
    if (!main) return null;
    const hasOpenThread = !!main.querySelector("h2.hP, h2[data-thread-perm-id]");
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

    const openSender =
      threadRoot.querySelector("h3.iw span[email]")?.getAttribute("email") ||
      threadRoot.querySelector("h3.iw .gD[email]")?.getAttribute("email") ||
      threadRoot.querySelector("h3.iw span[email][name]")?.getAttribute("email") ||
      "";

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
      ...document.querySelectorAll("tr[role='row'][jscontroller='ZdOxDb'], tr.zA")
    ];

    const uniqueRows = [...new Set(candidates)];
    return uniqueRows.filter((row) => {
      if (!isVisible(row)) return false;
      const main = row.closest("div[role='main']");
      if (!main || !isVisible(main)) return false;
      const tabPanel = row.closest("div[role='tabpanel']");
      if (tabPanel && !isVisible(tabPanel)) return false;
      const hasSender = !!row.querySelector("span[email], span.yP[email]");
      const hasSubjectOrPreview = !!row.querySelector("span.bog, span.bqe, span.y2, td.xW span");
      return hasSender && hasSubjectOrPreview;
    });
  }

  /** Waits for thread rows. */
  async function waitForThreadRows(timeout = 12000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (shouldStopExecution()) return [];
      const rows = getThreadRows();
      if (rows.length > 0) return rows;
      await sleep(140);
    }
    return [];
  }

  /** Handles row to item. */
  function rowToItem(row) {
    const sender =
      row.querySelector("span[email]")?.getAttribute("email") ||
      row.querySelector("span[email]")?.textContent?.trim() ||
      "Unknown sender";
    const subject = row.querySelector("span.bog")?.textContent?.trim() || "(No subject)";
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
    return (
      document.querySelector("input[name='q']") ||
      document.querySelector("input[aria-label='Search mail']") ||
      null
    );
  }

  /** Returns current search query. */
  function getCurrentSearchQuery() {
    const input = getCurrentSearchInput();
    return normalizeQuery(input?.value || "");
  }

  /** Returns refinement query. */
  function getRefinementQuery() {
    const chips = [...document.querySelectorAll("div.Ii[data-query]")].filter((el) => isVisible(el));
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
      ...document.querySelectorAll("div.bX div.c5.J-J5-Ji, div.bX div.dp div.dr div.Cz.J-J5-Ji.e")
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
      .map((row) => normalizeEmail(row.querySelector("span[email]")?.getAttribute("email") || ""))
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

  /** Navigates inbox list view. */
  async function gotoInboxListView() {
    const inThread = !!document.querySelector("div[role='main'] h2.hP, div[role='main'] h2[data-thread-perm-id]");
    if (inThread) {
      window.location.hash = "#inbox";
      await sleep(1000);
      await waitForThreadRows(6000);
    }
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

    await waitForThreadRows(12000);
    await sleep(500);
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
    return (
      toolbar.querySelector("span.T-Jo.J-J5-Ji.T-Jo-auq.T-Jo-iAfbIe[role='checkbox']") ||
      toolbar.querySelector("span.T-Jo.J-J5-Ji.T-Jo-auq[role='checkbox']") ||
      toolbar.querySelector("span.T-Jo.J-J5-Ji[role='checkbox']") ||
      null
    );
  }

  /** Finds select button. */
  function findSelectButton(toolbar) {
    return [...toolbar.querySelectorAll("div[role='button'], span[role='button'], button")].find((el) => {
      const aria = (el.getAttribute("aria-label") || "").toLowerCase();
      const tooltip = (el.getAttribute("data-tooltip") || "").toLowerCase();
      return isVisible(el) && (aria === "select" || tooltip === "select");
    });
  }

  /** Finds all menu item. */
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
    return [...document.querySelectorAll(".J-M[role='menu']")].find((el) => isVisible(el)) || null;
  }

  /** Clicks all menu item. */
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
      await sleep(260);
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

  /** Handles select all matching search. */
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
    void getSelectionDebugState;

    const selected = await ensureMasterChecked(toolbar, 8);
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
    }

    const selectedAfterFallback = isMasterChecked(toolbar) || await ensureMasterChecked(toolbar, 5);
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

  /** Checks whether has any selected conversation row. */
  function hasAnySelectedConversationRow() {
    const rows = getThreadRows();
    if (!rows.length) return false;

    return rows.some((row) => {
      if ((row.getAttribute("aria-selected") || "").toLowerCase() === "true") return true;
      const rowCheckbox = row.querySelector("[role='checkbox']");
      return (rowCheckbox?.getAttribute("aria-checked") || "").toLowerCase() === "true";
    });
  }

  /** Waits for selection to settle. */
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

  /** Archives selected. */
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

  /** Returns first row fingerprint. */
  function getFirstRowFingerprint() {
    const row = getThreadRows()[0];
    if (!row) return "";
    const threadId =
      row.getAttribute("data-legacy-thread-id") ||
      row.querySelector("[data-legacy-thread-id]")?.getAttribute("data-legacy-thread-id") ||
      "";
    const sender = row.querySelector("span[email]")?.getAttribute("email") || "";
    const subject = row.querySelector("span.bog")?.textContent?.trim() || "";
    return `${threadId}|${sender}|${subject}`;
  }

  /** Waits for page change. */
  async function waitForPageChange(previousFingerprint, timeout = 12000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (shouldStopExecution()) return false;
      const currentFingerprint = getFirstRowFingerprint();
      const rows = getThreadRows();
      if (rows.length === 0) return true;
      if (currentFingerprint && currentFingerprint !== previousFingerprint) return true;
      await sleep(250);
    }
    return false;
  }

  /** Navigates next results page. */
  async function goToNextResultsPage() {
    if (shouldStopExecution()) return false;
    const nextButton = findNextPageButton();
    if (!nextButton) return false;
    const before = getFirstRowFingerprint();
    robustClick(nextButton);
    await sleep(500);
    if (shouldStopExecution()) return false;
    const moved = await waitForPageChange(before, 12000);
    if (moved) {
      await waitForSelector("div[gh='mtb'], tr.zA", 12000);
      await sleep(350);
    }
    return moved;
  }

  /** Returns row sender email. */
  function getRowSenderEmail(row) {
    return normalizeEmail(
      row.querySelector("span[email]")?.getAttribute("email") ||
      row.querySelector("span.yP[email]")?.getAttribute("email") ||
      row.querySelector("span.zF[email]")?.getAttribute("email") ||
      row.querySelector("span[email]")?.textContent?.trim() ||
      row.querySelector("span.yP")?.textContent?.trim() ||
      row.querySelector("span.zF")?.textContent?.trim() ||
      ""
    );
  }

  /** Returns thread url from row. */
  function getThreadUrlFromRow(row) {
    const threadId = (
      row.getAttribute("data-legacy-thread-id") ||
      row.querySelector("[data-legacy-thread-id]")?.getAttribute("data-legacy-thread-id") ||
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

    const anchors = [...row.querySelectorAll("a[href]")];
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
      document.querySelector("div[role='main'] h2[data-legacy-thread-id]")?.getAttribute("data-legacy-thread-id") ||
      document.querySelector("div[role='main'] [data-thread-perm-id][data-legacy-thread-id]")?.getAttribute("data-legacy-thread-id") ||
      ""
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
      row.querySelector("[data-legacy-thread-id]")?.getAttribute("data-legacy-thread-id") ||
      ""
    );
  }

  /** Returns open email subject. */
  function getOpenEmailSubject() {
    const threadRoot = getOpenThreadRoot();
    if (!threadRoot) return "";
    return (
      threadRoot.querySelector("h2.hP")?.textContent?.trim() ||
      threadRoot.querySelector("h2[data-thread-perm-id]")?.textContent?.trim() ||
      ""
    );
  }

  /** Returns open email heading. */
  function getOpenEmailHeading() {
    const threadRoot = getOpenThreadRoot();
    if (!threadRoot) return "";
    return (
      threadRoot.querySelector("h3.iw span[email][name]")?.getAttribute("name") ||
      threadRoot.querySelector("h3.iw .gD")?.textContent?.trim() ||
      threadRoot.querySelector("h3.iw span[email]")?.textContent?.trim() ||
      ""
    );
  }

  /** Returns open email date text. */
  function getOpenEmailDateText() {
    const threadRoot = getOpenThreadRoot();
    if (!threadRoot) return "";
    const candidates = [
      ...threadRoot.querySelectorAll("time, span.g3, span[title]")
    ]
      .filter((el) => isVisible(el) && !el.closest("tr.zA, tr[role='row']"))
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
      row.querySelector("span[email][name]")?.getAttribute("name") ||
      row.querySelector("span.yP[name]")?.getAttribute("name") ||
      row.querySelector("span.zF[name]")?.getAttribute("name") ||
      row.querySelector("span[email]")?.textContent?.trim() ||
      row.querySelector("span.yP, span.zF, span.bA4 span")?.textContent?.trim() ||
      ""
    );
  }

  /** Returns row subject text. */
  function getRowSubjectText(row) {
    const subject =
      row.querySelector("span.bog")?.textContent?.trim() ||
      row.querySelector("span.bqe")?.textContent?.trim() ||
      "";
    const preview = row.querySelector("span.y2")?.textContent?.trim() || "";
    return `${subject} ${preview}`.trim();
  }

  /** Returns row date text. */
  function getRowDateText(row) {
    return (
      row.querySelector("td.xW span[title]")?.getAttribute("title") ||
      row.querySelector("td.xW span[aria-label]")?.getAttribute("aria-label") ||
      row.querySelector("td.xW .bq3")?.textContent?.trim() ||
      row.querySelector("td.xW span")?.textContent?.trim() ||
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
    const cachedSourceUrl = normalizeComparableUrl(state.cachedNextEmailSourceUrl || "");
    const cachedSender = normalizeEmail(state.cachedNextEmailSender || "");
    if (cachedSourceUrl && currentSourceUrl && cachedSourceUrl !== currentSourceUrl) {
      clearCachedNextEmailTarget();
    }
    const cachedMatchesSource = !!(
      state.cachedNextEmailUrl &&
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
      state.cachedNextEmailUrl &&
      state.cachedNextEmailSender &&
      normalizeEmail(state.cachedNextEmailSender) === expectedSender
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
      state.cachedNextEmailSender = normalizeEmail(target.sender || expectedSender || sender || "");
      state.cachedNextEmailSubject = (target.subject || "").trim();
      state.cachedNextEmailDate = (target.date || "").trim();
      state.cachedNextEmailUrl = target.url;
      state.cachedNextEmailThreadId = normalizeFingerprintText(target.threadId || "");
      state.cachedNextEmailThreadToken = normalizeFingerprintText(target.threadToken || "");
      state.cachedNextEmailPageOffset = Math.max(
        0,
        Number.parseInt(String(target.pageOffset ?? ""), 10) || 0
      );
      state.cachedNextEmailListHash = getListContextHashFromHash(target.listHash || "");
      state.cachedNextEmailSourceUrl = currentSourceUrl;
      persistCachedNextEmailTarget();
      const preview = [
        state.cachedNextEmailSender || "unknown sender",
        state.cachedNextEmailSubject || "(no subject)",
        state.cachedNextEmailDate || ""
      ]
        .filter(Boolean)
        .join(" | ");
      setLog(`Next email target cached: ${preview}`);
      announceEmailTargetStatus("Email target after inbox scan");
      showToast("Next email target cached");
      return true;
    } finally {
      if (priorUrl && normalizeComparableUrl(location.href) !== normalizeComparableUrl(priorUrl)) {
        setLog("Returning to current open email...");
        navigateWithinGmail(priorUrl);
        await waitForSelector("div[role='main'] h2.hP, div[role='main'] h2[data-thread-perm-id]", 12000);
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

  /** Finds best unsubscribe target. */
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

  /** Finds unsubscribe confirm button. */
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

  /** Finds unsubscribe followup dismiss button. */
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

  /** Dismisses unsubscribe dialogs. */
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

  /** Waits for unsubscribe confirm. */
  async function waitForUnsubscribeConfirm(timeout = 5000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const btn = findUnsubscribeConfirmButton();
      if (btn) return btn;
      await sleep(150);
    }
    return null;
  }

  /** Checks whether has visible unsubscribe dialog. */
  function hasVisibleUnsubscribeDialog() {
    return Boolean(findUnsubscribeConfirmButton() || findUnsubscribeFollowupDismissButton());
  }

  /** Waits for unsubscribe dialog to clear. */
  async function waitForUnsubscribeDialogToClear(timeout = 1800) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (!hasVisibleUnsubscribeDialog()) return true;
      await sleep(100);
    }
    return !hasVisibleUnsubscribeDialog();
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
    if (el.matches("[role='link'], [role='button']")) {
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
    return (
      document.querySelector("div.Cq.aqL[gh='mtb']") ||
      document.querySelector("div[gh='mtb']") ||
      null
    );
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
      flashSuccess("Archived");
      showToast("Archive complete");
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
      showToast("Moved to Inbox");
    } catch (_) {
      setLog("Moved to Inbox.");
      showToast("Moved to Inbox");
    } finally {
      if (manageWorking) setWorking(false);
    }
  }

  /** Returns row open control. */
  function getRowOpenControl(row) {
    return (
      row.querySelector("span.bog") ||
      row.querySelector("td.xY a[href*='#']") ||
      row.querySelector("a[href*='#']") ||
      row
    );
  }

  /** Finds cached target row index. */
  function findCachedTargetRowIndex(rows) {
    const targetThreadId = normalizeFingerprintText(state.cachedNextEmailThreadId || "");
    const targetThreadToken = normalizeFingerprintText(state.cachedNextEmailThreadToken || "");
    const targetUrl = normalizeComparableUrl(state.cachedNextEmailUrl || "");
    const targetSender = normalizeEmail(state.cachedNextEmailSender || "");
    const targetSubject = normalizeSubjectForMatch(state.cachedNextEmailSubject || "");
    const targetDate = parseDateSignature(state.cachedNextEmailDate || "");

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
    const listHash = getListContextHashFromHash(state.cachedNextEmailListHash || "");
    if (listHash) {
      navigateWithinGmail(listHash);
      await waitForThreadRows(12000);
      await sleep(200);
    } else {
      await navigateToDiscoveryListContext(state.cachedNextEmailSender || "");
    }

    const pageOffset = Math.max(0, Number.parseInt(String(state.cachedNextEmailPageOffset ?? ""), 10) || 0);
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
    const openThread = await waitForSelector(
      "div[role='main'] h2.hP, div[role='main'] h2[data-thread-perm-id]",
      12000
    );
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
      const cached = !!state.cachedNextEmailUrl;
      if (cached) {
        setLog("Load Next Email [2/8]: Cached target found.");
      } else {
        setLog("Load Next Email [2/8]: No cached target present.");
      }
      setLog("Load Next Email [3/8]: Checking stop-request flag...");
      if (shouldStopExecution()) {
        setLog("Load Next Email [3/8]: Stop requested. Aborting.");
        showToast("Execution stopped");
        return;
      }
      setLog("Load Next Email [4/8]: Validating target URL...");
      if (!cached || !state.cachedNextEmailUrl) {
        setLog("Load Next Email [4/8]: No cached email target found. Run Unsubscribe Open Email first.");
        announceEmailTargetStatus("Email target before open");
        showToast("No cached email target");
        return;
      }

      const targetUrl = state.cachedNextEmailUrl;
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
        showToast("Opened next email");
        return;
      }
      setLog("Load Next Email [7/8]: List-row open failed. Falling back to direct URL...");
      targetLogTimer = setInterval(() => {
        setLog(targetMessage);
      }, 450);
      navigateWithinGmail(targetUrl);
      setLog("Load Next Email [8/8]: Waiting for next email view to load...");
      await waitForSelector("div[role='main'] h2.hP, div[role='main'] h2[data-thread-perm-id]", 12000);
      stopTargetLogTimer();
      setLog("Load Next Email: Completed via URL fallback.");
      showToast("Opened next email");
    } catch (error) {
      stopTargetLogTimer();
      setLog(`Load Next Email failed: ${error.message || "Go to next page failed."}`);
    } finally {
      stopTargetLogTimer();
      if (manageWorking) setWorking(false);
    }
  }

  /** Mounts sidebar. */
  function mountSidebar() {
    if (state.extensionContextInvalidated) return;
    if (document.getElementById("gc-root") && document.getElementById("gc-toggle")) {
      renderNextEmailTargetSection();
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
          <div class="gc-action-row">
            <input class="gc-action-checkbox" type="checkbox" data-action-id="${ACTION_BUTTON_IDS.GO_TO_NEXT_PAGE}" aria-label="Select ${escapeHtml(LABELS.GO_TO_NEXT_PAGE)}" />
            <button class="gc-btn" id="${ACTION_BUTTON_IDS.GO_TO_NEXT_PAGE}">${escapeHtml(LABELS.GO_TO_NEXT_PAGE)}</button>
          </div>
        </div>
        <div id="gc-next-target-section" class="gc-section gc-hidden">
          <details id="gc-next-target-accordion">
            <summary id="gc-next-target-summary-text" class="gc-next-target-summary">Not cached yet.</summary>
            <div class="gc-next-target-grid">
              <div class="gc-next-target-label">URL</div>
              <div id="gc-next-target-url" class="gc-next-target-value">Not cached yet.</div>
              <div class="gc-next-target-label">Sender</div>
              <div id="gc-next-target-sender" class="gc-next-target-value">-</div>
              <div class="gc-next-target-label">Subject</div>
              <div id="gc-next-target-subject" class="gc-next-target-value">-</div>
              <div class="gc-next-target-label">Date</div>
              <div id="gc-next-target-date" class="gc-next-target-value">-</div>
              <div class="gc-next-target-label">Thread ID</div>
              <div id="gc-next-target-thread-id" class="gc-next-target-value">-</div>
              <div class="gc-next-target-label">Thread Token</div>
              <div id="gc-next-target-thread-token" class="gc-next-target-value">-</div>
              <div class="gc-next-target-label">Page Offset</div>
              <div id="gc-next-target-page-offset" class="gc-next-target-value">0</div>
              <div class="gc-next-target-label">List Context</div>
              <div id="gc-next-target-list-hash" class="gc-next-target-value">-</div>
            </div>
          </details>
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
      checkbox.addEventListener("change", () => {
        renderNextEmailTargetSection();
        updateExecuteSelectedState();
        persistActionCheckboxState();
      });
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
    restoreActionCheckboxState();
    renderNextEmailTargetSection();
    updateExecuteSelectedState();

    setLog(`Ready. Open an email, then click '${LABELS.SELECT_LIKE_OPEN_EMAIL}'.`);
    syncExtensionVisibilityFromStorage();
  }

  /** Bootstraps startup. */
  function boot() {
    if (!document.body) return;
    mountSidebar();
    loadCachedNextEmailTarget();
    loadShortcutConfig();
    loadScanPageLimit();
  }

  boot();

  let lastHref = location.href;
  const observer = new MutationObserver(() => {
    if (state.extensionContextInvalidated) return;
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

  /** Handles on storage changed. */
  const onStorageChanged = (changes, areaName) => {
    if (state.extensionContextInvalidated) return;
    if (areaName !== "local") return;
    if (changes[SHOW_EXTENSION_KEY]) {
      setExtensionVisibility(changes[SHOW_EXTENSION_KEY].newValue !== false);
    }
    if (changes[EXECUTE_SELECTED_SHORTCUT_KEY]) {
      state.shortcut = normalizeShortcutConfig(changes[EXECUTE_SELECTED_SHORTCUT_KEY].newValue);
    }
    if (changes[NEXT_SCAN_PAGE_LIMIT_KEY]) {
      state.maxScanPages = normalizeScanPageLimit(changes[NEXT_SCAN_PAGE_LIMIT_KEY].newValue);
    }
    if (changes[NEXT_EMAIL_TARGET_CACHE_KEY]) {
      const cached = changes[NEXT_EMAIL_TARGET_CACHE_KEY].newValue || {};
      if (!isCachedTargetValidForCurrentContext(cached)) {
        state.cachedNextEmailUrl = "";
        state.cachedNextEmailSender = "";
        state.cachedNextEmailSubject = "";
        state.cachedNextEmailDate = "";
        state.cachedNextEmailThreadId = "";
        state.cachedNextEmailThreadToken = "";
        state.cachedNextEmailPageOffset = 0;
        state.cachedNextEmailListHash = "";
        state.cachedNextEmailSourceUrl = "";
        renderNextEmailTargetSection();
        return;
      }
      state.cachedNextEmailUrl = String(cached.url || "");
      state.cachedNextEmailSender = normalizeEmail(cached.sender || "");
      state.cachedNextEmailSubject = String(cached.subject || "").trim();
      state.cachedNextEmailDate = String(cached.date || "").trim();
      state.cachedNextEmailThreadId = normalizeFingerprintText(cached.threadId || "");
      state.cachedNextEmailThreadToken = normalizeFingerprintText(cached.threadToken || "");
      state.cachedNextEmailPageOffset = Math.max(
        0,
        Number.parseInt(String(cached.pageOffset ?? ""), 10) || 0
      );
      state.cachedNextEmailListHash = String(cached.listHash || "").trim().toLowerCase();
      state.cachedNextEmailSourceUrl = normalizeComparableUrl(cached.sourceUrl || "");
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
  document.addEventListener("keydown", onGlobalKeydown, true);
})();
