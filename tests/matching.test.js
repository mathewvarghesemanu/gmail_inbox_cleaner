import { beforeAll, describe, expect, it } from "vitest";
import { loadContentScripts, loadMatchingFunctions, readFixtureBody } from "./load-content.js";

const NAMES = [
  "normalizeEmail",
  "normalizeQuery",
  "extractSenderFromQuery",
  "normalizeSubjectForMatch",
  "getNormalizedWords",
  "getWordOverlapScore",
  "parseDateSignature",
  "hashString",
  "buildMessageSignature",
  "scoreRowAgainstEmailSignature",
  "findCurrentRowIndex",
  "escapeHtml"
];

let fn;
const YEAR = String(new Date().getFullYear());

beforeAll(() => {
  fn = loadMatchingFunctions(NAMES);
});

describe("test harness", () => {
  it("exposes every function under test", () => {
    for (const name of NAMES) expect(typeof fn[name], name).toBe("function");
  });
});

describe("normalizeEmail", () => {
  it("trims and lowercases", () => {
    expect(fn.normalizeEmail("  News@Shop.EXAMPLE \n")).toBe("news@shop.example");
  });
  it("treats nullish as empty", () => {
    expect(fn.normalizeEmail(null)).toBe("");
    expect(fn.normalizeEmail(undefined)).toBe("");
    expect(fn.normalizeEmail("")).toBe("");
  });
});

describe("normalizeQuery", () => {
  it("collapses whitespace, trims and lowercases", () => {
    expect(fn.normalizeQuery("  From:A@B.com \t  older_than:1y\n")).toBe("from:a@b.com older_than:1y");
  });
  it("treats nullish as empty", () => {
    expect(fn.normalizeQuery(null)).toBe("");
    expect(fn.normalizeQuery(undefined)).toBe("");
  });
});

describe("extractSenderFromQuery", () => {
  it("extracts and normalizes the from: operand", () => {
    expect(fn.extractSenderFromQuery("from:News@Shop.Example older_than:1y")).toBe("news@shop.example");
  });
  it("is case-insensitive on the operator", () => {
    expect(fn.extractSenderFromQuery("FROM:x@y.z")).toBe("x@y.z");
  });
  it("strips surrounding quotes", () => {
    expect(fn.extractSenderFromQuery('in:inbox from:"a@b.com"')).toBe("a@b.com");
  });
  it("finds from: in the middle of a query", () => {
    expect(fn.extractSenderFromQuery("is:unread from:deals@store.example has:attachment")).toBe("deals@store.example");
  });
  it("returns empty when there is no from: operator", () => {
    expect(fn.extractSenderFromQuery("is:unread")).toBe("");
    expect(fn.extractSenderFromQuery("")).toBe("");
    expect(fn.extractSenderFromQuery(null)).toBe("");
  });
  it("requires a word boundary before from:", () => {
    expect(fn.extractSenderFromQuery("xfrom:a@b.com")).toBe("");
  });
});

describe("normalizeSubjectForMatch", () => {
  it("drops punctuation and lowercases, keeping reply prefixes as words", () => {
    expect(fn.normalizeSubjectForMatch("Re: Fwd: Hello, World!")).toBe("re fwd hello world");
  });
  it("removes emoji and collapses whitespace", () => {
    expect(fn.normalizeSubjectForMatch("🎉  Big   SALE 🎉 ")).toBe("big sale");
  });
  it("removes zero-width and variation-selector characters", () => {
    expect(fn.normalizeSubjectForMatch("a​b️c")).toBe("a b c");
  });
  it("keeps letters and numbers from any language", () => {
    expect(fn.normalizeSubjectForMatch("Café — 50% off")).toBe("café 50 off");
    expect(fn.normalizeSubjectForMatch("Привет, мир")).toBe("привет мир");
    expect(fn.normalizeSubjectForMatch("日本語のニュース")).toBe("日本語のニュース");
  });
  it("treats nullish as empty", () => {
    expect(fn.normalizeSubjectForMatch(null)).toBe("");
    expect(fn.normalizeSubjectForMatch("")).toBe("");
  });
});

