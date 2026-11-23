// Archive actions (this page, all pages, show archived).
(() => {
  const GC = window.__gc;
  if (!GC || GC.skipLoad) return;

  const { GMAIL_TEXT, SELECTORS, STRINGS, countSelectedConversationRows, ensureQueryReady,
    getFirstRowFingerprint, getMailboxToolbar, getThreadRows, hasAnySelectedConversationRow, isVisible,
    recordStats, robustClick, runSearchQuery, selectAllMatchingSearch, setLog, sleep, state,
    triggerKeySequence, validateLockedArchiveContext, waitFor, waitForSelectionToSettle } = GC;

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

  /** Handles action archive all. */
  async function actionArchiveAll(options = {}) {
    const manageWorking = !options.skipWorking;
    if (manageWorking) GC.setWorking(true);
    try {
      await ensureQueryReady();
      validateLockedArchiveContext();
      setLog("Selecting conversations on current page...");
      await selectAllMatchingSearch({ includeAllInSearch: false });
      await waitForSelectionToSettle();
      setLog(`${state.selectedConversationsText} Archiving current page...`);
      const selectedCount = countSelectedConversationRows();
      await archiveSelected();
      recordStats({ pagesArchived: 1, conversationsArchived: selectedCount });
      setLog("Archive action sent for current page.");
      GC.flashSuccess(STRINGS.toast.archived);
      GC.showToast(STRINGS.toast.archiveComplete);
      GC.offerGmailUndo();
    } catch (error) {
      setLog(error.message || "Archive failed.");
    } finally {
      if (manageWorking) GC.setWorking(false);
    }
  }

  /** Handles action archive recursive. */
  async function actionArchiveRecursive(options = {}) {
    const manageWorking = !options.skipWorking;
    if (manageWorking) GC.setWorking(true);
    const undoTracker = { sender: "", cycles: 0 };
    try {
      await ensureQueryReady();
      await GC.waitForListToLoadForBatchStep(20000);
      if (!getThreadRows().length) {
        throw new Error("No emails found in the current filtered list to archive.");
      }
      if (!(await GC.confirmArchiveAllPagesWithCount(state.lockedSender))) return;
      undoTracker.sender = state.lockedSender;

      let cycles = 0;
      let unchangedCycles = 0;
      const maxCycles = 300;
      const maxUnchangedCycles = 4;

      while (cycles < maxCycles) {
        if (GC.shouldStopExecution()) {
          setLog(`Stopped after ${cycles} cycle(s).`);
          GC.showToast(STRINGS.toast.executionStopped);
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
        const selectedCount = countSelectedConversationRows();
        await archiveSelected();
        recordStats({ pagesArchived: 1, conversationsArchived: selectedCount });
        undoTracker.cycles += 1;
        // Wait (up to the previous fixed 2s) for Gmail to repopulate the list with
        // different rows; then a short settle before the next cycle reads it.
        const refreshed = await waitFor(() => {
          if (!getThreadRows().length) return false;
          const fingerprint = getFirstRowFingerprint();
          return !!(fingerprint && fingerprint !== beforeFingerprint);
        }, { timeout: 2000, interval: 150, shouldAbort: GC.shouldStopExecution });
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
            GC.flashSuccess(STRINGS.toast.archived);
            GC.showToast(STRINGS.toast.archiveComplete);
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
      GC.flashSuccess(STRINGS.toast.archived);
      GC.showToast(STRINGS.toast.archiveComplete);
    } catch (error) {
      setLog(error.message || "Recursive archive failed.");
    } finally {
      if (undoTracker.sender && undoTracker.cycles > 0) GC.offerUndoAllArchive(undoTracker.sender);
      if (manageWorking) GC.setWorking(false);
    }
  }

  /** Shows archived emails by running the archived search query. */
  async function actionShowArchived() {
    GC.setWorking(true);
    try {
      await runSearchQuery("-in:inbox -in:sent -in:drafts -in:spam -in:trash");
      setLog("Showing archived emails.");
      GC.showToast(STRINGS.toast.showingArchived);
    } catch (err) {
      setLog("Could not run archived search: " + err.message);
    } finally {
      GC.setWorking(false);
    }
  }

  Object.assign(GC, { actionArchiveAll, actionArchiveRecursive, actionShowArchived, archiveCurrentPage,
    archiveCurrentPageWithRetry, archiveSelected });
})();
