// Delete Open Email: opt-in via popup, confirmation unless skipped, never "Delete forever".
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadContentScripts } from "./load-content.js";

const ENABLED = "deleteOpenEmailEnabled";
const SKIP = "deleteSkipConfirmation";

function load(storage = {}) {
  loadContentScripts({ fixture: "gmail-thread.html", hash: "#inbox/FMfcgzQBBBBB1111", storage });
  const GC = window.__gc;
  GC.mountSidebar();
  // Gmail's Delete button in the open-thread toolbar; clicking it leaves the thread view.
  const del = document.createElement("div");
  del.setAttribute("role", "button");
  del.setAttribute("aria-label", "Delete");
  del.setAttribute("data-tooltip", "Delete");
  const onClick = vi.fn(() => document.querySelector("h2.hP")?.remove());
  del.addEventListener("click", onClick);
  document.querySelector("div[gh='mtb']").appendChild(del);
  return { GC, del, onClick };
}

beforeEach(() => {
  vi.spyOn(Element.prototype, "getClientRects").mockReturnValue([{ width: 1, height: 1 }]);
});
afterEach(() => vi.restoreAllMocks());

describe("Delete Open Email visibility", () => {
  it("is hidden unless enabled in the popup, and follows the toggle live", () => {
    const { GC } = load();
    const row = document.getElementById("gc-delete-row");
    expect(row.classList.contains("gc-hidden")).toBe(true);
    chrome.storage.local.set({ [ENABLED]: true });
    expect(row.classList.contains("gc-hidden")).toBe(false);
    chrome.storage.local.set({ [ENABLED]: false });
    expect(row.classList.contains("gc-hidden")).toBe(true);
    expect(GC.getSelectedActionIds()).not.toContain(GC.ACTION_BUTTON_IDS.DELETE_OPEN_EMAIL);
  });
});

describe("actionDeleteOpenEmail", () => {
  it("does nothing when Delete is turned off", async () => {
    const { GC, onClick } = load();
    await GC.actionDeleteOpenEmail();
    expect(onClick).not.toHaveBeenCalled();
  });

  it("asks first and deletes nothing when cancelled", async () => {
    const { GC, onClick } = load({ [ENABLED]: true });
    const run = GC.actionDeleteOpenEmail();
    await vi.waitFor(() =>
      expect(document.getElementById("gc-confirm").classList.contains("gc-confirm-visible")).toBe(true)
    );
    expect(document.getElementById("gc-confirm-message").textContent).toMatch(/Delete this email from/);
    expect(document.getElementById("gc-confirm-proceed").textContent).toBe("Delete");
    document.getElementById("gc-confirm-stop").click();
    await run;
    expect(onClick).not.toHaveBeenCalled();
    expect(document.getElementById("gc-confirm-stop").textContent).toBe("Stop");
  });

  it("deletes after confirming", async () => {
    const { GC, onClick } = load({ [ENABLED]: true });
    const run = GC.actionDeleteOpenEmail();
    await vi.waitFor(() =>
      expect(document.getElementById("gc-confirm").classList.contains("gc-confirm-visible")).toBe(true)
    );
    document.getElementById("gc-confirm-proceed").click();
    await run;
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("skips the confirmation only when that toggle is on", async () => {
    const { GC, onClick } = load({ [ENABLED]: true, [SKIP]: true });
    await GC.actionDeleteOpenEmail();
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(document.getElementById("gc-confirm").classList.contains("gc-confirm-visible")).toBe(false);
  });
});

describe("isGmailDeleteControl", () => {
  it("never matches Delete forever or the extension's own button", () => {
    const { GC } = load({ [ENABLED]: true });
    const forever = document.createElement("div");
    forever.setAttribute("role", "button");
    forever.setAttribute("aria-label", "Delete forever");
    forever.setAttribute("act", "10");
    document.body.appendChild(forever);
    expect(GC.isGmailDeleteControl(forever)).toBe(false);
    const own = document.getElementById(GC.ACTION_BUTTON_IDS.DELETE_OPEN_EMAIL);
    expect(GC.isGmailDeleteControl(own)).toBe(false);
  });
});