describe("getNormalizedWords", () => {
  it("keeps only tokens of 3+ characters", () => {
    expect(fn.getNormalizedWords("Re: Fwd: Your order #12345 is on its way")).toEqual([
      "fwd",
      "your",
      "order",
      "12345",
      "its",
      "way"
    ]);
  });
  it("returns an empty array for blank or short-only input", () => {
    expect(fn.getNormalizedWords("")).toEqual([]);
    expect(fn.getNormalizedWords("a b c to")).toEqual([]);
  });
});

describe("getWordOverlapScore", () => {
  it("returns 0 when either side is empty", () => {
    expect(fn.getWordOverlapScore([], ["abc"])).toBe(0);
    expect(fn.getWordOverlapScore(["abc"], [])).toBe(0);
  });
  it("is 1 for identical sets and 0 for disjoint sets", () => {
    expect(fn.getWordOverlapScore(["big", "sale"], ["sale", "big"])).toBe(1);
    expect(fn.getWordOverlapScore(["big", "sale"], ["tiny", "fee"])).toBe(0);
  });
  it("divides by the smaller unique-set size", () => {
    expect(fn.getWordOverlapScore(["aaa", "bbb"], ["bbb", "ccc", "ddd"])).toBe(0.5);
    expect(fn.getWordOverlapScore(["aaa"], ["aaa", "bbb", "ccc", "ddd"])).toBe(1);
  });
  it("ignores duplicate tokens", () => {
    expect(fn.getWordOverlapScore(["xxx", "xxx", "yyy"], ["xxx"])).toBe(1);
  });
  it("is symmetric", () => {
    const a = ["one", "two", "three"];
    const b = ["two", "three", "four", "five"];
    expect(fn.getWordOverlapScore(a, b)).toBe(fn.getWordOverlapScore(b, a));
  });
});

describe("parseDateSignature", () => {
  const empty = { canonical: "", dayMonth: "" };

  it("returns empty for blank input", () => {
    expect(fn.parseDateSignature("")).toEqual(empty);
    expect(fn.parseDateSignature(null)).toEqual(empty);
  });
  it("parses Gmail's full title format (weekday, day month year)", () => {
    expect(fn.parseDateSignature("Tue, 4 Nov 2025, 10:42")).toEqual({
      canonical: "2025-11-04",
      dayMonth: "11-04"
    });
  });
  it("parses US-style titles (weekday, month day, year)", () => {
    expect(fn.parseDateSignature("Sat, Nov 1, 2025, 7:05 PM")).toEqual({
      canonical: "2025-11-01",
      dayMonth: "11-01"
    });
  });
  it("parses long-form dates with full weekday and month names", () => {
    expect(fn.parseDateSignature("Tuesday, November 4, 2025 at 10:42 AM")).toEqual({
      canonical: "2025-11-04",
      dayMonth: "11-04"
    });
  });
  it("parses list-view short dates and assumes the current year", () => {
    expect(fn.parseDateSignature("Nov 3")).toEqual({ canonical: `${YEAR}-11-03`, dayMonth: "11-03" });
    expect(fn.parseDateSignature("3 Nov")).toEqual({ canonical: `${YEAR}-11-03`, dayMonth: "11-03" });
    expect(fn.parseDateSignature("September 5")).toEqual({ canonical: `${YEAR}-09-05`, dayMonth: "09-05" });
  });
  it("parses month-day-year and day-month-year with explicit year", () => {
    expect(fn.parseDateSignature("Nov 3, 2024")).toEqual({ canonical: "2024-11-03", dayMonth: "11-03" });
    expect(fn.parseDateSignature("3 Nov 2024")).toEqual({ canonical: "2024-11-03", dayMonth: "11-03" });
  });
  it("does not parse time-only values (today's emails in list view)", () => {
    expect(fn.parseDateSignature("10:42 AM")).toEqual(empty);
    expect(fn.parseDateSignature("10:42 AM (2 hours ago)")).toEqual(empty);
  });
  it("does not parse purely numeric dates", () => {
    expect(fn.parseDateSignature("11/3/24")).toEqual(empty);
  });
  it("ignores words that are not months", () => {
    expect(fn.parseDateSignature("Foo 12")).toEqual(empty);
  });
});

