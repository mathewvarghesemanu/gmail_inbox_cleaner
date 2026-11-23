// Selecting conversations (Select menu, master checkbox).
(() => {
  const GC = window.__gc;
  if (!GC || GC.skipLoad) return;

  const { GMAIL_TEXT, SELECTORS, dispatchMenuClickSequence, getMailboxToolbar, getThreadRows, isVisible,
    queryFirst, robustClick, sleep, state, triggerKeySequence, waitFor } = GC;

  /** Finds master checkbox. */
  function findMasterCheckbox(toolbar) {
    return queryFirst(toolbar, SELECTORS.masterCheckbox);
  }

  /** Finds select button. */
  function findSelectButton(toolbar) {
    const byText = [...toolbar.querySelectorAll(SELECTORS.buttons)].find((el) => {
      const aria = (el.getAttribute("aria-label") || "").toLowerCase();
      const tooltip = (el.getAttribute("data-tooltip") || "").toLowerCase();
      return isVisible(el) && (aria === GMAIL_TEXT.select || tooltip === GMAIL_TEXT.select);
    });
    if (byText) return byText;
    // Locale-independent fallback: the Select dropdown is the button wrapping the master checkbox.
    const wrapper = findMasterCheckbox(toolbar)?.closest(SELECTORS.roleButton);
    return wrapper && isVisible(wrapper) ? wrapper : undefined;
  }

  /** Finds all menu item. */
  function findAllMenuItem() {
    const direct = [...document.querySelectorAll(SELECTORS.menuItems)]
      .find((el) => {
        if (!isVisible(el)) return false;
        const selector = (el.getAttribute("selector") || "").toLowerCase();
        const text = (el.textContent || "").trim().toLowerCase();
        const aria = (el.getAttribute("aria-label") || "").trim().toLowerCase();
        return selector === GMAIL_TEXT.all || text === GMAIL_TEXT.all || aria === GMAIL_TEXT.all;
      });
    if (direct) return direct;

    const nestedLabel = [...document.querySelectorAll(SELECTORS.menuItemLabelInMenu)].find((el) => {
      if (!isVisible(el)) return false;
      return (el.textContent || "").trim().toLowerCase() === GMAIL_TEXT.all;
    });
    if (nestedLabel) return nestedLabel.closest(SELECTORS.menuItem) || nestedLabel;

    return null;
  }

  /** Checks whether master checked. */
  function isMasterChecked(toolbar) {
    return findMasterCheckbox(toolbar)?.getAttribute("aria-checked") === "true";
  }

  /** Finds open select menu. */
  function findOpenSelectMenu() {
    return [...document.querySelectorAll(SELECTORS.menu)].find((el) => isVisible(el)) || null;
  }

  /** Clicks all menu item. */
  async function clickAllMenuItem(allItem) {
    const label = allItem.querySelector(SELECTORS.menuItemLabel);
    robustClick(allItem);
    dispatchMenuClickSequence(allItem);
    if (label) {
      robustClick(label);
      dispatchMenuClickSequence(label);
    }
    await waitFor(() => isMasterChecked(getSelectionToolbar()), { timeout: 220, interval: 40 });
  }

  /** Returns the toolbar used for selection (mailbox toolbar, list container, or document). */
  function getSelectionToolbar() {
    return getMailboxToolbar() || document.querySelector(SELECTORS.threadListContainer) || document;
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
      await waitFor(() => findOpenSelectMenu() && findAllMenuItem(), { timeout: 260, interval: 40 });
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
      const inner = master?.querySelector(SELECTORS.masterCheckboxInner);
      if (inner) {
        robustClick(inner);
        // Gmail settle time: the master click below follows unconditionally.
        await sleep(220);
      }
      if (master) {
        robustClick(master);
        await waitFor(() => isMasterChecked(toolbar), { timeout: 280, interval: 40 });
      }
    }
    return findMasterCheckbox(toolbar)?.getAttribute("aria-checked") === "true";
  }

  /** Handles select all matching search. */
  async function selectAllMatchingSearch(options = {}) {
    const { includeAllInSearch = true } = options;
    const toolbar = getSelectionToolbar();
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
        await waitFor(() => isMasterChecked(toolbar), { timeout: 280, interval: 40 });
      }
    }
    void getSelectionDebugState;

    const selected = await ensureMasterChecked(toolbar, 8);
    if (!selected) {
      const menu = findOpenSelectMenu();
      if (menu) {
        menu.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
        menu.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", bubbles: true, cancelable: true }));
        await waitFor(() => isMasterChecked(toolbar), { timeout: 250, interval: 40 });
      }

      // Final fallback: Gmail keyboard shortcut for "select all" (requires shortcuts enabled).
      triggerKeySequence(["*", "a"]);
      await waitFor(() => isMasterChecked(toolbar), { timeout: 350, interval: 40 });
    }

    const selectedAfterFallback = isMasterChecked(toolbar) || await ensureMasterChecked(toolbar, 5);
    if (!selectedAfterFallback) {
      throw new Error("Could not check the master checkbox. Archive was skipped.");
    }

    const selectAllSearchLink = includeAllInSearch
      ? [...document.querySelectorAll(SELECTORS.anchors)].find((a) =>
      GMAIL_TEXT.selectAllInSearch.some((pattern) => pattern.test(a.textContent || ""))
    )
      : null;

    if (selectAllSearchLink) {
      robustClick(selectAllSearchLink);
      // No reliable DOM signal for "all in search" selection; give Gmail settle time.
      await sleep(500);
      state.selectedConversationsText = "All conversations in search selected.";
      return true;
    }

    state.selectedConversationsText = "Selected current page conversations.";
    return false;
  }

  /** Checks whether has any selected conversation row. */
  function isConversationRowSelected(row) {
    if ((row.getAttribute("aria-selected") || "").toLowerCase() === "true") return true;
    const rowCheckbox = row.querySelector(SELECTORS.rowCheckbox);
    return (rowCheckbox?.getAttribute("aria-checked") || "").toLowerCase() === "true";
  }

  function hasAnySelectedConversationRow() {
    const rows = getThreadRows();
    if (!rows.length) return false;
    return rows.some(isConversationRowSelected);
  }

  /** Best-effort count of conversations about to be archived on this page (for local stats). */
  function countSelectedConversationRows() {
    const rows = getThreadRows();
    const selected = rows.filter(isConversationRowSelected).length;
    return selected || rows.length;
  }

  /** Waits for selection to settle. */
  async function waitForSelectionToSettle(timeout = 5000) {
    const settled = await waitFor(
      () => isMasterChecked(getSelectionToolbar()) && hasAnySelectedConversationRow(),
      { timeout, interval: 150 }
    );
    if (!settled) return false;
    // Short settle so Gmail finishes applying the selection before archive.
    await GC.settle(180);
    return true;
  }

  Object.assign(GC, { clickAllMenuItem, countSelectedConversationRows, ensureMasterChecked, findAllMenuItem,
    findMasterCheckbox, findOpenSelectMenu, findSelectButton, getSelectionDebugState, getSelectionToolbar,
    hasAnySelectedConversationRow, isConversationRowSelected, isMasterChecked, selectAllMatchingSearch,
    tryClickAllMenuOption, waitForSelectionToSettle });
})();
