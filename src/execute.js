// Execute Selected batch runner and stop handling.
(() => {
  const GC = window.__gc;
  if (!GC || GC.skipLoad) return;

  const { ACTION_BUTTON_IDS, STRINGS, actionArchiveAll, actionArchiveRecursive, actionDeleteOpenEmail, actionGoInbox,
    actionGoNextPage, actionSelectLikeOpen, actionUnsubscribe, announceEmailTargetStatus,
    cacheNextEmailTargetForSender, clearCachedNextEmailTarget, dismissUnsubscribeDialogs,
    findOpenEmailSender, getMailboxToolbar, getSelectedActionIds, getThreadRows, recordStats,
    runWithElapsedToast, setLog, setWorking, showToast, sleep, state, updateExecuteSelectedState,
    waitForThreadRows } = GC;

  /** Returns action handler. */
  function getActionHandler(buttonId) {
    const handlers = {
      [ACTION_BUTTON_IDS.UNSUBSCRIBE]: actionUnsubscribe,
      [ACTION_BUTTON_IDS.SELECT_LIKE_OPEN]: actionSelectLikeOpen,
      [ACTION_BUTTON_IDS.ARCHIVE_THIS_PAGE]: actionArchiveAll,
      [ACTION_BUTTON_IDS.ARCHIVE_ALL_PAGES]: actionArchiveRecursive,
      [ACTION_BUTTON_IDS.GO_TO_INBOX]: actionGoInbox,
      [ACTION_BUTTON_IDS.GO_TO_NEXT_PAGE]: actionGoNextPage,
      [ACTION_BUTTON_IDS.DELETE_OPEN_EMAIL]: actionDeleteOpenEmail
    };
    return handlers[buttonId] || null;
  }

  /** Runs action by button id. */
  async function runActionByButtonId(buttonId, options = {}) {
    const handler = getActionHandler(buttonId);
    if (!handler) return;
    await handler(options);
  }

  /** Runs Execute Selected with the shared toast wrapper. */
  function triggerExecuteSelected() {
    void runWithElapsedToast(STRINGS.ui.executeSelected, async () => {
      await executeSelectedActions();
    });
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

  /**
   * Prepares the next-email target, but never blocks the rest of the batch:
   * if no target can be found, Go to Next Email is dropped and the other
   * selected actions (unsubscribe, select, archive) still run.
   */
  async function prepareNextEmailTargetOrSkip(selectedActionIds) {
    try {
      await prepareNextEmailTargetForBatchSelection(selectedActionIds);
      return selectedActionIds;
    } catch (error) {
      if (!selectedActionIds.includes(ACTION_BUTTON_IDS.GO_TO_NEXT_PAGE)) throw error;
      setLog(`${error?.message || error} Continuing without Go to Next Email.`);
      showToast(STRINGS.toast.nextTargetUnavailable, { durationMs: 3500 });
      return selectedActionIds.filter((id) => id !== ACTION_BUTTON_IDS.GO_TO_NEXT_PAGE);
    }
  }

  /** Executes selected actions. */
  async function executeSelectedActions() {
    if (state.working || state.batchExecuting) return;
    let selectedActionIds = getSelectedActionIds();
    if (!selectedActionIds.length) {
      updateExecuteSelectedState();
      return;
    }

    state.batchExecuting = true;
    state.stopExecutionRequested = false;
    setWorking(true);
    let failureMessage = "";
    try {
      selectedActionIds = await prepareNextEmailTargetOrSkip(selectedActionIds);
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
      recordStats({ batches: 1 });
      if (shouldStopExecution()) {
        setLog("Execution stopped.");
        showToast(STRINGS.toast.executionStopped);
      }
    } catch (error) {
      // Surface the reason instead of letting the finally block overwrite it
      // with "Execution complete" (which looked like nothing happened).
      failureMessage = error?.message || String(error);
      showToast(STRINGS.toast.executionFailed, { durationMs: 3500 });
    } finally {
      clearCachedNextEmailTarget();
      setLog(
        failureMessage
          ? `Execution failed: ${failureMessage}`
          : "Execution complete. Cleared cached next email target."
      );
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

  Object.assign(GC, { executeSelectedActions, getActionHandler, prepareNextEmailTargetForBatchSelection, prepareNextEmailTargetOrSkip,
    requestStopExecution, runActionByButtonId, shouldPrepareNextEmailTargetForBatch, shouldStopExecution,
    shouldWaitBetweenActions, triggerExecuteSelected, waitForListToLoadForBatchStep });
})();