describe("hashString", () => {
  it("returns the FNV-1a offset basis for an empty string", () => {
    expect(fn.hashString("")).toBe("811c9dc5");
  });
  it("is deterministic 8-char hex", () => {
    expect(fn.hashString("a")).toBe("e40c292c");
    expect(fn.hashString("hello")).toBe("4f9f2cab");
    expect(fn.hashString("hello")).toMatch(/^[0-9a-f]{8}$/);
  });
  it("differs for different inputs", () => {
    expect(fn.hashString("abc")).not.toBe(fn.hashString("abd"));
  });
});

describe("buildMessageSignature", () => {
  const sig = () =>
    fn.buildMessageSignature({
      sender: " News@Shop.Example ",
      heading: "Shop   Newsletter",
      subject: "Re: Weekly deals: 50% off everything!!",
      dateText: "Tue, 4 Nov 2025, 10:42"
    });

  it("normalizes each field", () => {
    const s = sig();
    expect(s.sender).toBe("news@shop.example");
    expect(s.heading).toBe("shop newsletter");
    expect(s.subject).toBe("re weekly deals 50 off everything");
    expect(s.subjectWords).toEqual(["weekly", "deals", "off", "everything"]);
    expect(s.dateCanonical).toBe("2025-11-04");
    expect(s.dateDayMonth).toBe("11-04");
  });
  it("uses the first 28 normalized subject characters as the core", () => {
    const s = sig();
    expect(s.subjectCore).toBe("re weekly deals 50 off every");
    expect(s.subjectCore).toHaveLength(28);
  });
  it("fingerprints sender|subjectCore|dayMonth", () => {
    const s = sig();
    expect(s.fingerprint).toBe(fn.hashString(`news@shop.example|${s.subjectCore}|11-04`));
  });
  it("fingerprint ignores heading and year", () => {
    const a = sig();
    const b = fn.buildMessageSignature({
      sender: "news@shop.example",
      heading: "Someone Else",
      subject: "Re: Weekly deals: 50% off everything",
      dateText: "Mon, 4 Nov 2024"
    });
    expect(b.fingerprint).toBe(a.fingerprint);
    expect(b.dateCanonical).not.toBe(a.dateCanonical);
  });
  it("handles missing fields", () => {
    const s = fn.buildMessageSignature({});
    expect(s).toMatchObject({ sender: "", heading: "", subject: "", subjectWords: [], subjectCore: "" });
    expect(s.fingerprint).toBe(fn.hashString("||"));
  });
});

