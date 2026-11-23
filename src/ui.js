// Sidebar UI: building, toasts, confirmations, control state, visibility.
(() => {
  const GC = window.__gc;
  if (!GC || GC.skipLoad) return;

  const { ACTION_BUTTON_IDS, ACTION_CHECKBOX_STATE_KEY, AUTO_PROCEED_SECONDS,
    AUTO_PROCEED_UNSUBSCRIBE_PROMPT_TEXT, DEFAULT_CHECKED_ACTION_IDS, LABELS,
    FAST_MODE_KEY, SHOW_EXTENSION_KEY, STRINGS, actionShowArchived, findOpenEmailSender, formatElapsedMs, h,
    applyElPosition, installUndoOfferListeners, makeDraggable,
    renderNextEmailTargetSection, safeStorageGet, safeStorageSet, setLog, sleep, state } = GC;

  let proceedConfirmationResolver = null;
  let proceedAutoCountdownTimer = null;
  let focusBeforeConfirm = null;
  const toastQueue = [];
  let toastQueueActive = false;
  /** Shows a success message in the status area. */
  function flashSuccess(message = STRINGS.ui.completed) {
    showToast(message, { type: "success" });
  }

  /** Shows an error in the status area (and the console log). */
  function reportError(message) {
    setLog(message);
    showToast(message, { type: "error", durationMs: 5000 });
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
      toast.dataset.type = next.type;
      // Errors interrupt screen readers; everything else waits politely.
      toast.setAttribute("role", next.type === "error" ? "alert" : "status");
      toast.classList.add("gc-toast-visible");
      await sleep(next.durationMs);
      toast.classList.remove("gc-toast-visible");
      await sleep(140);
    }

    toastQueueActive = false;
  }

  /**
   * Queues a message for the status area. options.type is "info" (default),
   * "success", "warning" or "error".
   */
  function showToast(message, options = {}) {
    const durationMs = options.durationMs || 2400;
    const type = options.type || "info";
    const toast = document.getElementById("gc-toast");
    if (!toast) return;
    toastQueue.push({ message, durationMs, type });
    void flushToastQueue();
  }

  /** Runs with elapsed toast. */
  async function runWithElapsedToast(label, runner) {
    const start = performance.now();
    try {
      await runner();
    } finally {
      const elapsed = performance.now() - start;
      showToast(STRINGS.toast.elapsed(label, formatElapsedMs(elapsed)));
    }
  }

  /** Handles hide proceed confirmation. */
  function hideProceedConfirmation() {
    stopProceedAutoCountdown();
    const box = document.getElementById("gc-confirm");
    if (!box) return;
    box.classList.remove("gc-confirm-visible", "gc-confirm-danger");
    const stopBtn = document.getElementById("gc-confirm-stop");
    if (stopBtn) stopBtn.textContent = STRINGS.ui.stop;
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
    setProceedButtonLabel(STRINGS.ui.proceed);
  }

  /** Starts auto proceed countdown. */
  function startProceedAutoCountdown(seconds = AUTO_PROCEED_SECONDS) {
    stopProceedAutoCountdown();
    let remainingSeconds = Math.max(1, Number.parseInt(String(seconds ?? ""), 10) || AUTO_PROCEED_SECONDS);
    setProceedButtonLabel(STRINGS.ui.proceedCountdown(remainingSeconds));
    proceedAutoCountdownTimer = setInterval(() => {
      remainingSeconds -= 1;
      if (remainingSeconds <= 0) {
        stopProceedAutoCountdown();
        if (proceedConfirmationResolver) {
          resolveProceedConfirmation(true);
        }
        return;
      }
      setProceedButtonLabel(STRINGS.ui.proceedCountdown(remainingSeconds));
    }, 1000);
  }

  /** Resolves proceed confirmation. */
  function resolveProceedConfirmation(result) {
    const resolver = proceedConfirmationResolver;
    proceedConfirmationResolver = null;
    const box = document.getElementById("gc-confirm");
    const focusWasInPrompt = !!box && box.contains(document.activeElement);
    hideProceedConfirmation();
    // Give focus back to where it was (if it is still on the page).
    if (focusWasInPrompt && focusBeforeConfirm?.isConnected) focusBeforeConfirm.focus({ preventScroll: true });
    focusBeforeConfirm = null;
    if (resolver) resolver(result);
  }

  /**
   * Escape inside the panel cancels an open confirmation prompt (same as Stop /
   * Cancel). Focus is moved into the prompt when it opens, so this covers the
   * normal keyboard flow without intercepting Escape elsewhere in Gmail.
   */
  function installConfirmEscapeListener(root) {
    root.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || !proceedConfirmationResolver) return;
      // Keep Gmail from also handling this Escape (e.g. closing the open thread).
      event.preventDefault();
      event.stopPropagation();
      resolveProceedConfirmation(false);
    });
  }

  /** Handles ask proceed confirmation. */
  function askProceedConfirmation(message, options = {}) {
    const box = document.getElementById("gc-confirm");
    const messageEl = document.getElementById("gc-confirm-message");
    if (!box || !messageEl) return Promise.resolve(false);

    if (proceedConfirmationResolver) {
      resolveProceedConfirmation(false);
    }

    const autoProceed = !!options.autoProceed || String(message || "").includes(AUTO_PROCEED_UNSUBSCRIBE_PROMPT_TEXT);
    // Fast mode: prompts that would auto-proceed after a countdown proceed at once.
    // Prompts that never auto-proceed (e.g. Delete) are always shown.
    if (autoProceed && state.fastMode) {
      setLog(`Fast mode: auto-proceeding. ${message}`);
      showToast(STRINGS.toast.fastModeProceeded);
      return Promise.resolve(true);
    }

    messageEl.textContent = message;
    box.classList.toggle("gc-confirm-danger", !!options.proceedLabel);
    box.classList.add("gc-confirm-visible");
    if (autoProceed) {
      startProceedAutoCountdown(AUTO_PROCEED_SECONDS);
    } else {
      stopProceedAutoCountdown();
    }
    // Custom labels (e.g. Delete / Cancel); reset to Proceed / Stop on hide.
    if (options.proceedLabel) setProceedButtonLabel(options.proceedLabel);
    const stopBtn = document.getElementById("gc-confirm-stop");
    if (stopBtn) stopBtn.textContent = options.stopLabel || STRINGS.ui.stop;

    // Move focus to the prompt; destructive prompts default to the safe choice.
    const active = document.activeElement;
    focusBeforeConfirm = active && active !== document.body ? active : null;
    const focusTarget = options.proceedLabel ? stopBtn : document.getElementById("gc-confirm-proceed");
    focusTarget?.focus({ preventScroll: true });

    return new Promise((resolve) => {
      proceedConfirmationResolver = resolve;
    });
  }

  /** Sets working. Clears any step / progress text when work ends. */
  function setWorking(next) {
    state.working = next;
    if (!next) {
      setWorkingStep("");
      setProgress("");
    }
    refreshControlStates();
  }

  /**
   * Shows which Execute Selected step is running ("Step 2/4: ...") and highlights
   * that action's row. Empty text restores the plain "Working..." label.
   */
  function setWorkingStep(text, actionId = "") {
    const label = document.querySelector("#gc-working .gc-working-text");
    if (label) label.textContent = text || STRINGS.ui.working;
    document.querySelectorAll(".gc-action-row.gc-row-active").forEach((row) => row.classList.remove("gc-row-active"));
    if (actionId) document.getElementById(actionId)?.closest(".gc-action-row")?.classList.add("gc-row-active");
  }

  /** Shows a live progress line under the working label (e.g. "Page 3 · 150 archived"). */
  function setProgress(text) {
    const detail = document.querySelector("#gc-working .gc-working-detail");
    if (!detail) return;
    detail.textContent = text || "";
    detail.classList.toggle("gc-hidden", !text);
  }

  /** Refreshes all control enabled/disabled states based on current working and email-open state. */
  function refreshControlStates() {
    const emailOpen = !!state.openSender;
    const working = state.working;
    const noEmailExempt = new Set([ACTION_BUTTON_IDS.GO_TO_INBOX, "gc-show-archived"]);

    document.querySelectorAll(".gc-btn").forEach((btn) => {
      if (working) {
        btn.disabled = true;
      } else if (!emailOpen) {
        btn.disabled = !noEmailExempt.has(btn.id);
      } else {
        btn.disabled = false;
      }
    });

    document.querySelectorAll(".gc-action-checkbox").forEach((checkbox) => {
      checkbox.disabled = working || !emailOpen;
    });

    document.getElementById("gc-root")?.classList.toggle("gc-is-working", working);
    renderContextBar();

    const workingEl = document.getElementById("gc-working");
    if (workingEl) {
      workingEl.classList.toggle("gc-working-visible", working);
      workingEl.setAttribute("aria-hidden", working ? "false" : "true");
    }

    updateExecuteSelectedState();
  }

  /**
   * Shows the detected sender (the target of every sender-based action) so it can be
   * checked before running anything, or explains why actions are disabled.
   */
  function renderContextBar() {
    const bar = document.getElementById("gc-context");
    if (!bar) return;
    const sender = state.openSender;
    // Only rewrite on change: main.js re-runs this from a childList MutationObserver.
    if (bar.dataset.sender === sender && bar.firstChild) return;
    bar.dataset.sender = sender;
    bar.classList.toggle("gc-context-sender", !!sender);
    if (!sender) {
      bar.textContent = STRINGS.ui.openEmailHint;
      bar.removeAttribute("title");
      return;
    }
    bar.replaceChildren(
      h("span", { class: "gc-context-label" }, STRINGS.ui.senderLabel),
      h("span", { class: "gc-context-value" }, sender)
    );
    bar.title = sender;
  }

  /** Parses a computed "rgb()/rgba()" color; returns null for transparent or unknown. */
  function parseOpaqueColor(value) {
    const match = String(value || "").match(/rgba?\(([^)]+)\)/);
    if (!match) return null;
    const [r, g, b, a = 1] = match[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    if ([r, g, b, a].some((n) => Number.isNaN(n)) || a < 0.5) return null;
    return { r, g, b };
  }

  /** Returns the first opaque background color at or above el, or null. */
  function findBackgroundColor(el) {
    for (let node = el; node && node.nodeType === Node.ELEMENT_NODE; node = node.parentElement) {
      const color = parseOpaqueColor(getComputedStyle(node).backgroundColor);
      if (color) return color;
    }
    return null;
  }

  /**
   * Returns "dark" or "light", following Gmail's own theme. The OS setting is not
   * used: Gmail's theme is independent of it, and with no opaque background up to
   * <html> the page shows the browser's white canvas, so that counts as light.
   */
  function detectGmailTheme() {
    const color = findBackgroundColor(document.querySelector("[role='main']")) ||
      findBackgroundColor(document.body);
    if (!color) return "light";
    const luminance = (0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b) / 255;
    return luminance < 0.4 ? "dark" : "light";
  }

  /** Applies the detected theme to the sidebar (attribute only: not seen by the childList observer). */
  function applyTheme() {
    const root = document.getElementById("gc-root");
    if (!root) return;
    const theme = detectGmailTheme();
    if (root.dataset.gcTheme !== theme) root.dataset.gcTheme = theme;
  }

  /** Detects current email open state and refreshes controls. No-op while action in progress. */
  function refreshOpenEmailState() {
    applyTheme();
    if (state.working) return;
    findOpenEmailSender();
    refreshControlStates();
  }

  /** Returns selected action ids. */
  function getSelectedActionIds() {
    return [...document.querySelectorAll(".gc-action-checkbox:checked")]
      // A delete option hidden by the popup toggle never runs (the sidebar itself
      // may be hidden while Execute Selected runs from a shortcut, so check the row only).
      .filter((checkbox) => !checkbox.closest(".gc-delete-row.gc-hidden"))
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
      const stored = result[ACTION_CHECKBOX_STATE_KEY];
      const hasSaved = !!stored && typeof stored === "object";
      const saved = hasSaved ? stored : {};

      document.querySelectorAll(".gc-action-checkbox").forEach((checkbox) => {
        const actionId = checkbox.getAttribute("data-action-id") || "";
        if (!actionId) return;
        checkbox.checked = actionId in saved ? saved[actionId] === true : DEFAULT_CHECKED_ACTION_IDS.has(actionId);
      });
      if (!hasSaved) persistActionCheckboxState();
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
    // Execute and Stop share one slot: Stop replaces Execute while a batch runs.
    executeButton.classList.toggle("gc-hidden", state.batchExecuting);
    if (stopButton) {
      stopButton.disabled = !state.batchExecuting;
      stopButton.classList.toggle("gc-hidden", !state.batchExecuting);
    }
  }

  /** Returns a button's label text, ignoring any shortcut hint span. */
  function getButtonLabel(el, fallback = STRINGS.ui.actionFallback) {
    if (!el) return fallback;
    if (el.dataset?.label) return el.dataset.label;
    const text = [...el.childNodes]
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent)
      .join("")
      .trim();
    return text || fallback;
  }

  /** Applies the Fast mode setting and shows / hides the header badge. */
  function setFastMode(enabled) {
    state.fastMode = !!enabled;
    document.getElementById("gc-fast-badge")?.classList.toggle("gc-hidden", !state.fastMode);
  }

  /** Reads the Fast mode setting from storage. */
  function syncFastModeFromStorage() {
    safeStorageGet([FAST_MODE_KEY], (result) => setFastMode(result?.[FAST_MODE_KEY] === true));
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

  /** Builds the floating toggle button. */
  function buildToggle() {
    // Icon-only by default so it covers less of Gmail; the label slides out on hover/focus.
    return h(
      "button",
      { id: "gc-toggle", type: "button", "aria-label": STRINGS.ui.toggle, title: STRINGS.ui.toggle },
      h("span", { id: "gc-toggle-grip", "aria-hidden": "true" }, "\u283f"),
      h("span", { class: "gc-toggle-icon", "aria-hidden": "true" }, "\u2709"),
      h("span", { class: "gc-toggle-label", "aria-hidden": "true" }, STRINGS.ui.toggle)
    );
  }

  /**
   * Lets a checked radio be cleared by clicking it again (native radios cannot be
   * unchecked, so a chosen archive/inbox option could otherwise never be turned off).
   * The pre-click state is captured on mousedown / Space keydown, before the browser
   * applies the click.
   */
  function installRadioDeselect(row, input) {
    let wasChecked = false;
    const capture = () => {
      wasChecked = input.checked;
    };
    row.addEventListener("mousedown", capture, true);
    row.addEventListener("keydown", (event) => {
      if (event.key === " ") capture();
    }, true);
    input.addEventListener("click", () => {
      if (!wasChecked) return;
      wasChecked = false;
      input.checked = false;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  /**
   * Builds one checkbox/radio + button action row. fullLabel (default: label) names
   * the action in toasts, tooltips and screen readers when the visible label is short.
   */
  function buildActionRow(actionId, label, inputType = "checkbox", radioName = null, fullLabel = label) {
    const input = h("input", {
      class: "gc-action-checkbox",
      type: inputType,
      name: radioName,
      "data-action-id": actionId,
      "aria-label": STRINGS.ui.selectActionAria(fullLabel)
    });
    const short = fullLabel !== label;
    const button = h("button", {
      class: "gc-btn",
      id: actionId,
      "data-label": short ? fullLabel : null,
      "aria-label": short ? fullLabel : null
    }, label);
    // The wrapping label enlarges the click target beyond the 16px input.
    const check = h("label", { class: "gc-action-check" }, input);
    const row = h("div", { class: "gc-action-row" }, check, button);
    if (inputType === "radio") installRadioDeselect(row, input);
    return row;
  }

  /**
   * Builds a compact "Archive: [This page] [All pages]" row. Both options share the
   * gc-archive-mode radio group. Delete rows are hidden until enabled in the popup.
   */
  function buildScopeRow(kind, thisPage, allPages) {
    const ui = STRINGS.ui;
    const isDelete = kind === "delete";
    const options = [[thisPage, ui.scopeThisPage], [allPages, ui.scopeAllPages]].map(([[id, fullLabel], label]) => {
      const row = buildActionRow(id, label, "radio", "gc-archive-mode", fullLabel);
      if (isDelete) {
        row.classList.add("gc-delete-row", "gc-hidden");
        row.querySelector(".gc-btn")?.classList.add("gc-btn-danger");
      }
      return row;
    });
    return h(
      "div",
      { class: `gc-scope-row${isDelete ? " gc-delete-group gc-hidden" : ""}`, role: "group",
        "aria-label": isDelete ? ui.scopeDelete : ui.scopeArchive },
      h("span", { class: "gc-scope-label", "aria-hidden": "true" }, isDelete ? ui.scopeDelete : ui.scopeArchive),
      options
    );
  }

  /** Builds the one-line "Next: sender – subject" preview for Go to Next Email. */
  function buildNextTargetSection() {
    return h(
      "div",
      { id: "gc-next-target-section", class: "gc-next-target gc-hidden" },
      h("span", { class: "gc-next-target-label" }, STRINGS.ui.nextTargetLabel),
      h("span", { id: "gc-next-target-summary-text", class: "gc-next-target-summary" }, STRINGS.ui.notCached)
    );
  }

  /** Builds the sidebar root (same ids/classes/structure styles.css expects). */
  function buildSidebarRoot() {
    const ui = STRINGS.ui;
    const root = h("aside", { id: "gc-root", class: "gc-hidden" });
    root.append(
      h(
        "div",
        { id: "gc-header" },
        h("span", { id: "gc-drag-handle", "aria-hidden": "true" }, "\u283f"),
        h(
          "button",
          { type: "button", id: "gc-minimize", title: ui.minimizeTitle, "aria-label": ui.minimizeAria },
          "\u2013"
        ),
        h("p", { id: "gc-title" }, ui.title),
        h(
          "p",
          { id: "gc-fast-badge", class: "gc-hidden", title: ui.fastModeBadgeTitle },
          "\u26a1 ",
          ui.fastModeBadge
        )
      ),
      h(
        "div",
        { id: "gc-working", "aria-live": "polite", "aria-hidden": "true" },
        h("span", { class: "gc-working-spinner", "aria-hidden": "true" }),
        h(
          "span",
          { class: "gc-working-lines" },
          h("span", { class: "gc-working-text" }, ui.working),
          h("span", { class: "gc-working-detail gc-hidden" })
        )
      ),
      h(
        "div",
        { id: "gc-body" },
        h("p", { id: "gc-context", "aria-live": "polite" }),
        h(
          "div",
          { class: "gc-section gc-section-prepare" },
          h("p", { class: "gc-section-title" }, ui.sectionPrepare),
          buildActionRow(ACTION_BUTTON_IDS.UNSUBSCRIBE, LABELS.UNSUBSCRIBE_OPEN_EMAIL),
          buildActionRow(ACTION_BUTTON_IDS.SELECT_LIKE_OPEN, LABELS.SELECT_LIKE_OPEN_EMAIL)
        ),
        h(
          "div",
          { class: "gc-section gc-section-archive" },
          h("p", { class: "gc-section-title", id: "gc-archive-section-title" }, ui.sectionArchive),
          buildScopeRow("archive",
            [ACTION_BUTTON_IDS.ARCHIVE_THIS_PAGE, LABELS.ARCHIVE_THIS_PAGE],
            [ACTION_BUTTON_IDS.ARCHIVE_ALL_PAGES, LABELS.ARCHIVE_ALL_PAGES]),
          // Opt-in (popup toggle); hidden rows are never selected (see getSelectedActionIds).
          buildScopeRow("delete",
            [ACTION_BUTTON_IDS.DELETE_THIS_PAGE, LABELS.DELETE_THIS_PAGE],
            [ACTION_BUTTON_IDS.DELETE_ALL_PAGES, LABELS.DELETE_ALL_PAGES])
        ),
        h(
          "div",
          { class: "gc-section gc-section-inbox" },
          h("p", { class: "gc-section-title" }, ui.sectionInbox),
          buildActionRow(ACTION_BUTTON_IDS.GO_TO_INBOX, LABELS.GO_TO_INBOX, "radio", "gc-inbox-mode"),
          buildActionRow(ACTION_BUTTON_IDS.GO_TO_NEXT_PAGE, LABELS.GO_TO_NEXT_PAGE, "radio", "gc-inbox-mode"),
          buildNextTargetSection(),
          h(
            "div",
            { class: "gc-action-row", style: "display:flex;justify-content:center;" },
            h(
              "button",
              { class: "gc-btn", id: "gc-show-archived", style: "width:100%;text-align:center;" },
              ui.showArchived
            )
          )
        ),
        // Shortcut hint spans/titles are added by applyShortcutHints().
        h(
          "button",
          { class: "gc-btn gc-btn-execute", id: "gc-execute-selected", "data-ready": "false", disabled: true },
          ui.executeSelected
        ),
        h("button", { class: "gc-btn gc-btn-stop gc-hidden", id: "gc-stop-execution", disabled: true }, ui.stopExecution)
      ),
      // Single status area: confirmation prompts, messages and undo offers.
      h(
        "div",
        { id: "gc-status" },
        h(
          "div",
          { id: "gc-confirm", role: "alert", "aria-live": "assertive" },
          h("p", { id: "gc-confirm-message" }),
          h(
            "div",
            { id: "gc-confirm-actions" },
            h("button", { type: "button", id: "gc-confirm-proceed" }, ui.proceed),
            h("button", { type: "button", id: "gc-confirm-stop" }, ui.stop)
          )
        ),
        h("div", { id: "gc-toast", role: "status", "aria-live": "polite", "data-type": "info" }),
        h(
          "div",
          { id: "gc-undo", role: "status", "aria-live": "polite" },
          h("span", { id: "gc-undo-message" }),
          h("button", { type: "button", id: "gc-undo-action" }, ui.undoArchive),
          h("button", { type: "button", id: "gc-undo-dismiss", "aria-label": ui.undoDismissAria }, "\u00d7")
        )
      )
    );
    return root;
  }

  /**
   * Opens the panel anchored to the toggle: same right edge, vertically centred on
   * the toggle (which can be dragged up and down), clamped to the viewport.
   */
  function openPanelAtToggle(root, toggle) {
    // Measure the toggle before opening: the open panel hides it (gc-toggle-covered).
    const anchor = toggle.getBoundingClientRect();
    root.classList.remove("gc-hidden");
    const margin = 8;
    const centred = anchor.top + anchor.height / 2 - root.offsetHeight / 2;
    const maxTop = Math.max(margin, window.innerHeight - root.offsetHeight - margin);
    const top = Math.min(Math.max(centred, margin), maxTop);
    const left = anchor.right - root.offsetWidth;
    applyElPosition(root, top, left);
  }

  /** Mounts sidebar. */
  function mountSidebar() {
    if (state.extensionContextInvalidated) return;
    // Gmail print view (Print all / print thread) — never inject UI there.
    if (new URLSearchParams(location.search).get("view") === "pt") return;
    if (document.getElementById("gc-root") && document.getElementById("gc-toggle")) {
      renderNextEmailTargetSection();
      syncExtensionVisibilityFromStorage();
      return;
    }

    const toggle = buildToggle();
    document.body.appendChild(toggle);

    const root = buildSidebarRoot();
    document.body.appendChild(root);

    toggle.addEventListener("click", () => {
      if (root.classList.contains("gc-hidden")) {
        openPanelAtToggle(root, toggle);
      } else {
        root.classList.add("gc-hidden");
      }
    });
    // Hide the toggle while the panel is open (both sit at the right-middle edge).
    // Watching the class covers every path: toggle, minimize, popup hide setting.
    const syncToggleCovered = () => {
      toggle.classList.toggle("gc-toggle-covered", !root.classList.contains("gc-hidden"));
    };
    new MutationObserver(syncToggleCovered).observe(root, { attributes: true, attributeFilter: ["class"] });
    syncToggleCovered();

    document.getElementById("gc-minimize")?.addEventListener("click", () => {
      root.classList.add("gc-hidden");
    });

    Object.values(ACTION_BUTTON_IDS).forEach((buttonId) => {
      document.getElementById(buttonId)?.addEventListener("click", () => {
        const label = getButtonLabel(document.getElementById(buttonId));
        void runWithElapsedToast(label, async () => {
          await GC.runActionByButtonId(buttonId);
        });
      });
    });

    document.getElementById("gc-show-archived")?.addEventListener("click", () => {
      void runWithElapsedToast(STRINGS.ui.showArchived, async () => {
        await actionShowArchived();
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
      GC.triggerExecuteSelected();
    });
    document.getElementById("gc-stop-execution")?.addEventListener("click", () => {
      void runWithElapsedToast(STRINGS.ui.stopExecution, async () => {
        GC.requestStopExecution();
      });
    });
    document.getElementById("gc-confirm-proceed")?.addEventListener("click", () => {
      resolveProceedConfirmation(true);
    });
    document.getElementById("gc-confirm-stop")?.addEventListener("click", () => {
      resolveProceedConfirmation(false);
    });
    installUndoOfferListeners();
    installConfirmEscapeListener(root);
    GC.syncDeleteFeatureFromStorage();
    syncFastModeFromStorage();
    restoreActionCheckboxState();
    GC.loadShortcutHints();
    renderNextEmailTargetSection();
    findOpenEmailSender();
    refreshControlStates();
    applyTheme();

    makeDraggable(toggle, null, null, "y");
    // No saved position: the panel always opens next to the toggle (openPanelAtToggle).
    makeDraggable(root, null, document.getElementById("gc-header"));

    setLog(`Ready. Open an email, then click '${LABELS.SELECT_LIKE_OPEN_EMAIL}'.`);
    syncExtensionVisibilityFromStorage();
  }

  Object.assign(GC, { applyTheme, askProceedConfirmation, detectGmailTheme, buildActionRow, buildNextTargetSection, buildScopeRow, buildSidebarRoot,
    buildToggle, flashSuccess, flushToastQueue, getButtonLabel, getSelectedActionIds,
    hideProceedConfirmation, isActionChecked, mountSidebar, persistActionCheckboxState, refreshControlStates,
    refreshOpenEmailState, renderContextBar, reportError, resolveProceedConfirmation, restoreActionCheckboxState, runWithElapsedToast,
    setExtensionVisibility, setFastMode, setProceedButtonLabel, setProgress, setWorking, setWorkingStep, showToast, startProceedAutoCountdown,
    stopProceedAutoCountdown, syncExtensionVisibilityFromStorage, toastQueue,
    updateExecuteSelectedState });
})();
