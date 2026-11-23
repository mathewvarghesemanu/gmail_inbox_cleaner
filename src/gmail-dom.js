// Readers for Gmail's list rows, open thread, toolbar and pagination.
(() => {
  const GC = window.__gc;
  if (!GC || GC.skipLoad) return;

  const { GMAIL_TEXT, SELECTORS, buildMessageSignature, findCurrentRowIndex, firstAttr, firstText,
    getListContextHashFromHash, getThreadTokenFromHash, isDisabledControl, isVisible, normalizeEmail,
    normalizeFingerprintText, queryFirst, robustClick, sleep, state, waitFor, waitForSelector } = GC;

  /** Returns open thread root. */
  function getOpenThreadRoot() {
    const main = document.querySelector(SELECTORS.main);
    if (!main) return null;
    const hasOpenThread = !!main.querySelector(SELECTORS.openThreadHeading);
    if (!hasOpenThread) return null;
    return main;
  }

  /** Finds open email sender. */
  function findOpenEmailSender() {
    const threadRoot = getOpenThreadRoot();
    if (!threadRoot) {
      state.openSender = "";
      console.log("[GmailCleaner] Step 4 sender-only", {
        senderOnly: "",
        hasOpenThreadRoot: false
      });
      return "";
    }

    const openSender = firstAttr(threadRoot, SELECTORS.openSenderEmail, "email") || "";

    state.openSender = openSender;
    console.log("[GmailCleaner] Step 4 sender-only", {
      senderOnly: normalizeEmail(openSender || ""),
      hasOpenThreadRoot: true
    });
    return openSender;
  }

  /** Returns thread rows. */
  function getThreadRows() {
    const candidates = [
      ...document.querySelectorAll(SELECTORS.threadRows)
    ];

    const uniqueRows = [...new Set(candidates)];
    return uniqueRows.filter((row) => {
      if (!isVisible(row)) return false;
      const main = row.closest(SELECTORS.main);
      if (!main || !isVisible(main)) return false;
      const tabPanel = row.closest(SELECTORS.tabPanel);
      if (tabPanel && !isVisible(tabPanel)) return false;
      const hasSender = !!row.querySelector(SELECTORS.rowSenderPresence);
      const hasSubjectOrPreview = !!row.querySelector(SELECTORS.rowSubjectOrPreview);
      return hasSender && hasSubjectOrPreview;
    });
  }

  /** Waits for thread rows. */
  async function waitForThreadRows(timeout = 12000) {
    const rows = await waitFor(() => {
      const found = getThreadRows();
      return found.length > 0 ? found : null;
    }, { timeout, interval: 140, shouldAbort: GC.shouldStopExecution });
    return rows || [];
  }

  /** Handles row to item. */
  function rowToItem(row) {
    const sender =
      firstAttr(row, SELECTORS.rowSenderSpan, "email") ||
      firstText(row, SELECTORS.rowSenderSpan) ||
      "Unknown sender";
    const subject = firstText(row, SELECTORS.rowSubject) || "(No subject)";
    return { sender, subject };
  }

  /** Renders list. */
  function renderList(items, title = "Email list") {
    void items;
    void title;
  }

  /** Finds next page button. */
  function findNextPageButton() {
    const controls = [
      ...document.querySelectorAll(SELECTORS.buttons)
    ];

    const byText = controls.find((el) => {
      if (!isVisible(el)) return false;
      if (isDisabledControl(el)) return false;
      const aria = (el.getAttribute("aria-label") || "").toLowerCase();
      const tooltip = (el.getAttribute("data-tooltip") || "").toLowerCase();
      const title = (el.getAttribute("title") || "").toLowerCase();
      const signal = `${aria} ${tooltip} ${title}`;

      // Gmail usually labels this as "Older" (next page), but keep a next-page fallback.
      const looksLikeNext =
        GMAIL_TEXT.olderSignals.some((needle) => signal.includes(needle)) ||
        signal === GMAIL_TEXT.nextExact;
      if (!looksLikeNext) return false;

      // Avoid the tiny calendar/date picker arrows.
      if (el.closest(SELECTORS.dialog)) return false;
      return true;
    });
    if (byText) return byText;

    // Locale-independent fallbacks (non-English Gmail): Older button class, then the
    // last button of the pager group ("Newer", "Older").
    /** Checks whether usable pager control. */
    const usable = (el) => !!el && isVisible(el) && !isDisabledControl(el) && !el.closest(SELECTORS.dialog);
    const byClass = [...document.querySelectorAll(SELECTORS.olderButtonClass)].find(usable);
    if (byClass) return byClass;
    const pagerButtons = [...document.querySelectorAll(SELECTORS.pagerButtons)].filter((el) => isVisible(el));
    const lastPager = pagerButtons[pagerButtons.length - 1];
    return pagerButtons.length >= 2 && usable(lastPager) ? lastPager : null;
  }

  /** Returns first row fingerprint. */
  function getFirstRowFingerprint() {
    const row = getThreadRows()[0];
    if (!row) return "";
    const threadId =
      row.getAttribute("data-legacy-thread-id") ||
      firstAttr(row, SELECTORS.rowLegacyThreadId, "data-legacy-thread-id") ||
      "";
    const sender = firstAttr(row, SELECTORS.rowSenderSpan, "email");
    const subject = firstText(row, SELECTORS.rowSubject);
    return `${threadId}|${sender}|${subject}`;
  }

  /** Waits for page change. */
  async function waitForPageChange(previousFingerprint, timeout = 12000) {
    const changed = await waitFor(() => {
      const currentFingerprint = getFirstRowFingerprint();
      const rows = getThreadRows();
      if (rows.length === 0) return true;
      return !!(currentFingerprint && currentFingerprint !== previousFingerprint);
    }, { timeout, interval: 250, shouldAbort: GC.shouldStopExecution });
    return !!changed;
  }

  /** Navigates next results page. */
  async function goToNextResultsPage() {
    if (GC.shouldStopExecution()) return false;
    const nextButton = findNextPageButton();
    if (!nextButton) return false;
    const before = getFirstRowFingerprint();
    robustClick(nextButton);
    // Wait until the new page's rows render (a transient empty list is not enough).
    await waitFor(() => {
      const fingerprint = getFirstRowFingerprint();
      return !!(fingerprint && fingerprint !== before);
    }, { timeout: 500, interval: 50, shouldAbort: GC.shouldStopExecution });
    if (GC.shouldStopExecution()) return false;
    const moved = await waitForPageChange(before, 12000);
    if (moved) {
      await waitForSelector(SELECTORS.listViewReady, 12000);
      await sleep(350);
    }
    return moved;
  }

  /** Returns row sender email. */
  function getRowSenderEmail(row) {
    return normalizeEmail(
      firstAttr(row, SELECTORS.rowSenderEmailAttr, "email") ||
      firstText(row, SELECTORS.rowSenderText) ||
      ""
    );
  }

  /** Returns thread url from row. */
  function getThreadUrlFromRow(row) {
    const threadId = (
      row.getAttribute("data-legacy-thread-id") ||
      firstAttr(row, SELECTORS.rowLegacyThreadId, "data-legacy-thread-id") ||
      ""
    )
      .trim()
      .toLowerCase();
    const currentHash = String(location.hash || "").toLowerCase();
    const contextPrefix = currentHash.startsWith("#label/")
      ? currentHash.split("/").slice(0, 2).join("/")
      : currentHash.startsWith("#category/")
        ? currentHash.split("/").slice(0, 2).join("/")
        : currentHash.startsWith("#all")
          ? "#all"
          : "#inbox";

    /** Handles looks like thread hash. */
    const looksLikeThreadHash = (hash) =>
      /^#(?:inbox|all|label\/[^/]+|category\/[^/]+)\/[^/?#]+/i.test(hash || "");

    const anchors = [...row.querySelectorAll(SELECTORS.anchorsWithHref)];
    for (const anchor of anchors) {
      const href = anchor.getAttribute("href") || "";
      if (!href.includes("#")) continue;
      let resolved = "";
      let resolvedHash = "";
      try {
        const url = new URL(href, location.href);
        resolved = url.toString();
        resolvedHash = url.hash || "";
      } catch (_) {
        continue;
      }

      // Only accept real thread hashes, not list/navigation hashes.
      if (!looksLikeThreadHash(resolvedHash)) continue;

      // Prefer links that explicitly include row thread id when available.
      if (threadId && !resolvedHash.toLowerCase().includes(threadId)) {
        continue;
      }

      return resolved;
    }

    // Fallback: build a thread URL from row thread id and current mailbox context.
    if (threadId) {
      return `${location.origin}${location.pathname}${contextPrefix}/${threadId}`;
    }

    return "";
  }

  /** Returns open thread legacy id. */
  function getOpenThreadLegacyId() {
    return normalizeFingerprintText(
      firstAttr(document, SELECTORS.openThreadLegacyId, "data-legacy-thread-id") || ""
    );
  }

  /** Returns open thread url token. */
  function getOpenThreadUrlToken() {
    return getThreadTokenFromHash(location.hash || "");
  }

  /** Returns current list context hash. */
  function getCurrentListContextHash() {
    return getListContextHashFromHash(location.hash || "");
  }

  /** Returns row thread url token. */
  function getRowThreadUrlToken(row) {
    const url = getThreadUrlFromRow(row);
    if (!url) return "";
    try {
      const parsed = new URL(url, location.href);
      return getThreadTokenFromHash(parsed.hash || "");
    } catch (_) {
      return getThreadTokenFromHash(url);
    }
  }

  /** Returns row thread legacy id. */
  function getRowThreadLegacyId(row) {
    return normalizeFingerprintText(
      row.getAttribute("data-legacy-thread-id") ||
      firstAttr(row, SELECTORS.rowLegacyThreadId, "data-legacy-thread-id") ||
      ""
    );
  }

  /** Returns open email subject. */
  function getOpenEmailSubject() {
    const threadRoot = getOpenThreadRoot();
    if (!threadRoot) return "";
    return firstText(threadRoot, SELECTORS.openThreadSubject) || "";
  }

  /** Returns open email heading. */
  function getOpenEmailHeading() {
    const threadRoot = getOpenThreadRoot();
    if (!threadRoot) return "";
    return (
      firstAttr(threadRoot, SELECTORS.openSenderName, "name") ||
      firstText(threadRoot, SELECTORS.openSenderNameText) ||
      ""
    );
  }

  /** Returns open email date text. */
  function getOpenEmailDateText() {
    const threadRoot = getOpenThreadRoot();
    if (!threadRoot) return "";
    const candidates = [
      ...threadRoot.querySelectorAll(SELECTORS.openDateCandidates)
    ]
      .filter((el) => isVisible(el) && !el.closest(SELECTORS.anyRow))
      .map((el) => (el.getAttribute("datetime") || el.getAttribute("title") || el.textContent || "").trim())
      .filter(Boolean)
      .sort((a, b) => b.length - a.length);
    return candidates[0] || "";
  }

  /** Returns open email fingerprint. */
  function getOpenEmailFingerprint() {
    const signature = buildMessageSignature({
      sender: findOpenEmailSender(),
      subject: getOpenEmailSubject(),
      heading: getOpenEmailHeading(),
      dateText: getOpenEmailDateText()
    });
    signature.threadId = getOpenThreadLegacyId();
    signature.threadToken = getOpenThreadUrlToken();
    console.log("[GmailCleaner] Email signature", signature);
    return signature;
  }

  /** Returns row heading text. */
  function getRowHeadingText(row) {
    return (
      firstAttr(row, SELECTORS.rowSenderNameAttr, "name") ||
      firstText(row, SELECTORS.rowSenderNameText) ||
      ""
    );
  }

  /** Returns row subject text. */
  function getRowSubjectText(row) {
    const subject = firstText(row, SELECTORS.rowSubjectText);
    const preview = firstText(row, SELECTORS.rowPreview);
    return `${subject} ${preview}`.trim();
  }

  /** Returns row date text. */
  function getRowDateText(row) {
    return (
      firstAttr(row, SELECTORS.rowDateTitled, "title") ||
      firstAttr(row, SELECTORS.rowDateLabeled, "aria-label") ||
      firstText(row, SELECTORS.rowDateShortText) ||
      ""
    );
  }

  /** Returns row fingerprint. */
  function getRowFingerprint(row) {
    return buildMessageSignature({
      sender: getRowSenderEmail(row),
      subject: getRowSubjectText(row),
      heading: getRowHeadingText(row),
      dateText: getRowDateText(row)
    });
  }

  /** Returns mailbox toolbar. */
  function getMailboxToolbar() {
    return queryFirst(document, SELECTORS.mailboxToolbar);
  }

  /** Returns row open control. */
  function getRowOpenControl(row) {
    return queryFirst(row, SELECTORS.rowOpenControl) || row;
  }


  /** Row accessors used by findCurrentRowIndex for live Gmail list rows. */
  const DOM_ROW_ACCESSORS = {
    threadToken: getRowThreadUrlToken,
    threadId: getRowThreadLegacyId,
    signature: getRowFingerprint
  };

  /** findCurrentRowIndex for live Gmail list rows (DOM elements). */
  function findCurrentRowIndexInDom(rows, emailSignature, options = {}) {
    return findCurrentRowIndex(rows, emailSignature, { rowAccessors: DOM_ROW_ACCESSORS, ...options });
  }

  Object.assign(GC, { DOM_ROW_ACCESSORS, findCurrentRowIndexInDom, findNextPageButton, findOpenEmailSender,
    getCurrentListContextHash, getFirstRowFingerprint, getMailboxToolbar, getOpenEmailDateText,
    getOpenEmailFingerprint, getOpenEmailHeading, getOpenEmailSubject, getOpenThreadLegacyId,
    getOpenThreadRoot, getOpenThreadUrlToken, getRowDateText, getRowFingerprint, getRowHeadingText,
    getRowOpenControl, getRowSenderEmail, getRowSubjectText, getRowThreadLegacyId, getRowThreadUrlToken,
    getThreadRows, getThreadUrlFromRow, goToNextResultsPage, renderList, rowToItem, waitForPageChange,
    waitForThreadRows });
})();