describe("scoreRowAgainstEmailSignature", () => {
  const ZERO = { total: 0, sender: 0, subject: 0, heading: 0, date: 0, fingerprint: 0 };
  const build = (overrides = {}) =>
    fn.buildMessageSignature({
      sender: "news@shop.example",
      heading: "Shop Newsletter",
      subject: "Weekly deals: 50% off everything",
      dateText: "Tue, 4 Nov 2025, 10:42",
      ...overrides
    });

  it("scores zero when senders differ or are missing", () => {
    expect(fn.scoreRowAgainstEmailSignature(build({ sender: "other@x.com" }), build())).toEqual(ZERO);
    expect(fn.scoreRowAgainstEmailSignature(build({ sender: "" }), build())).toEqual(ZERO);
    expect(fn.scoreRowAgainstEmailSignature(build(), build({ sender: "" }))).toEqual(ZERO);
  });
  it("gives the maximum score (14) for an identical message", () => {
    expect(fn.scoreRowAgainstEmailSignature(build(), build())).toEqual({
      total: 14,
      sender: 5,
      subject: 4,
      heading: 1,
      date: 2,
      fingerprint: 2
    });
  });
  it("treats a row subject that includes the preview text as a direct match", () => {
    const row = build({ subject: "Weekly deals: 50% off everything - Shop now before the sale ends" });
    const score = fn.scoreRowAgainstEmailSignature(row, build());
    expect(score.subject).toBe(4);
  });
  it("matches 'Re:'-prefixed subjects by containment", () => {
    const row = build({ subject: "Weekly deals" });
    const email = build({ subject: "Re: Fwd: Weekly deals" });
    expect(fn.scoreRowAgainstEmailSignature(row, email).subject).toBe(4);
  });
  it("tiers subject word overlap (>=0.7 -> 3, >=0.45 -> 2, else 0)", () => {
    const email = build({ subject: "big summer sale on shoes today" });
    const high = build({ subject: "summer sale shoes today only" });
    const mid = build({ subject: "huge summer sale shoes boots" });
    const low = build({ subject: "winter coats sale" });
    expect(fn.scoreRowAgainstEmailSignature(high, email).subject).toBe(3);
    expect(fn.scoreRowAgainstEmailSignature(mid, email).subject).toBe(2);
    expect(fn.scoreRowAgainstEmailSignature(low, email).subject).toBe(0);
  });
  it("gives 1 date point (and keeps fingerprint) when only day/month match", () => {
    const score = fn.scoreRowAgainstEmailSignature(build({ dateText: "Mon, 4 Nov 2024" }), build());
    expect(score.date).toBe(1);
    expect(score.fingerprint).toBe(2);
    expect(score.total).toBe(13);
  });
  it("gives heading credit on partial containment", () => {
    expect(fn.scoreRowAgainstEmailSignature(build({ heading: "Shop" }), build()).heading).toBe(1);
    expect(fn.scoreRowAgainstEmailSignature(build({ heading: "Other" }), build()).heading).toBe(0);
  });
  it("scores a sparse row (sender + exact date only) at 7", () => {
    const row = build({ subject: "", heading: "" });
    expect(fn.scoreRowAgainstEmailSignature(row, build()).total).toBe(7);
  });
  it("orders candidates: exact > same subject other day > sender only", () => {
    const email = build();
    const exact = fn.scoreRowAgainstEmailSignature(build(), email).total;
    const otherDay = fn.scoreRowAgainstEmailSignature(build({ dateText: "Nov 20, 2025" }), email).total;
    const senderOnly = fn.scoreRowAgainstEmailSignature(
      build({ subject: "Something unrelated", heading: "", dateText: "" }),
      email
    ).total;
    expect(exact).toBeGreaterThan(otherDay);
    expect(otherDay).toBeGreaterThan(senderOnly);
    expect(senderOnly).toBe(5);
  });
});

describe("findCurrentRowIndex (plain-object rows, src/matching.js)", () => {
  it("matches by token, then id, then signature using the default plain accessors", () => {
    const signature = fn.buildMessageSignature({
      sender: "news@shop.example",
      subject: "Weekly deals",
      dateText: "Nov 4, 2025"
    });
    const rows = [
      { threadToken: "aaa", threadId: "1", signature: fn.buildMessageSignature({ sender: "x@y.z" }) },
      { threadToken: "bbb", threadId: "2", signature }
    ];
    expect(fn.findCurrentRowIndex(rows, { ...signature, threadToken: "bbb" })).toEqual({
      index: 1,
      approach: "thread-token"
    });
    expect(fn.findCurrentRowIndex(rows, { ...signature, threadId: "1" })).toEqual({
      index: 0,
      approach: "thread-id"
    });
    expect(fn.findCurrentRowIndex(rows, signature).index).toBe(1);
  });
});

