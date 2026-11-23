// Next-email target discovery, caching and navigation; Go to Inbox.
(() => {
  const GC = window.__gc;
  if (!GC || GC.skipLoad) return;

  const { ACTION_BUTTON_IDS, NEXT_EMAIL_TARGET_CACHE_KEY, NEXT_TARGET_CACHE_VERSION, SELECTORS,
    SIGNATURE_MATCH_LOG_STYLE, STRINGS, createEmptyNextTarget, ensureSearchContext, extractSenderFromQuery,
    findCurrentRowIndexInDom, findNextPageButton, getCurrentListContextHash, getListContextHashFromHash,
    getOpenEmailFingerprint, getRowDateText, getRowFingerprint, getRowOpenControl, getRowSenderEmail,
    getRowSubjectText, getRowThreadLegacyId, getRowThreadUrlToken, getThreadRows, getThreadUrlFromRow,
    goToNextResultsPage, navigateWithinGmail, normalizeComparableUrl, normalizeEmail,
    normalizeFingerprintText, normalizeQuery, normalizeScanPageLimit, normalizeSubjectForMatch,
    parseDateSignature, robustClick, safeStorageGet, safeStorageSet, scoreRowAgainstEmailSignature,
    senderSignalMatchesExpected, setLog, sleep, state, waitForSelector, waitForThreadRows } = GC;

  /**
   * Extracts the raw target fields from a stored cache payload.
   * Accepts both v2 ({ version, nextTarget: {...}, updatedAt }) and the legacy flat v1 shape.
   */
  function unwrapStoredNextTarget(cachedPayload) {
    if (!cachedPayload || typeof cachedPayload !== "object") return null;
    if (cachedPayload.nextTarget && typeof cachedPayload.nextTarget === "object") {
      return cachedPayload.nextTarget;
    }
    return cachedPayload;
  }

  /** Builds a normalized state.nextTarget from a stored cache payload (v1 or v2). */
  function nextTargetFromStored(cachedPayload) {
    const cached = unwrapStoredNextTarget(cachedPayload) || {};
    return {
      url: String(cached.url || ""),
      sender: normalizeEmail(cached.sender || ""),
      subject: String(cached.subject || "").trim(),
      date: String(cached.date || "").trim(),
      threadId: normalizeFingerprintText(cached.threadId || ""),
      threadToken: normalizeFingerprintText(cached.threadToken || ""),
      pageOffset: Math.max(0, Number.parseInt(String(cached.pageOffset ?? ""), 10) || 0),
      listHash: String(cached.listHash || "").trim().toLowerCase(),
      sourceUrl: normalizeComparableUrl(cached.sourceUrl || "")
    };
  }

  /** Returns cached next email payload (v2 shape) for storage. */
  function getCachedNextEmailPayload() {
    const target = state.nextTarget;
    return {
      version: NEXT_TARGET_CACHE_VERSION,
      nextTarget: {
        url: target.url || "",
        sender: target.sender || "",
        subject: target.subject || "",
        date: target.date || "",
        threadId: target.threadId || "",
        threadToken: target.threadToken || "",
        pageOffset: Number.isFinite(target.pageOffset) ? target.pageOffset : 0,
        listHash: target.listHash || "",
        sourceUrl: target.sourceUrl || ""
      },
      updatedAt: Date.now()
    };
  }

  /** Renders next email target section. */
  function renderNextEmailTargetSection() {
    const section = document.getElementById("gc-next-target-section");
    const summaryEl = document.getElementById("gc-next-target-summary-text");
    const urlEl = document.getElementById("gc-next-target-url");
    const senderEl = document.getElementById("gc-next-target-sender");
    const subjectEl = document.getElementById("gc-next-target-subject");
    const dateEl = document.getElementById("gc-next-target-date");
    const threadIdEl = document.getElementById("gc-next-target-thread-id");
    const threadTokenEl = document.getElementById("gc-next-target-thread-token");
    const pageOffsetEl = document.getElementById("gc-next-target-page-offset");
    const listHashEl = document.getElementById("gc-next-target-list-hash");
    if (!section || !summaryEl) return;

    const goNextChecked = GC.isActionChecked(ACTION_BUTTON_IDS.GO_TO_NEXT_PAGE);
    section.classList.toggle("gc-hidden", !goNextChecked);
    if (!goNextChecked) return;

    if (!state.nextTarget.url) {
      const empty = STRINGS.ui.emptyValue;
      summaryEl.textContent = STRINGS.ui.notCached;
      if (urlEl) urlEl.textContent = STRINGS.ui.notCached;
      if (senderEl) senderEl.textContent = empty;
      if (subjectEl) subjectEl.textContent = empty;
      if (dateEl) dateEl.textContent = empty;
      if (threadIdEl) threadIdEl.textContent = empty;
      if (threadTokenEl) threadTokenEl.textContent = empty;
      if (pageOffsetEl) pageOffsetEl.textContent = "0";
      if (listHashEl) listHashEl.textContent = empty;
      return;
    }

    const summaryParts = [
      state.nextTarget.sender || "",
      state.nextTarget.subject || "",
      state.nextTarget.date || ""
    ].filter(Boolean);
    summaryEl.textContent = summaryParts.join(" | ") || STRINGS.ui.cachedTargetReady;
    if (urlEl) urlEl.textContent = state.nextTarget.url;
    if (senderEl) senderEl.textContent = state.nextTarget.sender || STRINGS.ui.emptyValue;
    if (subjectEl) subjectEl.textContent = state.nextTarget.subject || STRINGS.ui.emptyValue;
    if (dateEl) dateEl.textContent = state.nextTarget.date || STRINGS.ui.emptyValue;
    if (threadIdEl) threadIdEl.textContent = state.nextTarget.threadId || STRINGS.ui.emptyValue;
    if (threadTokenEl) threadTokenEl.textContent = state.nextTarget.threadToken || STRINGS.ui.emptyValue;
    if (pageOffsetEl) pageOffsetEl.textContent = String(state.nextTarget.pageOffset || 0);
    if (listHashEl) listHashEl.textContent = state.nextTarget.listHash || STRINGS.ui.emptyValue;
  }

  /** Persists cached next email target. */
  function persistCachedNextEmailTarget() {
    safeStorageSet({ [NEXT_EMAIL_TARGET_CACHE_KEY]: getCachedNextEmailPayload() });
    renderNextEmailTargetSection();
  }

  /** Clears cached next email target. */
  function clearCachedNextEmailTarget() {
    state.nextTarget = createEmptyNextTarget();
    persistCachedNextEmailTarget();
  }

  /** Checks whether cached target valid for current context. */
  function isCachedTargetValidForCurrentContext(cachedPayload) {
    const cached = unwrapStoredNextTarget(cachedPayload);
    const url = String(cached?.url || "").trim();
    if (!url) return false;
    const sourceUrl = normalizeComparableUrl(cached?.sourceUrl || "");
    const currentUrl = normalizeComparableUrl(location.href);
    if (!sourceUrl || !currentUrl) return false;
    return sourceUrl === currentUrl;
  }

  /** Loads cached next email target. */
  function loadCachedNextEmailTarget() {
    safeStorageGet([NEXT_EMAIL_TARGET_CACHE_KEY], (result) => {
      const cached = result[NEXT_EMAIL_TARGET_CACHE_KEY];
      if (!cached || typeof cached !== "object") return;
      if (!isCachedTargetValidForCurrentContext(cached)) {
        state.nextTarget = createEmptyNextTarget();
        renderNextEmailTargetSection();
        return;
      }
      state.nextTarget = nextTargetFromStored(cached);
      renderNextEmailTargetSection();
    });
  }

  /** Handles announce email target status. */
  function announceEmailTargetStatus(prefix = "Email target status") {
    renderNextEmailTargetSection();
    if (state.nextTarget.url) {
      const parts = [
        state.nextTarget.url,
        state.nextTarget.sender || "",
        state.nextTarget.subject || "",
        state.nextTarget.date || ""
      ].filter(Boolean);
      setLog(`${prefix}: ${parts.join(" | ")}`);
      return;
    }
    setLog(`${prefix}: none`);
  }

  /** Navigates to inbox for discovery. */
  async function navigateToInboxForDiscovery() {
    if (GC.shouldStopExecution()) return;
    const hash = String(location.hash || "").toLowerCase();
    const isInboxListView = hash === "#inbox" || hash.startsWith("#inbox?");
    if (!isInboxListView) {
      window.location.hash = "#inbox";
      await waitForThreadRows(12000);
      await sleep(250);
      return;
    }
    await waitForThreadRows(5000);
  }

  /** Handles can use locked search for discovery. */
  function canUseLockedSearchForDiscovery(expectedSender) {
    const lockedQuery = normalizeQuery(state.lockedQuery || state.query || "");
    if (!lockedQuery) return false;
    // A search scoped to one sender (from:x) can never contain a *different*
    // sender's email, and a -in:inbox search (e.g. left behind by Undo all) no
    // longer lists inbox mail. Discovery must use the inbox in both cases,
    // otherwise re-running a sender after Undo finds no next email.
    if (extractSenderFromQuery(lockedQuery)) return false;
    if (/(^|\s)-in:inbox(\s|$)/.test(lockedQuery)) return false;
    if (!expectedSender) return true;
    const lockedSender = normalizeEmail(state.lockedSender);
    if (!lockedSender) return false;
    return senderSignalMatchesExpected(lockedSender, expectedSender);
  }

  /** Navigates to discovery list context. */
  async function navigateToDiscoveryListContext(expectedSender) {
    if (canUseLockedSearchForDiscovery(expectedSender)) {
      const lockedQuery = normalizeQuery(state.lockedQuery || state.query || "");
      await ensureSearchContext(lockedQuery);
      await waitForThreadRows(5000);
      return;
    }
    await navigateToInboxForDiscovery();
  }

  /** Finds next different sender thread url. */
  async function findNextDifferentSenderThreadUrl(sender, options = {}) {
    const configuredMaxPages = normalizeScanPageLimit(state.maxScanPages);
    const { maxPages = configuredMaxPages, onProgress = null } = options;
    /** Handles report. */
    const report = (message) => {
      if (typeof onProgress === "function") onProgress(message);
    };
    const safeMaxPages = normalizeScanPageLimit(maxPages);
    const expectedSender = normalizeEmail(sender);
    let signatureMatched = false;

    const fp = getOpenEmailFingerprint();
    const fingerprintSender = normalizeEmail(fp?.sender || "");
    const matchedSender = normalizeEmail(fingerprintSender || expectedSender || "");
    console.log("[GmailCleaner] Step 3 fingerprint object sender", {
      senderFromFingerprintObject: fingerprintSender
    });
    console.log("[GmailCleaner] Step 4 sender-only vs Step 3 object sender", {
      senderOnly: expectedSender,
      senderFromFingerprintObject: fingerprintSender,
      same: !!(expectedSender && fingerprintSender && expectedSender === fingerprintSender),
      different: !!(expectedSender && fingerprintSender && expectedSender !== fingerprintSender)
    });
    if (expectedSender && fingerprintSender && expectedSender !== fingerprintSender) {
      console.warn("[GmailCleaner] Sender mismatch: using open-email fingerprint sender for matching", {
        expectedSender,
        fingerprintSender
      });
      report("Sender mismatch detected; using open-email sender fingerprint for matching.");
    }

    /** Finds different sender target in rows. */
    const findDifferentSenderTargetInRows = (rows, startIndex = 0) => {
      for (let i = Math.max(0, startIndex); i < rows.length; i += 1) {
        const row = rows[i];
        const rowSender = getRowSenderEmail(row);
        if (matchedSender) {
          if (!rowSender) continue;
          if (rowSender === matchedSender) continue;
        }
        const url = getThreadUrlFromRow(row);
        if (!url) continue;
        return {
          url,
          sender: rowSender,
          subject: getRowSubjectText(row),
          date: getRowDateText(row),
          threadId: getRowThreadLegacyId(row),
          threadToken: getRowThreadUrlToken(row),
          listHash: getCurrentListContextHash()
        };
      }
      return null;
    };

    await navigateToDiscoveryListContext(expectedSender);

    for (let page = 0; page < safeMaxPages; page += 1) {
      if (GC.shouldStopExecution()) return null;
      report(`Scanning inbox page ${page + 1}/${safeMaxPages}...`);

      const rows = getThreadRows();
      for (let i = 0; i < rows.length; i += 1) {
        if (GC.shouldStopExecution()) return null;
        const scannedSignature = getRowFingerprint(rows[i]);
        console.log("[GmailCleaner] Scanned inbox row signature", {
          page: page + 1,
          row: i + 1,
          signature: scannedSignature
        });
        console.log("--------------------------------------------------");
      }
      let searchStartIndex = 0;
      if (!signatureMatched) {
        const currentMatch = findCurrentRowIndexInDom(rows, fp, {
          onStatus: report,
          pageNumber: page + 1
        });
        const currentIndex = currentMatch.index;
        if (currentIndex >= 0) {
          signatureMatched = true;
          searchStartIndex = currentIndex + 1;
          console.log("%c[GmailCleaner] Email signature matched", SIGNATURE_MATCH_LOG_STYLE);
          report(
            `Page ${page + 1}: anchored current email with ${currentMatch.approach}; searching from row ${searchStartIndex}.`
          );
        } else if (matchedSender) {
          report(`Page ${page + 1}: Approach 5/5 (sender-only fallback): trying...`);
          let senderOnlyIndex = -1;
          let senderOnlyBestScore = -1;
          let senderOnlyBestScoreCount = 0;
          for (let i = 0; i < rows.length; i += 1) {
            const rowSignature = getRowFingerprint(rows[i]);
            if (rowSignature.sender !== matchedSender) continue;
            const score = scoreRowAgainstEmailSignature(rowSignature, fp).total;
            if (score > senderOnlyBestScore) {
              senderOnlyBestScore = score;
              senderOnlyIndex = i;
              senderOnlyBestScoreCount = 1;
            } else if (score > 0 && score === senderOnlyBestScore) {
              senderOnlyBestScoreCount += 1;
            }
          }
          if (senderOnlyIndex >= 0 && senderOnlyBestScore >= 7 && senderOnlyBestScoreCount === 1) {
            signatureMatched = true;
            searchStartIndex = senderOnlyIndex + 1;
            console.log("%c[GmailCleaner] Email sender fallback matched", SIGNATURE_MATCH_LOG_STYLE, {
              sender: matchedSender,
              row: senderOnlyIndex + 1,
              page: page + 1,
              score: senderOnlyBestScore
            });
            report(
              `Page ${page + 1}: Approach 5/5 (sender-only fallback): matched row ${senderOnlyIndex + 1} (score ${senderOnlyBestScore}).`
            );
          } else {
            report("Page " + (page + 1) + ": Approach 5/5 (sender-only fallback): no match.");
          }
        } else {
          report(`Page ${page + 1}: Approach 5/5 (sender-only fallback): skipped (no sender).`);
        }
      }

      if (signatureMatched) {
        const target = findDifferentSenderTargetInRows(rows, searchStartIndex);
        if (target) {
          target.pageOffset = page;
          return target;
        }
      }

      if (GC.shouldStopExecution()) return null;
      const moved = await goToNextResultsPage();
      if (!moved) break;
    }

    if (!signatureMatched) {
      console.log("[GmailCleaner] Email signature did not match");
      report("No signature match found after trying all approaches (including fallbacks).");
    }
    void expectedSender;
    return null;
  }

  /** Handles cache next email target for sender. */
  async function cacheNextEmailTargetForSender(sender, options = {}) {
    const { returnToUrl = "", forceRefresh = false } = options;
    const expectedSender = normalizeEmail(sender);
    if (!expectedSender) {
      throw new Error("Open an email first so I can identify its sender before caching next target.");
    }
    const currentSourceUrl = normalizeComparableUrl(returnToUrl || location.href);
    const cachedSourceUrl = normalizeComparableUrl(state.nextTarget.sourceUrl || "");
    const cachedSender = normalizeEmail(state.nextTarget.sender || "");
    if (cachedSourceUrl && currentSourceUrl && cachedSourceUrl !== currentSourceUrl) {
      clearCachedNextEmailTarget();
    }
    const cachedMatchesSource = !!(
      state.nextTarget.url &&
      cachedSourceUrl &&
      cachedSourceUrl === currentSourceUrl
    );
    const cachedMatchesSender = !expectedSender || (cachedSender && cachedSender === expectedSender);
    if (!forceRefresh && cachedMatchesSource && cachedMatchesSender) {
      announceEmailTargetStatus("Email target already cached (persisted)");
      return true;
    }
    if (cachedMatchesSource && expectedSender && cachedSender && cachedSender !== expectedSender) {
      clearCachedNextEmailTarget();
    }
    if (
      expectedSender &&
      state.nextTarget.url &&
      state.nextTarget.sender &&
      normalizeEmail(state.nextTarget.sender) === expectedSender
    ) {
      return true;
    }

    const priorUrl = String(returnToUrl || "");
    try {
      setLog("Go to Next Email selected: finding the immediate next email...");
      const target = await findNextDifferentSenderThreadUrl(expectedSender, {
        onProgress: (message) => setLog(message)
      });
      if (!target?.url) {
        clearCachedNextEmailTarget();
        announceEmailTargetStatus("Email target after inbox scan");
        return false;
      }
      state.nextTarget = {
        url: target.url,
        sender: normalizeEmail(target.sender || expectedSender || sender || ""),
        subject: (target.subject || "").trim(),
        date: (target.date || "").trim(),
        threadId: normalizeFingerprintText(target.threadId || ""),
        threadToken: normalizeFingerprintText(target.threadToken || ""),
        pageOffset: Math.max(0, Number.parseInt(String(target.pageOffset ?? ""), 10) || 0),
        listHash: getListContextHashFromHash(target.listHash || ""),
        sourceUrl: currentSourceUrl
      };
      persistCachedNextEmailTarget();
      const preview = [
        state.nextTarget.sender || "unknown sender",
        state.nextTarget.subject || "(no subject)",
        state.nextTarget.date || ""
      ]
        .filter(Boolean)
        .join(" | ");
      setLog(`Next email target cached: ${preview}`);
      announceEmailTargetStatus("Email target after inbox scan");
      GC.showToast(STRINGS.toast.nextTargetCached);
      return true;
    } finally {
      if (priorUrl && normalizeComparableUrl(location.href) !== normalizeComparableUrl(priorUrl)) {
        setLog("Returning to current open email...");
        navigateWithinGmail(priorUrl);
        await waitForSelector(SELECTORS.openThreadHeadingInMain, 12000);
        await sleep(180);
        setLog("Returned to current email. Continuing flow...");
      }
    }
  }

  /** Handles action go inbox. */
  async function actionGoInbox(options = {}) {
    const manageWorking = !options.skipWorking;
    if (manageWorking) GC.setWorking(true);
    try {
      window.location.hash = "#inbox";
      await waitForThreadRows(8000);
      state.query = "";
      state.lockedQuery = "";
      state.lockedSender = "";
      state.selectedConversationsText = "";
      clearCachedNextEmailTarget();
      setLog("Moved to Inbox. Search context reset.");
      GC.showToast(STRINGS.toast.movedToInbox);
    } catch (_) {
      setLog("Moved to Inbox.");
      GC.showToast(STRINGS.toast.movedToInbox);
    } finally {
      if (manageWorking) GC.setWorking(false);
    }
  }

  /** Finds cached target row index. */
  function findCachedTargetRowIndex(rows) {
    const targetThreadId = normalizeFingerprintText(state.nextTarget.threadId || "");
    const targetThreadToken = normalizeFingerprintText(state.nextTarget.threadToken || "");
    const targetUrl = normalizeComparableUrl(state.nextTarget.url || "");
    const targetSender = normalizeEmail(state.nextTarget.sender || "");
    const targetSubject = normalizeSubjectForMatch(state.nextTarget.subject || "");
    const targetDate = parseDateSignature(state.nextTarget.date || "");

    if (targetThreadId) {
      for (let i = 0; i < rows.length; i += 1) {
        if (getRowThreadLegacyId(rows[i]) === targetThreadId) return i;
      }
    }

    if (targetThreadToken) {
      for (let i = 0; i < rows.length; i += 1) {
        if (getRowThreadUrlToken(rows[i]) === targetThreadToken) return i;
      }
    }

    if (targetUrl) {
      for (let i = 0; i < rows.length; i += 1) {
        const rowUrl = normalizeComparableUrl(getThreadUrlFromRow(rows[i]) || "");
        if (rowUrl && rowUrl === targetUrl) return i;
      }
    }

    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      const rowSender = getRowSenderEmail(row);
      if (targetSender && rowSender !== targetSender) continue;

      const rowSubject = normalizeSubjectForMatch(getRowSubjectText(row));
      const subjectMatches = !!(
        targetSubject &&
        rowSubject &&
        (rowSubject.includes(targetSubject) || targetSubject.includes(rowSubject))
      );

      if (targetSubject && !subjectMatches) continue;

      if (targetDate.canonical || targetDate.dayMonth) {
        const rowDate = parseDateSignature(getRowDateText(row));
        const dateMatches = !!(
          (targetDate.canonical && rowDate.canonical && targetDate.canonical === rowDate.canonical) ||
          (targetDate.dayMonth && rowDate.dayMonth && targetDate.dayMonth === rowDate.dayMonth)
        );
        if (!dateMatches) continue;
      }

      return i;
    }

    return -1;
  }

  /** Opens cached next email from list context. */
  async function openCachedNextEmailFromListContext() {
    const listHash = getListContextHashFromHash(state.nextTarget.listHash || "");
    if (listHash) {
      navigateWithinGmail(listHash);
      await waitForThreadRows(12000);
      await sleep(200);
    } else {
      await navigateToDiscoveryListContext(state.nextTarget.sender || "");
    }

    const pageOffset = Math.max(0, Number.parseInt(String(state.nextTarget.pageOffset ?? ""), 10) || 0);
    for (let i = 0; i < pageOffset; i += 1) {
      if (GC.shouldStopExecution()) return false;
      const moved = await goToNextResultsPage();
      if (!moved) return false;
    }

    const rows = await waitForThreadRows(10000);
    if (!rows.length) return false;
    const rowIndex = findCachedTargetRowIndex(rows);
    if (rowIndex < 0) return false;

    const openControl = getRowOpenControl(rows[rowIndex]);
    robustClick(openControl);
    const openThread = await waitForSelector(SELECTORS.openThreadHeadingInMain, 12000);
    return !!openThread;
  }

  /** Handles action go next page. */
  async function actionGoNextPage(options = {}) {
    const manageWorking = !options.skipWorking;
    if (manageWorking) GC.setWorking(true);
    let targetLogTimer = null;
    /** Handles stop target log timer. */
    const stopTargetLogTimer = () => {
      if (targetLogTimer) {
        clearInterval(targetLogTimer);
        targetLogTimer = null;
      }
    };
    try {
      setLog("Load Next Email [1/8]: Starting action...");
      const cached = !!state.nextTarget.url;
      if (cached) {
        setLog("Load Next Email [2/8]: Cached target found.");
      } else {
        setLog("Load Next Email [2/8]: No cached target present.");
      }
      setLog("Load Next Email [3/8]: Checking stop-request flag...");
      if (GC.shouldStopExecution()) {
        setLog("Load Next Email [3/8]: Stop requested. Aborting.");
        GC.showToast(STRINGS.toast.executionStopped);
        return;
      }
      setLog("Load Next Email [4/8]: Validating target URL...");
      if (!cached || !state.nextTarget.url) {
        setLog("Load Next Email [4/8]: No cache — trying Gmail's Older button...");
        const olderBtn = findNextPageButton();
        if (olderBtn) {
          robustClick(olderBtn);
          await waitForSelector(SELECTORS.openThreadHeadingInMain, 12000);
          setLog("Load Next Email: Opened next email via Older button.");
          GC.showToast(STRINGS.toast.openedNextEmail);
          return;
        }
        setLog("Load Next Email [4/8]: No cached target and no Older button found.");
        announceEmailTargetStatus("Email target before open");
        GC.showToast(STRINGS.toast.noCachedTarget);
        return;
      }

      const targetUrl = state.nextTarget.url;
      setLog("Load Next Email [5/8]: Target URL resolved.");
      announceEmailTargetStatus("Email target before open");
      const targetMessage = `Cached email target: ${targetUrl}`;
      setLog(targetMessage);
      setLog("Load Next Email [6/8]: Opening target from list context...");
      const openedFromList = await openCachedNextEmailFromListContext();
      if (openedFromList) {
        stopTargetLogTimer();
        setLog("Load Next Email [7/8]: Opened via list-row context.");
        setLog("Load Next Email [8/8]: Completed. j/k navigation should remain in context.");
        GC.showToast(STRINGS.toast.openedNextEmail);
        return;
      }
      setLog("Load Next Email [7/8]: List-row open failed. Falling back to direct URL...");
      targetLogTimer = setInterval(() => {
        setLog(targetMessage);
      }, 450);
      navigateWithinGmail(targetUrl);
      setLog("Load Next Email [8/8]: Waiting for next email view to load...");
      await waitForSelector(SELECTORS.openThreadHeadingInMain, 12000);
      stopTargetLogTimer();
      setLog("Load Next Email: Completed via URL fallback.");
      GC.showToast(STRINGS.toast.openedNextEmail);
    } catch (error) {
      stopTargetLogTimer();
      setLog(`Load Next Email failed: ${error.message || "Go to next page failed."}`);
    } finally {
      stopTargetLogTimer();
      if (manageWorking) GC.setWorking(false);
    }
  }

  Object.assign(GC, { actionGoInbox, actionGoNextPage, announceEmailTargetStatus,
    cacheNextEmailTargetForSender, canUseLockedSearchForDiscovery, clearCachedNextEmailTarget,
    findCachedTargetRowIndex, findNextDifferentSenderThreadUrl, getCachedNextEmailPayload,
    isCachedTargetValidForCurrentContext, loadCachedNextEmailTarget, navigateToDiscoveryListContext,
    navigateToInboxForDiscovery, nextTargetFromStored, openCachedNextEmailFromListContext,
    persistCachedNextEmailTarget, renderNextEmailTargetSection, unwrapStoredNextTarget });
})();
