// Gmail search box, sender search and archive safety checks.
(() => {
  const GC = window.__gc;
  if (!GC || GC.skipLoad) return;

  const { LABELS, SELECTORS, STRINGS, extractSenderFromQuery, findOpenEmailSender, firstAttr, getThreadRows,
    isVisible, normalizeEmail, normalizeQuery, queryFirst, senderSignalMatchesExpected, setLog, state,
    waitFor, waitForThreadRows } = GC;

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
      shouldAbort: GC.shouldStopExecution
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
    await GC.settle(150);
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

  /** Handles action select like open. */
  async function actionSelectLikeOpen(options = {}) {
    const manageWorking = !options.skipWorking;
    if (manageWorking) GC.setWorking(true);
    // Drop any previous lock first, so a failed search can never leave the
    // old sender locked for the Archive / Delete step that follows.
    clearSenderLock();
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
      GC.showToast(STRINGS.toast.searchComplete);
    } catch (error) {
      GC.reportError(error.message || "Could not select similar emails.");
    } finally {
      if (manageWorking) GC.setWorking(false);
    }
  }

  /** Ensures query ready. */
  async function ensureQueryReady() {
    if (!state.lockedQuery || !state.lockedSender) {
      throw new Error(`Run '${LABELS.SELECT_LIKE_OPEN_EMAIL}' first so archive is locked to that sender.`);
    }

    assertOpenEmailMatchesLock();
    await ensureSearchContext(state.lockedQuery);
    validateLockedArchiveContext();
  }

  /** Forgets the sender that Archive / Delete are locked to. */
  function clearSenderLock() {
    state.lockedSender = "";
    state.lockedQuery = "";
  }

  /**
   * Throws when an email is open and its sender is not the locked sender, so
   * Archive / Delete never act on a sender other than the one shown in the sidebar.
   */
  function assertOpenEmailMatchesLock() {
    const openSender = normalizeEmail(findOpenEmailSender());
    const lockedSender = normalizeEmail(state.lockedSender);
    if (!openSender || openSender === lockedSender) return;
    clearSenderLock();
    throw new Error(
      `Safety check failed: the open email is from ${openSender}, but the selection is locked to ${lockedSender}. Run '${LABELS.SELECT_LIKE_OPEN_EMAIL}' again.`
    );
  }

  Object.assign(GC, { actionSelectLikeOpen, assertOpenEmailMatchesLock, clearSenderLock, ensureQueryReady, ensureSearchContext, getCurrentSearchInput,
    getCurrentSearchQuery, getHeaderSenderSignals, getRefinementQuery, getRowSenderSignals, runSearchQuery,
    searchBySender, validateLockedArchiveContext, waitForUrlChange });
})();
