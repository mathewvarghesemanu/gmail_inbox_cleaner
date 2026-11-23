// Archive undo offers and the dry-run count before archiving all pages.
(() => {
  const GC = window.__gc;
  if (!GC || GC.skipLoad) return;

  const { GMAIL_TEXT, SELECTORS, UNDO_ALL_OFFER_MS, UNDO_GMAIL_OFFER_MS, ensureSearchContext,
    getFirstRowFingerprint, getMailboxToolbar, getRowSenderSignals, getThreadRows,
    hasAnySelectedConversationRow, isVisible, normalizeEmail, parseLocalizedIntegers, robustClick,
    runSearchQuery, selectAllMatchingSearch, senderSignalMatchesExpected, setLog, sleep, state, waitFor,
    waitForSelectionToSettle } = GC;

  let undoOfferTimer = null;
  let undoOfferPayload = null;

  /** Returns true when the element belongs to this extension's own UI. */
  function isOwnUiElement(el) {
    return !!el?.closest?.(SELECTORS.ownUiRoots);
  }

  /** Finds the "Undo" action in Gmail's notification bar (locale-robust, English fallback). */
  function findGmailUndoLink() {
    const byId = [...document.querySelectorAll(SELECTORS.gmailUndoLinkById)].find(
      (el) => isVisible(el) && !isOwnUiElement(el)
    );
    if (byId) return byId;

    const actionableSelector = SELECTORS.gmailNotificationActions;
    const containers = [...document.querySelectorAll(SELECTORS.gmailNotificationContainers)].filter(
      (el) => isVisible(el) && !isOwnUiElement(el)
    );
    for (const container of containers) {
      const actions = [...container.querySelectorAll(actionableSelector)].filter(
        (el) => isVisible(el) && !isOwnUiElement(el)
      );
      if (!actions.length) continue;
      const byText = actions.find((el) => GMAIL_TEXT.undoPattern.test((el.textContent || "").trim()));
      if (byText) return byText;
      // Locale fallback: the archive notification carries a single action (Undo).
      if (actions.length === 1) return actions[0];
    }
    return null;
  }

  /** Waits briefly for Gmail's undo link (its notification can lag the archive click). */
  async function waitForGmailUndoLink(timeout = 1500) {
    return waitFor(() => findGmailUndoLink(), { timeout, interval: 120 });
  }

  /** Hides the extension's undo offer. */
  function hideUndoOffer() {
    if (undoOfferTimer) {
      clearTimeout(undoOfferTimer);
      undoOfferTimer = null;
    }
    undoOfferPayload = null;
    document.getElementById("gc-undo")?.classList.remove("gc-undo-visible");
  }

  /** Shows an undo offer (message + button) for durationMs. */
  function showUndoOffer(payload) {
    const box = document.getElementById("gc-undo");
    const messageEl = document.getElementById("gc-undo-message");
    const actionEl = document.getElementById("gc-undo-action");
    if (!box || !messageEl || !actionEl) return;
    hideUndoOffer();
    undoOfferPayload = payload;
    messageEl.textContent = payload.message || "";
    actionEl.textContent = payload.actionLabel || "Undo";
    box.classList.add("gc-undo-visible");
    undoOfferTimer = setTimeout(hideUndoOffer, payload.durationMs || UNDO_GMAIL_OFFER_MS);
  }

  /** Offers to click Gmail's own Undo after a single-page archive. */
  function offerGmailUndo(bulkKind = "archive") {
    const deleted = bulkKind === "delete";
    showUndoOffer({
      kind: "gmail",
      message: deleted ? "Deleted this page." : "Archived this page.",
      actionLabel: deleted ? "Undo delete" : "Undo archive",
      bulkKind,
      durationMs: UNDO_GMAIL_OFFER_MS
    });
  }

  /** Offers to move everything from the archived sender back to the Inbox. */
  function offerUndoAllArchive(sender) {
    const normalized = normalizeEmail(sender);
    if (!normalized) return;
    showUndoOffer({
      kind: "all",
      sender: normalized,
      message: `Archived all pages from ${normalized}.`,
      actionLabel: "Undo all",
      durationMs: UNDO_ALL_OFFER_MS
    });
  }

  /** Clicks Gmail's Undo link if still present. Never throws. */
  async function undoSinglePageArchive(bulkKind = "archive") {
    try {
      const link = await waitForGmailUndoLink(1500);
      if (!link) {
        setLog("Gmail's Undo link is no longer available.");
        GC.showToast(
          bulkKind === "delete"
            ? "Undo no longer available in Gmail. Restore from Trash."
            : "Undo no longer available in Gmail. Use Show Archived to restore.",
          { durationMs: 4000 }
        );
        return;
      }
      robustClick(link);
      setLog("Undo sent to Gmail.");
      GC.showToast(bulkKind === "delete" ? "Delete undone" : "Archive undone");
    } catch (error) {
      setLog(`Undo failed: ${error?.message || error}`);
      GC.showToast("Undo failed");
    }
  }

  /** Finds Gmail's "Move to Inbox" toolbar control (English text first, then act code). */
  function findMoveToInboxControl() {
    const toolbar = getMailboxToolbar() || document;
    const controls = [...toolbar.querySelectorAll(SELECTORS.toolbarControls)].filter(
      (el) =>
        isVisible(el) &&
        !isOwnUiElement(el) &&
        (el.getAttribute("aria-disabled") || "").toLowerCase() !== "true"
    );
    const byText = controls.find((el) => {
      const signal = [
        el.getAttribute("aria-label") || "",
        el.getAttribute("data-tooltip") || "",
        (el.textContent || "").trim()
      ].join(" ");
      return GMAIL_TEXT.moveToInboxPattern.test(signal);
    });
    if (byText) return byText;
    // Locale-independent fallback: Gmail's toolbar action code for Move to Inbox.
    return controls.find((el) => (el.getAttribute("act") || "").trim() === SELECTORS.moveToInboxAct) || null;
  }

  /** Moves the current selection to the Inbox. Returns false if the control is missing. */
  async function moveSelectedToInbox() {
    const control = findMoveToInboxControl();
    if (!control) return false;
    // Same signal as archiveSelected: finish once Gmail clears the moved rows.
    const hadSelection = hasAnySelectedConversationRow();
    robustClick(control);
    if (hadSelection) {
      await waitFor(() => !hasAnySelectedConversationRow(), { timeout: 700, interval: 70 });
    } else {
      await sleep(700);
    }
    return true;
  }

  /** Finds the visible "1–50 of 1,234" range element in Gmail's toolbar. */
  function findResultRangeElement() {
    const scopes = [getMailboxToolbar(), document].filter(Boolean);
    for (const scope of scopes) {
      const el = [...scope.querySelectorAll(SELECTORS.resultRange)].find((node) => isVisible(node) && !isOwnUiElement(node));
      if (el) return el;
    }
    const toolbar = getMailboxToolbar();
    if (!toolbar) return null;
    return (
      [...toolbar.querySelectorAll(SELECTORS.resultRangeFallbackNodes)].find((node) => {
        if (!isVisible(node) || node.children.length > 6) return false;
        const text = (node.textContent || "").trim();
        return text.length < 48 && /\d\s*[–—\-~～]\s*\d/.test(text);
      }) || null
    );
  }

  /**
   * Reads Gmail's result count. Returns { total, pageSize, many } or null.
   * Uses the largest number as the total so locales that put it first still work.
   */
  function readGmailResultCount() {
    const el = findResultRangeElement();
    if (!el) return null;
    const tsParts = [...el.querySelectorAll(SELECTORS.resultRangeParts)].map((node) => node.textContent || "");
    const numbers = tsParts.length >= 2
      ? tsParts.flatMap((part) => parseLocalizedIntegers(part))
      : parseLocalizedIntegers(el.textContent || "");
    if (numbers.length < 2) return null;

    if (numbers.length === 2) {
      // "1–50 of many": no total available.
      const [a, b] = numbers;
      return { total: null, pageSize: Math.max(a, b) - Math.min(a, b) + 1, many: true };
    }

    const total = Math.max(...numbers);
    const rest = [...numbers];
    rest.splice(rest.indexOf(total), 1);
    const pageSize = Math.max(...rest) - Math.min(...rest) + 1;
    return { total, pageSize, many: false };
  }

  /** Builds the human description of how many conversations will be archived. */
  function describeArchiveCount() {
    const count = readGmailResultCount();
    if (count && !count.many && count.total > 0) {
      return `~${count.total.toLocaleString()} conversation${count.total === 1 ? "" : "s"}`;
    }
    if (count && count.many) {
      return `many conversations (${count.pageSize}+ per page × multiple pages)`;
    }
    const rows = getThreadRows().length;
    return rows ? `at least ${rows} conversation${rows === 1 ? "" : "s"}` : "all listed conversations";
  }

  /** Dry-run: shows the match count and asks before archiving all pages. */
  async function confirmArchiveAllPagesWithCount(sender) {
    const description = describeArchiveCount();
    setLog(`Dry run: ${description} from ${sender}.`);
    const proceed = await GC.askProceedConfirmation(
      `About to archive ${description} from ${sender}. Proceed?`,
      { autoProceed: state.batchExecuting }
    );
    if (proceed) return true;
    setLog("Archive cancelled by user.");
    if (state.batchExecuting) {
      state.stopExecutionRequested = true;
      GC.showToast("Execution stopped");
    } else {
      GC.showToast("Archive cancelled");
    }
    return false;
  }

  /** Moves every archived conversation from sender back to the Inbox. */
  async function actionUndoArchiveAll(sender) {
    const expectedSender = normalizeEmail(sender);
    if (!expectedSender) {
      GC.showToast("Nothing to undo");
      return;
    }
    if (state.working || state.batchExecuting) {
      GC.showToast("Finish or stop the current run first");
      return;
    }
    const query = `from:${expectedSender} -in:inbox`;
    const proceed = await GC.askProceedConfirmation(
      `Move archived conversations from ${expectedSender} back to Inbox? This searches "${query}" and moves every match, including ones archived before this run.`
    );
    if (!proceed) {
      setLog("Undo all cancelled.");
      return;
    }
    if (state.working || state.batchExecuting) {
      GC.showToast("Finish or stop the current run first");
      return;
    }
    hideUndoOffer();

    // Run as a stoppable execution so the Stop button and stop checks apply.
    state.batchExecuting = true;
    state.stopExecutionRequested = false;
    GC.setWorking(true);
    let cycles = 0;
    try {
      setLog(`Undo all: searching ${query}...`);
      await runSearchQuery(query);

      let unchangedCycles = 0;
      const maxCycles = 300;
      const maxUnchangedCycles = 4;
      while (cycles < maxCycles) {
        if (GC.shouldStopExecution()) {
          setLog(`Undo all stopped after ${cycles} page(s).`);
          GC.showToast("Undo stopped");
          return;
        }
        await ensureSearchContext(query);
        const rows = getThreadRows();
        if (!rows.length) break;

        const rowSenders = getRowSenderSignals();
        if (rowSenders.length && !rowSenders.some((s) => senderSignalMatchesExpected(s, expectedSender))) {
          throw new Error(`Safety check failed: listed emails are not from ${expectedSender}.`);
        }

        const beforeFingerprint = getFirstRowFingerprint();
        setLog(`Undo all: page ${cycles + 1}, selecting...`);
        await selectAllMatchingSearch({ includeAllInSearch: false });
        await waitForSelectionToSettle();
        if (GC.shouldStopExecution()) continue;
        setLog(`Undo all: page ${cycles + 1}, moving to Inbox...`);
        const moved = await moveSelectedToInbox();
        if (!moved) {
          throw new Error("Could not find Gmail's Move to Inbox button.");
        }
        cycles += 1;
        // Wait (up to the previous fixed 2s) for the list to show different rows.
        const refreshed = await waitFor(() => {
          if (!getThreadRows().length) return false;
          const fingerprint = getFirstRowFingerprint();
          return !!(fingerprint && fingerprint !== beforeFingerprint);
        }, { timeout: 2000, interval: 150, shouldAbort: GC.shouldStopExecution });
        if (refreshed) await sleep(300);

        if (!getThreadRows().length) break;
        const afterFingerprint = getFirstRowFingerprint();
        if (beforeFingerprint && afterFingerprint && beforeFingerprint === afterFingerprint) {
          unchangedCycles += 1;
          if (unchangedCycles >= maxUnchangedCycles) {
            setLog(`Undo all stopped after ${cycles} page(s): list did not change.`);
            GC.showToast("Undo all incomplete");
            return;
          }
          await sleep(800);
        } else {
          unchangedCycles = 0;
        }
      }

      if (!cycles) {
        setLog(`No archived conversations from ${expectedSender} found.`);
        GC.showToast("Nothing to restore");
        return;
      }
      setLog(`Moved ${cycles} page(s) from ${expectedSender} back to Inbox.`);
      GC.flashSuccess("Restored");
      GC.showToast("Undo all complete");
    } catch (error) {
      setLog(`Undo all failed: ${error?.message || error}`);
      GC.showToast("Undo all failed");
    } finally {
      // The restored emails are back in the Inbox: drop the sender lock and the
      // "-in:inbox" search so the next run on this sender starts fresh.
      state.lockedSender = "";
      state.lockedQuery = "";
      state.query = "";
      state.batchExecuting = false;
      state.stopExecutionRequested = false;
      GC.setWorking(false);
    }
  }

  /** Runs the action behind the current undo offer. */
  function handleUndoOfferClick() {
    const payload = undoOfferPayload;
    if (!payload) return;
    if (payload.kind === "gmail") {
      hideUndoOffer();
      void undoSinglePageArchive(payload.bulkKind);
      return;
    }
    if (payload.kind === "all") {
      if (state.working || state.batchExecuting) {
        GC.showToast("Finish or stop the current run first");
        return;
      }
      void GC.runWithElapsedToast("Undo all", async () => {
        await actionUndoArchiveAll(payload.sender);
      });
    }
  }

  /** Wires the undo offer buttons. */
  function installUndoOfferListeners() {
    document.getElementById("gc-undo-action")?.addEventListener("click", handleUndoOfferClick);
    document.getElementById("gc-undo-dismiss")?.addEventListener("click", hideUndoOffer);
  }

  Object.assign(GC, { actionUndoArchiveAll, confirmArchiveAllPagesWithCount, describeArchiveCount,
    findGmailUndoLink, findMoveToInboxControl, findResultRangeElement, handleUndoOfferClick, hideUndoOffer,
    installUndoOfferListeners, isOwnUiElement, moveSelectedToInbox, offerGmailUndo, offerUndoAllArchive,
    readGmailResultCount, showUndoOffer, undoSinglePageArchive, waitForGmailUndoLink });
})();
