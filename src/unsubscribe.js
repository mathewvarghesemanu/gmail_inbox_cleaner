// Finding and clicking Gmail's unsubscribe controls and dialogs.
(() => {
  const GC = window.__gc;
  if (!GC || GC.skipLoad) return;

  const { GMAIL_TEXT, SELECTORS, STRINGS, findOpenEmailSender, isVisible, normalizeEmail, normalizeQuery,
    recordStats, robustClick, setLog, state, waitFor } = GC;

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

  /** Handles action unsubscribe. */
  async function actionUnsubscribe(options = {}) {
    const manageWorking = !options.skipWorking;
    if (manageWorking) GC.setWorking(true);
    try {
      setLog("Looking for unsubscribe in open email...");
      const sender = findOpenEmailSender();
      const alreadyUnsubscribedNotice = findAlreadyUnsubscribedNotice(sender);
      if (alreadyUnsubscribedNotice) {
        setLog(`Already unsubscribed from ${sender}.`);
        GC.showToast(STRINGS.toast.alreadyUnsubscribed(sender));
        return;
      }
      const result = await clickUnsubscribeInOpenEmail();
      await dismissUnsubscribeDialogs();
      recordStats({ unsubscribed: 1 });
      setLog(result);
      GC.showToast(STRINGS.toast.unsubscribeComplete);
    } catch (error) {
      const message = error.message || "Unsubscribe failed.";
      if (message.includes("No unsubscribe button/link found")) {
        const proceed = await GC.askProceedConfirmation(STRINGS.prompt.noUnsubscribe);
        if (proceed) {
          setLog("No unsubscribe button found. Proceeding to next action.");
          GC.showToast(STRINGS.toast.proceedingWithoutUnsubscribe);
          return;
        }

        setLog("Execution stopped by user (unsubscribe confirmation).");
        if (state.batchExecuting) {
          state.stopExecutionRequested = true;
          GC.showToast(STRINGS.toast.executionStopped);
        }
        return;
      }
      GC.reportError(message);
    } finally {
      if (manageWorking) GC.setWorking(false);
    }
  }

  Object.assign(GC, { actionUnsubscribe, clickUnsubscribeInOpenEmail, dismissUnsubscribeDialogs,
    findAlreadyUnsubscribedNotice, findBestUnsubscribeTarget, findUnsubscribeConfirmButton,
    findUnsubscribeFollowupDismissButton, getUnsubscribeSignal, hasVisibleUnsubscribeDialog,
    waitForUnsubscribeConfirm, waitForUnsubscribeDialogToClear });
})();
