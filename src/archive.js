// Archive actions (this page, all pages, show archived).
(() => {
  const GC = window.__gc;
  if (!GC || GC.skipLoad) return;

  const { GMAIL_TEXT, SELECTORS, STRINGS, countSelectedConversationRows, ensureQueryReady,
    getFirstRowFingerprint, getMailboxToolbar, getThreadRows, hasAnySelectedConversationRow, isVisible,
    recordStats, robustClick, runSearchQuery, selectAllMatchingSearch, setLog, sleep, state,
    triggerKeySequence, validateLockedArchiveContext, waitFor, waitForSelectionToSettle } = GC;

  /** Finds Gmail's toolbar Archive button. */
  function findArchiveControl() {
    const toolbar = getMailboxToolbar() || document;
    return [...toolbar.querySelectorAll(SELECTORS.toolbarControls)].find((el) => {
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
    }) || null;
  }

  /**
   * Per-kind wording, stats and Gmail control for the shared page / all-pages loops.
   * Delete never falls back to a keyboard shortcut: no button found means nothing is deleted.
   */
  const BULK_KINDS = {
    archive: {
      verbing: "archiving",
      verbed: "archived",
      findControl: findArchiveControl,
      keyFallback: ["e"],
      stats: (count) => ({ pagesArchived: 1, conversationsArchived: count }),
      doneToast: STRINGS.toast.archived,
      completeToast: STRINGS.toast.archiveComplete
    },
    delete: {
      verbing: "deleting",
      verbed: "deleted",
      findControl: () => GC.findDeleteControl(),
      keyFallback: null,
      stats: (count) => ({ deleted: count }),
      doneToast: STRINGS.toast.deleted,
      completeToast: STRINGS.toast.deleteComplete
    }
  };

  /** Clicks Archive (or Delete) for the selected rows and waits for Gmail to clear them. */
  async function applyToSelected(kind = "archive") {
    const config = BULK_KINDS[kind];
    const control = config.findControl();
    // When rows were visibly selected, finish as soon as Gmail clears them;
    // otherwise there is no signal to watch, so keep the full wait.
    const hadSelection = hasAnySelectedConversationRow();
    if (control) {
      robustClick(control);
    } else if (config.keyFallback) {
      triggerKeySequence(config.keyFallback);
    } else {
      throw new Error("Could not find Gmail's Delete button. Nothing was deleted.");
    }
    if (hadSelection) {
      await waitFor(() => !hasAnySelectedConversationRow(), { timeout: 700, interval: 70 });
    } else {
      await sleep(700);
    }
  }

  /** Archives selected. */
  async function archiveSelected() {
    await applyToSelected("archive");
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

  /** Archives (or deletes) the listed emails on the current page. */
  async function bulkThisPage(kind, options = {}) {
    const config = BULK_KINDS[kind];
    const manageWorking = !options.skipWorking;
    if (manageWorking) GC.setWorking(true);
    try {
      const deleteSettings = kind === "delete" ? await GC.requireDeleteEnabled() : null;
      await ensureQueryReady();
      validateLockedArchiveContext();
      setLog("Selecting conversations on current page...");
      await selectAllMatchingSearch({ includeAllInSearch: false });
      await waitForSelectionToSettle();
      const selectedCount = countSelectedConversationRows();
      if (kind === "delete") {
        const description = selectedCount
          ? `${selectedCount} conversation${selectedCount === 1 ? "" : "s"}`
          : "the listed conversations";
        const message = STRINGS.prompt.deleteThisPage(description, state.lockedSender);
        if (!(await GC.confirmDelete(message, deleteSettings))) return;
      }
      setLog(`${state.selectedConversationsText} ${config.verbing[0].toUpperCase()}${config.verbing.slice(1)} current page...`);
      await applyToSelected(kind);
      recordStats(config.stats(selectedCount));
      setLog(`${kind === "delete" ? "Delete" : "Archive"} action sent for current page.`);
      GC.flashSuccess(config.doneToast);
      GC.showToast(config.completeToast);
      GC.offerGmailUndo(kind);
    } catch (error) {
      setLog(error.message || `${kind === "delete" ? "Delete" : "Archive"} failed.`);
    } finally {
      if (manageWorking) GC.setWorking(false);
    }
  }

  /** Archives (or deletes) the listed emails across all pages. */
  async function bulkAllPages(kind, options = {}) {
    const config = BULK_KINDS[kind];
    const manageWorking = !options.skipWorking;
    if (manageWorking) GC.setWorking(true);
    const undoTracker = { sender: "", cycles: 0 };
    try {
      const deleteSettings = kind === "delete" ? await GC.requireDeleteEnabled() : null;
      await ensureQueryReady();
      await GC.waitForListToLoadForBatchStep(20000);
      if (!getThreadRows().length) {
        throw new Error(`No emails found in the current filtered list to ${kind}.`);
      }
      if (kind === "delete") {
        validateLockedArchiveContext();
        const message = STRINGS.prompt.deleteAllPages(GC.describeArchiveCount(), state.lockedSender);
        if (!(await GC.confirmDelete(message, deleteSettings))) return;
      } else {
        if (!(await GC.confirmArchiveAllPagesWithCount(state.lockedSender))) return;
        // Undo all moves archived mail back to the Inbox; it does not apply to Trash.
        undoTracker.sender = state.lockedSender;
      }

      let cycles = 0;
      let processed = 0;
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
        setLog(`Cycle ${cycles + 1}: ${config.verbing}...`);
        const selectedCount = countSelectedConversationRows();
        GC.setProgress(STRINGS.ui.bulkProgress(cycles + 1, processed, config.verbed));
        await applyToSelected(kind);
        recordStats(config.stats(selectedCount));
        processed += selectedCount;
        GC.setProgress(STRINGS.ui.bulkProgress(cycles + 1, processed, config.verbed));
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
            GC.flashSuccess(config.doneToast);
            GC.showToast(config.completeToast);
            return;
          }
        } else {
          unchangedCycles = 0;
        }
      }

      if (cycles === 0) {
        setLog(`No emails found to ${kind}.`);
        return;
      }
      setLog(`${kind === "delete" ? "Delete" : "Archive"} loop completed after ${cycles} cycle(s).`);
      GC.flashSuccess(config.doneToast);
      GC.showToast(config.completeToast);
    } catch (error) {
      setLog(error.message || `${kind === "delete" ? "Delete" : "Archive"} across all pages failed.`);
    } finally {
      if (undoTracker.sender && undoTracker.cycles > 0) GC.offerUndoAllArchive(undoTracker.sender);
      if (manageWorking) GC.setWorking(false);
    }
  }

  /** Handles action archive all. */
  async function actionArchiveAll(options = {}) {
    await bulkThisPage("archive", options);
  }

  /** Handles action archive recursive. */
  async function actionArchiveRecursive(options = {}) {
    await bulkAllPages("archive", options);
  }

  /** Deletes (moves to Trash) the listed emails on this page. Opt-in. */
  async function actionDeleteThisPage(options = {}) {
    await bulkThisPage("delete", options);
  }

  /** Deletes (moves to Trash) the listed emails across all pages. Opt-in. */
  async function actionDeleteAllPages(options = {}) {
    await bulkAllPages("delete", options);
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

  Object.assign(GC, { actionArchiveAll, actionArchiveRecursive, actionDeleteAllPages, actionDeleteThisPage,
    actionShowArchived, applyToSelected, archiveCurrentPage, archiveCurrentPageWithRetry, archiveSelected,
    bulkAllPages, bulkThisPage, findArchiveControl });
})();
