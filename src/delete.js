// Delete Listed Emails: opt-in (popup toggle). Settings, Gmail Delete button lookup,
// confirmation, and sidebar visibility. The page / all-pages loops live in archive.js.
(() => {
  const GC = window.__gc;
  if (!GC || GC.skipLoad) return;

  const { ACTION_BUTTON_IDS, DELETE_CONFIRM_SKIP_KEY, DELETE_ENABLED_KEY, GMAIL_TEXT, SELECTORS, STRINGS,
    getMailboxToolbar, isVisible, safeStorageGet, setLog, state } = GC;

  const DELETE_ACTION_IDS = [ACTION_BUTTON_IDS.DELETE_THIS_PAGE, ACTION_BUTTON_IDS.DELETE_ALL_PAGES];

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

  /** Throws unless Delete is enabled in the popup; returns the settings. */
  async function requireDeleteEnabled() {
    const settings = await readDeleteSettings();
    if (!settings.enabled) {
      GC.showToast(STRINGS.toast.deleteDisabled);
      throw new Error("Delete is turned off. Enable it in the extension popup.");
    }
    return settings;
  }

  /**
   * Asks before deleting (Delete / Cancel, never auto-proceeds) unless the user
   * turned on "Skip confirmation". Cancelling stops a running Execute Selected.
   */
  async function confirmDelete(message, settings) {
    if (settings?.skipConfirm) return true;
    const confirmed = await GC.askProceedConfirmation(message, {
      proceedLabel: STRINGS.ui.deleteConfirm,
      stopLabel: STRINGS.ui.cancel
    });
    if (confirmed) return true;
    setLog("Delete cancelled.");
    if (state.batchExecuting) {
      state.stopExecutionRequested = true;
      GC.showToast(STRINGS.toast.executionStopped);
    } else {
      GC.showToast(STRINGS.toast.deleteCancelled);
    }
    return false;
  }

  /** True when el is Gmail's Delete control (never "Delete forever", never our own UI). */
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

  /** Finds Gmail's toolbar Delete button. */
  function findDeleteControl() {
    const toolbar = getMailboxToolbar();
    const scopes = toolbar ? [toolbar, document] : [document];
    for (const scope of scopes) {
      const match = [...scope.querySelectorAll(SELECTORS.toolbarControls)].find(isGmailDeleteControl);
      if (match) return match;
    }
    return null;
  }

  /**
   * Shows or hides the delete options. When hidden, any selected delete option is
   * cleared so Execute Selected can never run it.
   */
  function setDeleteFeatureVisibility(enabled) {
    document.querySelectorAll(".gc-delete-row, .gc-delete-group").forEach((row) => row.classList.toggle("gc-hidden", !enabled));
    const title = document.getElementById("gc-archive-section-title");
    if (title) title.textContent = enabled ? STRINGS.ui.sectionArchiveOrDelete : STRINGS.ui.sectionArchive;
    if (enabled) return;
    let cleared = false;
    DELETE_ACTION_IDS.forEach((id) => {
      const input = document.querySelector(`.gc-action-checkbox[data-action-id='${id}']`);
      if (input?.checked) {
        input.checked = false;
        cleared = true;
      }
    });
    if (cleared) {
      GC.persistActionCheckboxState?.();
      GC.updateExecuteSelectedState?.();
    }
  }

  /** Applies the stored Delete toggle to the sidebar. */
  function syncDeleteFeatureFromStorage() {
    safeStorageGet([DELETE_ENABLED_KEY], (result) => {
      setDeleteFeatureVisibility(result?.[DELETE_ENABLED_KEY] === true);
    });
  }

  Object.assign(GC, { DELETE_ACTION_IDS, confirmDelete, findDeleteControl, isGmailDeleteControl,
    readDeleteSettings, requireDeleteEnabled, setDeleteFeatureVisibility, syncDeleteFeatureFromStorage });
})();
