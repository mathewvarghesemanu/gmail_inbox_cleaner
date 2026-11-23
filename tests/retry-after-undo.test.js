// Regression: re-running Execute Selected on a sender after Undo did nothing.
// The next-email scan reused the sender-scoped search (from:x in:inbox, or the
// from:x -in:inbox search left by Undo all), which can never contain a different
// sender, so target preparation failed and the whole batch silently aborted.
import { describe, expect, it } from "vitest";
import { loadContentScripts } from "./load-content.js";

function loadGc() {
  loadContentScripts({ fixture: "gmail-thread.html", hash: "#inbox/FMfcgzQBBBBB1111" });
  return window.__gc;
}

describe("next-email discovery context", () => {
  it("never scans a sender-scoped locked search for a different sender", () => {
    const GC = loadGc();
    GC.state.lockedSender = "news@shop.example";
    GC.state.lockedQuery = "from:news@shop.example in:inbox";
    expect(GC.canUseLockedSearchForDiscovery("news@shop.example")).toBe(false);
  });

  it("never scans the -in:inbox search left behind by Undo all", () => {
    const GC = loadGc();
    GC.state.lockedSender = "";
    GC.state.lockedQuery = "";
    GC.state.query = "from:news@shop.example -in:inbox";
    expect(GC.canUseLockedSearchForDiscovery("news@shop.example")).toBe(false);
  });
});

describe("Execute Selected when no next email can be found", () => {
  it("drops Go to Next Email and keeps the other actions", async () => {
    // List view has no open email, so preparing the target fails fast.
    loadContentScripts({ fixture: "gmail-list.html", hash: "#inbox" });
    const GC = window.__gc;
    const ids = GC.ACTION_BUTTON_IDS;
    const selected = [ids.UNSUBSCRIBE, ids.SELECT_LIKE_OPEN, ids.ARCHIVE_ALL_PAGES, ids.GO_TO_NEXT_PAGE];
    const result = await GC.prepareNextEmailTargetOrSkip(selected).catch((e) => e);
    expect(Array.isArray(result)).toBe(true);
    expect(result).not.toContain(ids.GO_TO_NEXT_PAGE);
    expect(result).toEqual([ids.UNSUBSCRIBE, ids.SELECT_LIKE_OPEN, ids.ARCHIVE_ALL_PAGES]);
  });
});
