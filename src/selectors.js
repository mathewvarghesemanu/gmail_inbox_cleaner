// Gmail DOM selectors and English Gmail UI text, with locale notes.
(() => {
  const GC = window.__gc;
  if (!GC || GC.skipLoad) return;

  /**
   * Gmail DOM selectors, centralized so Gmail markup changes are fixed in one place.
   *
   * Conventions:
   * - A string is a single CSS selector (may be a comma list; DOM order wins).
   * - An array is an ordered fallback chain: the first selector that matches wins.
   *   Where Gmail's obfuscated class names (e.g. "Cq", "aqL", "T-Jo") are used they
   *   either refine a stable attribute (gh=, role=, data-*) that follows as the
   *   fallback, or are the only known hook and are marked as such.
   */
  const SELECTORS = {
    // Layout / containers
    main: "div[role='main']",
    tabPanel: "div[role='tabpanel']",
    dialog: "[role='dialog']",
    dialogs: "div[role='alertdialog'], div[role='dialog']",
    blockquote: "blockquote",
    /** Mailbox (list view) action toolbar. gh='mtb' is stable; ".Cq.aqL" only refines it. */
    mailboxToolbar: ["div.Cq.aqL[gh='mtb']", "div[gh='mtb']"],
    /** Thread-list container (gh attribute is stable). */
    threadListContainer: "div[gh='tl']",
    /** Signals that a list view (toolbar or at least one row) has rendered. */
    listViewReady: "div[gh='mtb'], tr.zA",
    /** Generic clickable controls. */
    buttons: "div[role='button'], span[role='button'], button",
    roleLinkOrButton: "[role='link'], [role='button']",
    roleButton: "[role='button']",
    anchors: "a",
    anchorsWithHref: "a[href]",

    // Search
    searchInput: ["input[name='q']", "input[aria-label='Search mail']"],
    /** Search refinement chips (class-only hook; data-query is the payload). */
    refinementChips: "div.Ii[data-query]",
    /** Sender shown in the search header card (class-only hook). */
    headerSenderCandidates: "div.bX div.c5.J-J5-Ji, div.bX div.dp div.dr div.Cz.J-J5-Ji.e",

    // Open thread
    openThreadHeading: "h2.hP, h2[data-thread-perm-id]",
    openThreadHeadingInMain: "div[role='main'] h2.hP, div[role='main'] h2[data-thread-perm-id]",
    openThreadSubject: ["h2.hP", "h2[data-thread-perm-id]"],
    openThreadLegacyId: [
      "div[role='main'] h2[data-legacy-thread-id]",
      "div[role='main'] [data-thread-perm-id][data-legacy-thread-id]"
    ],
    /** Sender header of the open message: span[email] carries the address. */
    openSenderEmail: ["h3.iw span[email]", "h3.iw .gD[email]", "h3.iw span[email][name]"],
    openSenderName: ["h3.iw span[email][name]"],
    openSenderNameText: ["h3.iw .gD", "h3.iw span[email]"],
    openDateCandidates: "time, span.g3, span[title]",

    // Thread list rows
    threadRows: "tr[role='row'][jscontroller='ZdOxDb'], tr.zA",
    anyRow: "tr.zA, tr[role='row']",
    rowSenderPresence: "span[email], span.yP[email]",
    rowSubjectOrPreview: "span.bog, span.bqe, span.y2, td.xW span",
    rowSenderEmailAttr: ["span[email]", "span.yP[email]", "span.zF[email]"],
    rowSenderText: ["span[email]", "span.yP", "span.zF"],
    rowSenderNameAttr: ["span[email][name]", "span.yP[name]", "span.zF[name]"],
    rowSenderNameText: ["span[email]", "span.yP, span.zF, span.bA4 span"],
    rowSenderSpan: "span[email]",
    rowSubject: "span.bog",
    rowSubjectText: ["span.bog", "span.bqe"],
    rowPreview: "span.y2",
    rowDateTitled: "td.xW span[title]",
    rowDateLabeled: "td.xW span[aria-label]",
    rowDateShortText: ["td.xW .bq3", "td.xW span"],
    rowLegacyThreadId: "[data-legacy-thread-id]",
    rowCheckbox: "[role='checkbox']",
    rowOpenControl: ["span.bog", "td.xY a[href*='#']", "a[href*='#']"],

    // Selection
    /** Master "select" checkbox; class variants first, most specific to least. */
    masterCheckbox: [
      "span.T-Jo.J-J5-Ji.T-Jo-auq.T-Jo-iAfbIe[role='checkbox']",
      "span.T-Jo.J-J5-Ji.T-Jo-auq[role='checkbox']",
      "span.T-Jo.J-J5-Ji[role='checkbox']",
      // Locale/class independent: the only checkbox inside the mailbox toolbar.
      "div[gh='mtb'] [role='checkbox']"
    ],
    masterCheckboxInner: ".T-Jo-auh[role='presentation']",
    menu: ".J-M[role='menu']",
    menuItems: ".J-M[role='menu'] .J-N, .J-M[role='menu'] [role='menuitem']",
    menuItemLabelInMenu: ".J-M[role='menu'] .J-N-Jz",
    menuItemLabel: ".J-N-Jz",
    menuItem: ".J-N",

    // Archive
    toolbarControls: "div[role='button'], button, span[role='button']",
    /** Gmail action id for Move to Inbox on toolbar buttons (locale independent). */
    moveToInboxAct: "8",

    // Archive undo / dry-run count
    /** The extension's own UI roots (never treated as Gmail controls). */
    ownUiRoots: "#gc-root, #gc-toggle",
    /** Gmail's notification-bar Undo link (id is locale independent). */
    gmailUndoLinkById: "#link_undo, [id^='link_undo']",
    gmailNotificationContainers: "[role='alert'], div.vh, div.b8",
    gmailNotificationActions: "[role='link'], [role='button'], a, span[idlink], span.ag",
    /** "1–50 of 1,234" range text in the mailbox toolbar (class-only hook). */
    resultRange: "span.Dj",
    resultRangeParts: ".ts",
    resultRangeFallbackNodes: "span, div",
    /** Gmail action id for Archive on toolbar buttons (locale independent). */
    archiveAct: "7",
    /** Gmail action id for Delete (move to Trash) on toolbar buttons (locale independent). */
    deleteAct: "10",

    // Pagination (locale-independent fallbacks used when "Older" text is not found)
    /** Pager group next to the "1–50 of N" counter; its last button is Older/next. */
    pagerButtons: ".Di [role='button']",
    /** Older/next-page button class (class-only hook). */
    olderButtonClass: "div.amJ[role='button']",

    // Unsubscribe
    unsubscribeCandidates: "button, [role='button'], [role='link'], a, span, div",
    unsubscribeActionable: "a, [role='button'], button",
    unsubscribeButtonLike: "button, [role='button'], a",
    roleLink: "[role='link']",
    /** Gmail's header "Unsubscribe" link class (class-only hook). */
    unsubscribeLinkClass: "Ca",
    dialogOkButton: "button[data-mdc-dialog-action='ok'], [role='button'][data-mdc-dialog-action='ok']",
    dialogButtons: "button, [role='button'], [role='link'], a, span",
    /** Material dialog dismiss buttons (locale independent). */
    dialogDismissButton: "[data-mdc-dialog-action='cancel'], [data-mdc-dialog-action='close']",
    noticeNodes: "div, span, p"
  };

  /**
   * English Gmail UI text used for matching aria-label / data-tooltip / text content.
   *
   * KNOWN LOCALE LIMITATIONS: Gmail localizes aria-labels, tooltips and visible text
   * to the user's UI language, so these strings only match English Gmail. Each use
   * site tries the English text first (unchanged behavior) and then a
   * locale-independent fallback where one is known:
   *   - Select dropdown: structural (button that wraps the master checkbox).
   *   - "All" menu item: Gmail's selector="all" attribute (already locale independent).
   *   - Archive: act="7" attribute; keyboard "e" as last resort.
   *   - Older / next page: pager group structure (.Di) and .amJ class.
   *   - Unsubscribe link: Gmail's ".Ca" header link class.
   *   - Unsubscribe dialogs: data-mdc-dialog-action attributes.
   *   - Search box: input[name='q'] (aria-label "Search mail" is only a fallback).
   *   - Gmail Undo link: #link_undo id, then the single action in the notification.
   *   - Move to Inbox: act="8" attribute.
   *   - Result count: digits parsed from the range text (any locale's separators).
   * Still English-only (no reliable locale-independent hook known):
   *   - "Select all conversations that match this search" link (includeAllInSearch).
   *   - "Already unsubscribed" notice detection (findAlreadyUnsubscribedNotice).
   *   - Date parsing uses English month names (parseDateSignature); thread/legacy id
   *     matching does not depend on it, so next-email matching degrades gracefully.
   */
  const GMAIL_TEXT = {
    select: "select",
    all: "all",
    archive: "archive",
    /** Exact aria-label / tooltip of Gmail's Delete button. */
    delete: "delete",
    /** Never click these (Trash / Spam views). */
    deleteForeverPattern: /delete forever|permanently/i,
    olderSignals: ["older", "next page"],
    nextExact: "next",
    unsubscribe: "unsubscribe",
    cancel: "cancel",
    confirmSignals: ["unsubscribe", "confirm", "ok"],
    dismissSignals: ["done", "ok", "got it", "close", "dismiss", "cancel"],
    alreadyUnsubscribedKeywords: [
      "unsubscribed",
      "you are unsubscribed",
      "no longer receive",
      "won't get messages",
      "will not get messages",
      "won\u2019t get messages"
    ],
    undoPattern: /\bundo\b/i,
    moveToInboxPattern: /move to inbox/i,
    selectAllInSearch: [
      /Select all conversations that match this search/i,
      /all conversations that match this search/i
    ]
  };

  Object.assign(GC, { GMAIL_TEXT, SELECTORS });
})();
