// Delete Open Email: opt-in (popup toggle), moves the open conversation to Trash.
(() => {
  const GC = window.__gc;
  if (!GC || GC.skipLoad) return;

  const { DELETE_CONFIRM_SKIP_KEY, DELETE_ENABLED_KEY, GMAIL_TEXT, SELECTORS, STRINGS, findOpenEmailSender,
    getMailboxToolbar, getOpenEmailSubject, isVisible, recordStats, robustClick, safeStorageGet, setLog,
    state, waitFor } = GC;

  /** Reads the delete settings from storage (defaults: disabled, confirmation on). */
  function readDeleteSettings() {
    return new Promise((resolve) => {
      let settled = false;
      const done = (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      // safeStorageGet skips the callback on errors; fail closed (disabled).
      setTimeout(() => done({ enabled: false, skipConfirm: false }), 2000);
      safeStorageGet([DELETE_ENABLED_KEY, DELETE_CONFIRM_SKIP_KEY], (result) => {
        done({
          enabled: result?.[DELETE_ENABLED_KEY] === true,
          skipConfirm: result?.[DELETE_CONFIRM_SKIP_KEY] === true
        });
      });
    });
  }

  /** True when el is a Gmail Delete control (never "Delete forever", never our own UI). */
  function isGmailDeleteControl(el) {
    if (!isVisible(el)) return false;
    if (el.closest(SELECTORS.ownUiRoots)) return false;
    if ((el.getAttribute("aria-disabled") || "").toLowerCase() === "true") return false;
    const label = (el.getAttribute("aria-label") || "").trim().toLowerCase();
    const tooltip = (el.getAttribute("data-tooltip") || "").trim().toLowerCase();
    if (GMAIL_TEXT.deleteForeverPattern.test(`${label} ${tooltip}`)) return false;
    const act = (el.getAttribute("act") || "").trim();
    return label === GMAIL_TEXT.delete || tooltip === GMAIL_TEXT.delete || act === SELECTORS.deleteAct;
  }

  /** Finds Gmail's Delete button for the open conversation. */
  function findDeleteControl() {
    const toolbar = getMailboxToolbar();
    const scopes = toolbar ? [toolbar, document] : [document];
    for (const scope of scopes) {
      const match = [...scope.querySelectorAll(SELECTORS.toolbarControls)].find(isGmailDeleteControl);
      if (match) return match;
    }
    return null;
  }

  /** Handles action delete open email. */
  async function actionDeleteOpenEmail(options = {}) {
    const manageWorking = !options.skipWorking;
    const settings = await readDeleteSettings();
    if (!settings.enabled) {
      setLog("Delete is turned off. Enable it in the extension popup.");
      GC.showToast(STRINGS.toast.deleteDisabled);
      return;
    }
    const sender = findOpenEmailSender();
    if (!sender) {
      setLog("Open an email first.");
      return;
    }
    const subject = getOpenEmailSubject() || "";

    // Lock other actions while the confirmation is open, too.
    if (manageWorking) GC.setWorking(true);
    try {
      if (!settings.skipConfirm) {
        const confirmed = await GC.askProceedConfirmation(STRINGS.prompt.deleteOpenEmail(sender, subject), {
          proceedLabel: STRINGS.ui.deleteConfirm,
          stopLabel: STRINGS.ui.cancel
        });
        if (!confirmed) {
          setLog("Delete cancelled.");
          GC.showToast(STRINGS.toast.deleteCancelled);
          return;
        }
      }

      const control = findDeleteControl();
      if (!control) {
        throw new Error("Could not find Gmail's Delete button for the open email. Nothing was deleted.");
      }
      const heading = document.querySelector(SELECTORS.openThreadHeadingInMain);
      robustClick(control);
      // Gmail leaves the thread view once the conversation is in Trash.
      const left = await waitFor(
        () => !heading || !heading.isConnected || !document.querySelector(SELECTORS.openThreadHeadingInMain),
        { timeout: 4000, interval: 100 }
      );
      if (!left) {
        setLog("Clicked Delete, but the email still looks open. Check Gmail before retrying.");
        return;
      }
      recordStats({ deleted: 1 });
      state.openSender = "";
      setLog(`Moved to Trash: ${sender}${subject ? ` | ${subject}` : ""}`);
      GC.showToast(STRINGS.toast.deleted);
    } catch (error) {
      setLog(error?.message || "Delete failed.");
    } finally {
      if (manageWorking) GC.setWorking(false);
    }
  }

  /** Shows or hides the sidebar Delete row. */
  function setDeleteFeatureVisibility(enabled) {
    document.getElementById("gc-delete-row")?.classList.toggle("gc-hidden", !enabled);
  }

  /** Applies the stored Delete toggle to the sidebar. */
  function syncDeleteFeatureFromStorage() {
    safeStorageGet([DELETE_ENABLED_KEY], (result) => {
      setDeleteFeatureVisibility(result?.[DELETE_ENABLED_KEY] === true);
    });
  }

  Object.assign(GC, { actionDeleteOpenEmail, findDeleteControl, isGmailDeleteControl, readDeleteSettings,
    setDeleteFeatureVisibility, syncDeleteFeatureFromStorage });
})();
