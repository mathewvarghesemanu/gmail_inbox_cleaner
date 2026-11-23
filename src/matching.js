// DOM-free pure helpers (normalization, date parsing, signatures, row matching).
// Also loadable from Node: `require("./src/matching.js")`.
// Pure functions only: no document/window/location/chrome access.
(function (root) {
  const DEFAULT_SCAN_PAGE_LIMIT = 5;
  const MIN_SCAN_PAGE_LIMIT = 1;
  const MAX_SCAN_PAGE_LIMIT = 200;
  /** Formats elapsed ms. */
  function formatElapsedMs(ms) {
    if (ms < 1000) return `${Math.max(1, Math.round(ms))}ms`;
    const seconds = ms / 1000;
    return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  }

  /** Normalizes scan page limit. */
  function normalizeScanPageLimit(raw) {
    const parsed = Number.parseInt(String(raw ?? ""), 10);
    if (!Number.isFinite(parsed)) return DEFAULT_SCAN_PAGE_LIMIT;
    return Math.min(MAX_SCAN_PAGE_LIMIT, Math.max(MIN_SCAN_PAGE_LIMIT, parsed));
  }

  /** Handles escape html. */
  function escapeHtml(value) {
    return value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  /** Normalizes query. */
  function normalizeQuery(value) {
    return (value || "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  /** Normalizes email. */
  function normalizeEmail(value) {
    return (value || "").trim().toLowerCase();
  }

  /** Handles sender signal matches expected. */
  function senderSignalMatchesExpected(signal, expected) {
    const lhs = normalizeEmail(signal);
    const rhs = normalizeEmail(expected);
    if (!lhs || !rhs) return false;
    if (lhs === rhs) return true;

    // Gmail may visually truncate sender text (e.g. "name@subst").
    return rhs.startsWith(lhs) || lhs.startsWith(rhs);
  }

  /** Extracts sender from query. */
  function extractSenderFromQuery(query) {
    const match = (query || "").match(/\bfrom:([^\s]+)/i);
    if (!match) return "";
    return normalizeEmail(match[1].replace(/^"|"$/g, ""));
  }

  /** Normalizes fingerprint text. */
  function normalizeFingerprintText(value) {
    return (value || "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  /** Normalizes subject for match. */
  function normalizeSubjectForMatch(value) {
    return normalizeFingerprintText(value)
      // Remove zero-width / variation selector noise.
      .replace(/[\u200B-\u200D\uFE0E\uFE0F]/g, " ")
      // Remove most emoji blocks.
      .replace(/[\u{1F300}-\u{1FAFF}]/gu, " ")
      // Keep letters/numbers from any language; drop symbols/punctuation.
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  /** Returns normalized words. */
  function getNormalizedWords(value) {
    return normalizeSubjectForMatch(value)
      .split(" ")
      .map((token) => token.trim())
      .filter((token) => token.length >= 3);
  }

  /** Returns word overlap score. */
  function getWordOverlapScore(aWords, bWords) {
    if (!aWords.length || !bWords.length) return 0;
    const aSet = new Set(aWords);
    const bSet = new Set(bWords);
    let overlap = 0;
    for (const token of aSet) {
      if (bSet.has(token)) overlap += 1;
    }
    return overlap / Math.max(1, Math.min(aSet.size, bSet.size));
  }

  /** Parses date signature. */
  function parseDateSignature(value) {
    const raw = normalizeFingerprintText(value);
    if (!raw) return { canonical: "", dayMonth: "" };

    const monthMap = {
      jan: "01",
      feb: "02",
      mar: "03",
      apr: "04",
      may: "05",
      jun: "06",
      jul: "07",
      aug: "08",
      sep: "09",
      oct: "10",
      nov: "11",
      dec: "12"
    };

    /** Normalizes month. */
    const normalizeMonth = (monthText) => monthMap[(monthText || "").slice(0, 3).toLowerCase()] || "";
    const currentYear = String(new Date().getFullYear());

    const dayMonthYear =
      raw.match(/\b(?:mon|tue|wed|thu|fri|sat|sun),?\s+(\d{1,2})\s+([a-z]{3,9})\.?,?\s*(\d{4})?/i) ||
      raw.match(/\b(\d{1,2})\s+([a-z]{3,9})\.?,?\s*(\d{4})?/i);

    if (dayMonthYear) {
      const day = String(dayMonthYear[1]).padStart(2, "0");
      const month = normalizeMonth(dayMonthYear[2]);
      const year = dayMonthYear[3] || currentYear;
      if (month) {
        return {
          canonical: `${year}-${month}-${day}`,
          dayMonth: `${month}-${day}`
        };
      }
    }

    const monthDayYear =
      raw.match(/\b([a-z]{3,9})\s+(\d{1,2}),?\s*(\d{4})?/i);
    if (monthDayYear) {
      const month = normalizeMonth(monthDayYear[1]);
      const day = String(monthDayYear[2]).padStart(2, "0");
      const year = monthDayYear[3] || currentYear;
      if (month) {
        return {
          canonical: `${year}-${month}-${day}`,
          dayMonth: `${month}-${day}`
        };
      }
    }

    return { canonical: "", dayMonth: "" };
  }

  /** Checks whether hash string. */
  function hashString(value) {
    let hash = 2166136261;
    for (let i = 0; i < value.length; i += 1) {
      hash ^= value.charCodeAt(i);
      hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  /** Handles build message signature. */
  function buildMessageSignature({ sender, heading, subject, dateText }) {
    const normalizedSubject = normalizeSubjectForMatch(subject || "");
    const normalizedHeading = normalizeFingerprintText(heading || "");
    const dateSignature = parseDateSignature(dateText || "");
    const subjectCore = normalizedSubject.slice(0, 28);
    const rawSignature = [
      normalizeEmail(sender || ""),
      subjectCore,
      dateSignature.dayMonth
    ].join("|");

    return {
      sender: normalizeEmail(sender || ""),
      heading: normalizedHeading,
      subject: normalizedSubject,
      subjectWords: getNormalizedWords(normalizedSubject),
      subjectCore,
      dateCanonical: dateSignature.canonical,
      dateDayMonth: dateSignature.dayMonth,
      fingerprint: hashString(rawSignature)
    };
  }

  /** Returns thread token from hash. */
  function getThreadTokenFromHash(hashValue) {
    const hash = String(hashValue || "").trim();
    const match = hash.match(/^#(?:inbox|all|label\/[^/]+|category\/[^/]+)\/([^/?#]+)/i);
    return normalizeFingerprintText(match?.[1] || "");
  }

  /** Returns list context hash from hash value. */
  function getListContextHashFromHash(hashValue) {
    const hash = String(hashValue || "").trim().toLowerCase();
    if (!hash) return "#inbox";
    if (hash.startsWith("#inbox")) return "#inbox";
    if (hash.startsWith("#all")) return "#all";
    const labelMatch = hash.match(/^#label\/[^/?#]+/i);
    if (labelMatch) return labelMatch[0];
    const categoryMatch = hash.match(/^#category\/[^/?#]+/i);
    if (categoryMatch) return categoryMatch[0];
    const searchMatch = hash.match(/^#search\/[^/?#]+/i);
    if (searchMatch) return searchMatch[0];
    return "#inbox";
  }

  /** Handles score row against email signature. */
  function scoreRowAgainstEmailSignature(rowSignature, emailSignature) {
    if (!rowSignature.sender || !emailSignature.sender) {
      return { total: 0, sender: 0, subject: 0, heading: 0, date: 0, fingerprint: 0 };
    }
    if (rowSignature.sender !== emailSignature.sender) {
      return { total: 0, sender: 0, subject: 0, heading: 0, date: 0, fingerprint: 0 };
    }

    let subjectScore = 0;
    if (emailSignature.subject && rowSignature.subject) {
      const directContains =
        rowSignature.subject.includes(emailSignature.subject) ||
        emailSignature.subject.includes(rowSignature.subject);
      const coreContains =
        rowSignature.subject.includes(emailSignature.subjectCore) ||
        emailSignature.subject.includes(rowSignature.subjectCore);
      const overlapScore = getWordOverlapScore(emailSignature.subjectWords, rowSignature.subjectWords);

      if (directContains) {
        subjectScore = 4;
      } else if (coreContains || overlapScore >= 0.7) {
        subjectScore = 3;
      } else if (overlapScore >= 0.45) {
        subjectScore = 2;
      }
    }

    const headingMatches = !!(
      emailSignature.heading &&
      rowSignature.heading &&
      (
        rowSignature.heading.includes(emailSignature.heading) ||
        emailSignature.heading.includes(rowSignature.heading)
      )
    );
    const headingScore = headingMatches ? 1 : 0;

    let dateScore = 0;
    if (
      emailSignature.dateCanonical &&
      rowSignature.dateCanonical &&
      emailSignature.dateCanonical === rowSignature.dateCanonical
    ) {
      dateScore = 2;
    } else if (
      emailSignature.dateDayMonth &&
      rowSignature.dateDayMonth &&
      emailSignature.dateDayMonth === rowSignature.dateDayMonth
    ) {
      dateScore = 1;
    }

    const fingerprintScore =
      emailSignature.fingerprint &&
      rowSignature.fingerprint &&
      emailSignature.fingerprint === rowSignature.fingerprint
        ? 2
        : 0;
    const senderScore = 5;
    const total = senderScore + subjectScore + headingScore + dateScore + fingerprintScore;

    return {
      total,
      sender: senderScore,
      subject: subjectScore,
      heading: headingScore,
      date: dateScore,
      fingerprint: fingerprintScore
    };
  }

  /**
   * Row accessors for findCurrentRowIndex when rows are plain objects:
   * { threadToken, threadId, signature } (signature as built by buildMessageSignature).
   * The content script passes DOM accessors instead (see gmail-dom.js DOM_ROW_ACCESSORS).
   */
  const PLAIN_ROW_ACCESSORS = {
    threadToken: (row) => normalizeFingerprintText(row?.threadToken || ""),
    threadId: (row) => normalizeFingerprintText(row?.threadId || ""),
    signature: (row) => row?.signature || buildMessageSignature({})
  };

  /**
   * Finds current row index.
   * options.rowAccessors: { threadToken(row), threadId(row), signature(row) } (default: plain objects).
   */
  function findCurrentRowIndex(rows, emailSignature, options = {}) {
    const { onStatus = null, pageNumber = null, rowAccessors = PLAIN_ROW_ACCESSORS } = options;
    /** Handles report. */
    const report = (message) => {
      if (typeof onStatus !== "function") return;
      const prefix = pageNumber ? `Page ${pageNumber}: ` : "";
      onStatus(`${prefix}${message}`);
    };

    if (emailSignature?.threadToken) {
      report("Approach 1/4 (thread token): trying...");
      for (let i = 0; i < rows.length; i += 1) {
        if (rowAccessors.threadToken(rows[i]) === emailSignature.threadToken) {
          report(`Approach 1/4 (thread token): matched row ${i + 1}.`);
          return { index: i, approach: "thread-token" };
        }
      }
      report("Approach 1/4 (thread token): no match.");
    } else {
      report("Approach 1/4 (thread token): skipped (missing open-thread token).");
    }
    if (emailSignature?.threadId) {
      report("Approach 2/4 (legacy thread id): trying...");
      for (let i = 0; i < rows.length; i += 1) {
        if (rowAccessors.threadId(rows[i]) === emailSignature.threadId) {
          report(`Approach 2/4 (legacy thread id): matched row ${i + 1}.`);
          return { index: i, approach: "thread-id" };
        }
      }
      report("Approach 2/4 (legacy thread id): no match.");
    } else {
      report("Approach 2/4 (legacy thread id): skipped (missing open-thread id).");
    }

    let bestIndex = -1;
    let bestScore = 0;
    let bestDetail = null;
    let bestScoreCount = 0;

    report("Approach 3/4 (strict signature): trying...");
    for (let i = 0; i < rows.length; i += 1) {
      const rowSignature = rowAccessors.signature(rows[i]);
      const score = scoreRowAgainstEmailSignature(rowSignature, emailSignature);
      if (score.total > bestScore) {
        bestScore = score.total;
        bestIndex = i;
        bestDetail = score;
        bestScoreCount = 1;
      } else if (score.total > 0 && score.total === bestScore) {
        bestScoreCount += 1;
      }
    }

    if (bestIndex >= 0 && bestScore >= 8) {
      report(`Approach 3/4 (strict signature): matched row ${bestIndex + 1} (score ${bestScore}).`);
      return { index: bestIndex, approach: "strict-signature", score: bestScore };
    }
    report(`Approach 3/4 (strict signature): no match (best score ${bestScore}).`);

    // Fallback for sparse inbox rows where Gmail omits subject/heading/thread-id:
    // accept sender+exact-date (score 7) only when it is the unique strongest candidate.
    report("Approach 4/4 (sparse signature fallback): trying...");
    if (
      bestIndex >= 0 &&
      bestScore === 7 &&
      bestScoreCount === 1 &&
      bestDetail?.sender === 5 &&
      bestDetail?.date >= 2
    ) {
      console.log("[GmailCleaner] Using sparse-row fallback signature match", bestDetail);
      report(`Approach 4/4 (sparse signature fallback): matched row ${bestIndex + 1}.`);
      return { index: bestIndex, approach: "sparse-signature-fallback", score: bestScore };
    }
    report("Approach 4/4 (sparse signature fallback): no match.");
    return { index: -1, approach: "none" };
  }

  /** Extracts integer groups ("1,234", "1 234", "1.234") from localized text. */
  function parseLocalizedIntegers(text) {
    const groups = String(text || "").match(/\d+(?:[.,'   ]\d{2,3})*/g) || [];
    return groups
      .map((group) => Number.parseInt(group.replace(/\D/g, ""), 10))
      .filter((value) => Number.isFinite(value));
  }

  const api = { DEFAULT_SCAN_PAGE_LIMIT, MAX_SCAN_PAGE_LIMIT, MIN_SCAN_PAGE_LIMIT, PLAIN_ROW_ACCESSORS,
    buildMessageSignature, escapeHtml, extractSenderFromQuery, findCurrentRowIndex, formatElapsedMs,
    getListContextHashFromHash, getNormalizedWords, getThreadTokenFromHash, getWordOverlapScore, hashString,
    normalizeEmail, normalizeFingerprintText, normalizeQuery, normalizeScanPageLimit,
    normalizeSubjectForMatch, parseDateSignature, parseLocalizedIntegers, scoreRowAgainstEmailSignature,
    senderSignalMatchesExpected };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  const GC = root && root.__gc;
  if (GC && !GC.skipLoad) Object.assign(GC, api);
})(typeof window !== "undefined" ? window : null);