describe("findCurrentRowIndex (Gmail DOM rows)", () => {
  let rows;
  // DOM rows need the content script's row readers; the pure matching.js version takes
  // accessors, so use the DOM-bound wrapper exposed by the content-script test hook.
  const domFn = {};
  const makeRow = ({ email, name, subject, date }) => {
    const tr = document.createElement("tr");
    tr.className = "zA";
    tr.setAttribute("role", "row");
    tr.innerHTML = `
      <td class="yX"><span class="yP" email="${email}" name="${name}">${name}</span></td>
      <td class="xY"><span class="bog">${subject}</span></td>
      <td class="xW"><span title="${date}">x</span></td>`;
    return tr;
  };

  beforeAll(() => {
    const { exports } = loadContentScripts();
    domFn.findCurrentRowIndex = exports.findCurrentRowIndexInDom;
    document.body.innerHTML = readFixtureBody("gmail-list.html");
    rows = [...document.querySelectorAll("tr.zA")];
  });

  it("matches by thread URL token first", () => {
    const sig = { ...fn.buildMessageSignature({ sender: "nobody@x.com" }), threadToken: "fmfcgzqaaaaa0000" };
    expect(domFn.findCurrentRowIndex(rows, sig)).toEqual({ index: 0, approach: "thread-token" });
  });
  it("falls back to the legacy thread id", () => {
    const sig = {
      ...fn.buildMessageSignature({ sender: "nobody@x.com" }),
      threadToken: "doesnotexist",
      threadId: "18c0000000000c03"
    };
    expect(domFn.findCurrentRowIndex(rows, sig)).toEqual({ index: 2, approach: "thread-id" });
  });
  it("matches by strict signature when ids are absent", () => {
    const sig = fn.buildMessageSignature({
      sender: "News@Shop.Example",
      heading: "Shop Newsletter",
      subject: "Weekly deals: 50% off everything",
      dateText: "Tue, 4 Nov 2025, 10:42"
    });
    expect(domFn.findCurrentRowIndex(rows, sig)).toEqual({ index: 1, approach: "strict-signature", score: 14 });
  });
  it("uses the sparse fallback for a unique sender + exact date candidate", () => {
    const sig = fn.buildMessageSignature({ sender: "news@shop.example", dateText: "Wed, 5 Nov 2025" });
    expect(domFn.findCurrentRowIndex(rows, sig)).toEqual({
      index: 2,
      approach: "sparse-signature-fallback",
      score: 7
    });
  });
  it("refuses the sparse fallback when the best candidate is ambiguous", () => {
    const twins = [
      makeRow({ email: "a@b.com", name: "A", subject: "First", date: "Wed, 5 Nov 2025" }),
      makeRow({ email: "a@b.com", name: "A", subject: "Second", date: "Wed, 5 Nov 2025" })
    ];
    const sig = fn.buildMessageSignature({ sender: "a@b.com", dateText: "Wed, 5 Nov 2025" });
    expect(domFn.findCurrentRowIndex(twins, sig)).toEqual({ index: -1, approach: "none" });
  });
  it("returns none for an unknown sender or empty rows", () => {
    const sig = fn.buildMessageSignature({ sender: "stranger@x.com", subject: "Hi", dateText: "Nov 4, 2025" });
    expect(domFn.findCurrentRowIndex(rows, sig)).toEqual({ index: -1, approach: "none" });
    expect(domFn.findCurrentRowIndex([], sig)).toEqual({ index: -1, approach: "none" });
  });
  it("reports progress via onStatus with a page prefix", () => {
    const messages = [];
    const sig = fn.buildMessageSignature({ sender: "stranger@x.com" });
    domFn.findCurrentRowIndex(rows, sig, { onStatus: (m) => messages.push(m), pageNumber: 2 });
    expect(messages.length).toBeGreaterThan(0);
    expect(messages.every((m) => m.startsWith("Page 2: "))).toBe(true);
    expect(messages[0]).toMatch(/Approach 1\/4/);
    expect(messages.at(-1)).toMatch(/Approach 4\/4.*no match/);
  });
});

describe("escapeHtml", () => {
  it("escapes all five HTML-significant characters", () => {
    expect(fn.escapeHtml(`<a href="x">Tom & 'Jerry'</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;Tom &amp; &#039;Jerry&#039;&lt;/a&gt;"
    );
  });
  it("escapes ampersands first (no double-escape shortcut)", () => {
    expect(fn.escapeHtml("&lt;")).toBe("&amp;lt;");
  });
  it("leaves plain text unchanged", () => {
    expect(fn.escapeHtml("Go to Inbox")).toBe("Go to Inbox");
    expect(fn.escapeHtml("")).toBe("");
  });
});
