// Boot, observers and storage listeners. Loads last.
(() => {
  const GC = window.__gc;
  if (!GC || GC.skipLoad) return;

  const { DEFAULT_SCAN_PAGE_LIMIT, MAX_SCAN_PAGES_KEY, NEXT_EMAIL_TARGET_CACHE_KEY, SHOW_EXTENSION_KEY,
    buildMessageSignature, createEmptyNextTarget, escapeHtml, extractSenderFromQuery,
    findCurrentRowIndexInDom, findOpenEmailSender, getNormalizedWords, getOpenEmailSubject,
    getRowFingerprint, getWordOverlapScore, hashString, installShortcutCommandListener,
    isCachedTargetValidForCurrentContext, isContextInvalidatedError, keepElInView, loadCachedNextEmailTarget,
    markExtensionContextInvalidated, mountSidebar, nextTargetFromStored, normalizeEmail, normalizeQuery,
    normalizeScanPageLimit, normalizeSubjectForMatch, parseDateSignature, refreshOpenEmailState,
    renderNextEmailTargetSection, scoreRowAgainstEmailSignature, setExtensionVisibility, state,
    syncScanPageLimitFromStorage } = GC;

  state.maxScanPages = DEFAULT_SCAN_PAGE_LIMIT;

  /** Bootstraps startup. */
  function boot() {
    if (!document.body) return;
    mountSidebar();
    installShortcutCommandListener();
    loadCachedNextEmailTarget();
  }

  boot();

  let resizeFrame = 0;
  window.addEventListener("resize", () => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => {
      keepElInView(document.getElementById("gc-root"));
      keepElInView(document.getElementById("gc-toggle"));
    });
  });

  let lastHref = location.href;
  let refreshControlsDebounceTimer = null;
  const observer = new MutationObserver(() => {
    if (state.extensionContextInvalidated) return;
    if (location.href !== lastHref) {
      lastHref = location.href;
      mountSidebar();
    } else if (!document.getElementById("gc-root") || !document.getElementById("gc-toggle")) {
      mountSidebar();
    } else {
      clearTimeout(refreshControlsDebounceTimer);
      refreshControlsDebounceTimer = setTimeout(refreshOpenEmailState, 300);
    }
  });

  observer.observe(document.documentElement || document.body, {
    childList: true,
    subtree: true
  });

  /** Handles on storage changed. */
  const onStorageChanged = (changes, areaName) => {
    if (state.extensionContextInvalidated) return;
    if (areaName !== "local") return;
    if (changes[SHOW_EXTENSION_KEY]) {
      setExtensionVisibility(changes[SHOW_EXTENSION_KEY].newValue !== false);
    }
    if (changes[MAX_SCAN_PAGES_KEY]) {
      state.maxScanPages = normalizeScanPageLimit(changes[MAX_SCAN_PAGES_KEY].newValue);
    }
    if (changes[NEXT_EMAIL_TARGET_CACHE_KEY]) {
      const cached = changes[NEXT_EMAIL_TARGET_CACHE_KEY].newValue || {};
      if (!isCachedTargetValidForCurrentContext(cached)) {
        state.nextTarget = createEmptyNextTarget();
        renderNextEmailTargetSection();
        return;
      }
      state.nextTarget = nextTargetFromStored(cached);
      renderNextEmailTargetSection();
    }
  };
  syncScanPageLimitFromStorage();
  try {
    chrome.storage.onChanged.addListener(onStorageChanged);
  } catch (error) {
    if (isContextInvalidatedError(error)) {
      markExtensionContextInvalidated(error);
    } else {
      throw error;
    }
  }

  window.addEventListener("hashchange", () => {
    if (state.extensionContextInvalidated) return;
    mountSidebar();
  });

  // Test-only hook: exposes internals when a test harness pre-defines globalThis.__GC_TEST__.
  // No-op in the extension (the global is never set there).
  if (globalThis.__GC_TEST__) {
    globalThis.__GC_TEST__.exports = {
      state,
      normalizeEmail,
      normalizeQuery,
      extractSenderFromQuery,
      normalizeSubjectForMatch,
      getNormalizedWords,
      getWordOverlapScore,
      parseDateSignature,
      hashString,
      buildMessageSignature,
      scoreRowAgainstEmailSignature,
      findCurrentRowIndex: findCurrentRowIndexInDom,
      findCurrentRowIndexInDom,
      normalizeScanPageLimit,
      escapeHtml,
      findOpenEmailSender,
      getRowFingerprint,
      getOpenEmailSubject
    };
  }
})();
