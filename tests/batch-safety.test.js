// Regressions for button combinations that could act on the wrong sender or
// carry on after a failed step:
//   1. a stale sender lock let Archive / Delete act on the previous sender;
//   2. a failed Select Like Open left the previous sender locked;
//   3. a failed step did not stop Execute Selected;
//   4. Unsubscribe + Go to Next Email prepared no next-email target;
//   5. "Undo archive" stayed offered after navigating away;
//   6. Show Archived was not scoped to the sender.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadContentScripts } from "./load-content.js";

const OPEN_SENDER = "news@shop.example";
const OTHER_SENDER = "old@other.example";

function loadThread() {
  loadContentScripts({ fixture: "gmail-thread.html", hash: "#inbox/FMfcgzQBBBBB1111" });
  const GC = window.__gc;
  GC.mountSidebar();
  return GC;
}

function loadList() {
  loadContentScripts({ fixture: "gmail-list.html", hash: "#inbox" });
  const GC = window.__gc;
  GC.mountSidebar();
  return GC;
}

function lockTo(GC, sender) {
  GC.state.lockedSender = sender;
  GC.state.lockedQuery = `from:${sender} in:inbox`;
}

const check = (id) => {
  document.querySelector(`.gc-action-checkbox[data-action-id='${id}']`).checked = true;
};

beforeEach(() => {
  vi.spyOn(Element.prototype, "getClientRects").mockReturnValue([{ width: 1, height: 1 }]);
});
afterEach(() => vi.restoreAllMocks());

describe("sender lock", () => {
  it("refuses Archive / Delete when the open email is from a different sender", async () => {
    const GC = loadThread();
    lockTo(GC, OTHER_SENDER);
    await expect(GC.ensureQueryReady()).rejects.toThrow(
      `open email is from ${OPEN_SENDER}, but the selection is locked to ${OTHER_SENDER}`
    );
    expect(GC.state.lockedSender).toBe("");
    expect(GC.state.lockedQuery).toBe("");
  });

  it("is dropped when an email from a different sender is opened", () => {
    const GC = loadThread();
    lockTo(GC, OTHER_SENDER);
    GC.refreshOpenEmailState();
    expect(GC.state.lockedSender).toBe("");
  });

  it("is kept while the open email is from the locked sender", () => {
    const GC = loadThread();
    lockTo(GC, OPEN_SENDER);
    GC.refreshOpenEmailState();
    expect(GC.state.lockedSender).toBe(OPEN_SENDER);
  });

  it("is dropped before Select Like Open runs, so a failed search cannot keep the old sender", async () => {
    const GC = loadList(); // no open email: Select Like Open fails
    lockTo(GC, OTHER_SENDER);
    await GC.actionSelectLikeOpen();
    expect(GC.state.lockedSender).toBe("");
    expect(GC.state.lockedQuery).toBe("");
  });
});

describe("Execute Selected after a failed step", () => {
  it("stops and skips the remaining steps", async () => {
    const GC = loadList();
    const ids = GC.ACTION_BUTTON_IDS;
    lockTo(GC, OTHER_SENDER); // would be archived if the batch carried on
    check(ids.SELECT_LIKE_OPEN);
    check(ids.ARCHIVE_THIS_PAGE);
    const log = vi.spyOn(console, "log");
    await GC.executeSelectedActions();
    const lines = log.mock.calls.map((c) => String(c[0]));
    expect(lines.some((l) => l.includes("Execution failed") && l.includes("skipped the remaining 1 step"))).toBe(true);
    expect(lines.some((l) => l.includes("Selecting conversations on current page"))).toBe(false);
    expect(GC.state.batchExecuting).toBe(false);
    expect(GC.state.batchStepError).toBe("");
  });

  it("keeps going after an Unsubscribe failure", () => {
    const GC = loadList();
    const ids = GC.ACTION_BUTTON_IDS;
    expect(GC.shouldStopAfterFailedStep(ids.UNSUBSCRIBE)).toBe(false);
    expect(GC.shouldStopAfterFailedStep(ids.SELECT_LIKE_OPEN)).toBe(true);
    expect(GC.shouldStopAfterFailedStep(ids.ARCHIVE_ALL_PAGES)).toBe(true);
  });
});

describe("next-email target preparation", () => {
  it("runs whenever another step comes before Go to Next Email", () => {
    const GC = loadList();
    const ids = GC.ACTION_BUTTON_IDS;
    expect(GC.shouldPrepareNextEmailTargetForBatch([ids.UNSUBSCRIBE, ids.GO_TO_NEXT_PAGE])).toBe(true);
    expect(GC.shouldPrepareNextEmailTargetForBatch([ids.ARCHIVE_THIS_PAGE, ids.GO_TO_NEXT_PAGE])).toBe(true);
    expect(GC.shouldPrepareNextEmailTargetForBatch([ids.GO_TO_NEXT_PAGE])).toBe(false);
    expect(GC.shouldPrepareNextEmailTargetForBatch([ids.UNSUBSCRIBE, ids.GO_TO_INBOX])).toBe(false);
  });
});

describe("undo offers after navigating", () => {
  const visible = () => document.getElementById("gc-undo").classList.contains("gc-undo-visible");

  it("hides Gmail's Undo archive, which no longer applies", () => {
    const GC = loadList();
    GC.offerGmailUndo("archive");
    expect(visible()).toBe(true);
    GC.hideGmailUndoOffer();
    expect(visible()).toBe(false);
  });

  it("keeps Undo all, which names its sender", () => {
    const GC = loadList();
    GC.offerUndoAllArchive(OTHER_SENDER);
    GC.hideGmailUndoOffer();
    expect(visible()).toBe(true);
    expect(document.getElementById("gc-undo-message").textContent).toContain(OTHER_SENDER);
  });
});

describe("Show Archived", () => {
  it("searches the open email's sender", () => {
    const GC = loadThread();
    const sender = GC.getShowArchivedSender();
    expect(sender).toBe(OPEN_SENDER);
    expect(GC.buildArchivedQuery(sender)).toBe(`from:${OPEN_SENDER} -in:inbox -in:sent -in:drafts -in:spam -in:trash`);
  });

  it("falls back to the locked sender, then to all archived mail", () => {
    const GC = loadList();
    expect(GC.getShowArchivedSender()).toBe("");
    expect(GC.buildArchivedQuery("")).toBe("-in:inbox -in:sent -in:drafts -in:spam -in:trash");
    lockTo(GC, OTHER_SENDER);
    expect(GC.getShowArchivedSender()).toBe(OTHER_SENDER);
  });
});
