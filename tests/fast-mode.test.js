// Fast mode (popup setting): skips settle pauses and auto-proceed countdowns,
// but never skips delete confirmations.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadContentScripts } from "./load-content.js";

const FAST = "fastModeEnabled";

function load(storage = {}) {
  const { chrome } = loadContentScripts({ fixture: "gmail-list.html", hash: "#inbox", storage });
  const GC = window.__gc;
  GC.mountSidebar();
  return { GC, chrome };
}

const confirmVisible = () => document.getElementById("gc-confirm").classList.contains("gc-confirm-visible");
const badgeHidden = () => document.getElementById("gc-fast-badge").classList.contains("gc-hidden");

beforeEach(() => {
  vi.spyOn(Element.prototype, "getClientRects").mockReturnValue([{ width: 1, height: 1 }]);
});
afterEach(() => vi.restoreAllMocks());

describe("fast mode setting", () => {
  it("is off by default", () => {
    const { GC } = load();
    expect(GC.state.fastMode).toBe(false);
    expect(badgeHidden()).toBe(true);
  });

  it("loads from storage and shows the header badge", () => {
    const { GC } = load({ [FAST]: true });
    expect(GC.state.fastMode).toBe(true);
    expect(badgeHidden()).toBe(false);
  });

  it("follows live changes from the popup", () => {
    const { GC, chrome } = load();
    chrome.storage.local.set({ [FAST]: true });
    expect(GC.state.fastMode).toBe(true);
    expect(badgeHidden()).toBe(false);
    chrome.storage.local.set({ [FAST]: false });
    expect(GC.state.fastMode).toBe(false);
    expect(badgeHidden()).toBe(true);
  });
});

describe("fast mode prompts", () => {
  it("proceeds immediately on prompts that would auto-proceed", async () => {
    const { GC } = load({ [FAST]: true });
    const result = GC.askProceedConfirmation("About to archive 40 conversations. Proceed?", { autoProceed: true });
    expect(confirmVisible()).toBe(false);
    await expect(result).resolves.toBe(true);
  });

  it("still shows prompts that never auto-proceed, such as Delete", async () => {
    const { GC } = load({ [FAST]: true });
    const result = GC.askProceedConfirmation("Delete 3 conversations?", {
      proceedLabel: "Delete",
      stopLabel: "Cancel"
    });
    expect(confirmVisible()).toBe(true);
    GC.resolveProceedConfirmation(false);
    await expect(result).resolves.toBe(false);
  });

  it("keeps the countdown when fast mode is off", () => {
    const { GC } = load();
    void GC.askProceedConfirmation("About to archive 40 conversations. Proceed?", { autoProceed: true });
    expect(confirmVisible()).toBe(true);
    expect(document.getElementById("gc-confirm-proceed").textContent).toMatch(/\(\d\)/);
    GC.resolveProceedConfirmation(false);
  });
});

describe("settle pauses", () => {
  it("are skipped in fast mode and kept otherwise", async () => {
    vi.useFakeTimers();
    try {
      const { GC } = load();
      let done = false;
      void GC.settle(500).then(() => (done = true));
      await Promise.resolve();
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(500);
      expect(done).toBe(true);

      GC.setFastMode(true);
      done = false;
      void GC.settle(500).then(() => (done = true));
      await Promise.resolve();
      await Promise.resolve();
      expect(done).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
