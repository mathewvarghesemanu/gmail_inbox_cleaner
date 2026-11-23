// Delete Listed Emails (this page / all pages): opt-in via popup, asks first unless
// skipped, hidden options never run, never clicks "Delete forever".
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadContentScripts } from "./load-content.js";

const ENABLED = "deleteOpenEmailEnabled";
const SKIP = "deleteSkipConfirmation";

function load(storage = {}) {
  loadContentScripts({ fixture: "gmail-list.html", hash: "#inbox", storage });
  const GC = window.__gc;
  GC.mountSidebar();
  return GC;
}

function addGmailButton(label, attrs = {}) {
  const btn = document.createElement("div");
  btn.setAttribute("role", "button");
  btn.setAttribute("aria-label", label);
  Object.entries(attrs).forEach(([k, v]) => btn.setAttribute(k, v));
  const onClick = vi.fn();
  btn.addEventListener("click", onClick);
  document.querySelector("div[gh='mtb']").appendChild(btn);
  return { btn, onClick };
}

const radio = (id) => document.querySelector(`.gc-action-checkbox[data-action-id='${id}']`);
const confirmVisible = () => document.getElementById("gc-confirm").classList.contains("gc-confirm-visible");

beforeEach(() => {
  vi.spyOn(Element.prototype, "getClientRects").mockReturnValue([{ width: 1, height: 1 }]);
});
afterEach(() => vi.restoreAllMocks());

describe("delete options in the sidebar", () => {
  it("are hidden until enabled, and the section is renamed live", () => {
    const GC = load();
    const rows = [...document.querySelectorAll(".gc-delete-row")];
    const title = document.getElementById("gc-archive-section-title");
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.classList.contains("gc-hidden"))).toBe(true);
    expect(title.textContent).toBe("Archive");

    chrome.storage.local.set({ [ENABLED]: true });
    expect(rows.some((r) => r.classList.contains("gc-hidden"))).toBe(false);
    expect(title.textContent).toBe("Archive or Delete");
    expect(radio(GC.ACTION_BUTTON_IDS.DELETE_ALL_PAGES).name).toBe("gc-archive-mode");
  });

  it("clears a selected delete option when turned off, so Execute Selected never runs it", () => {
    const GC = load({ [ENABLED]: true });
    const id = GC.ACTION_BUTTON_IDS.DELETE_ALL_PAGES;
    radio(id).checked = true;
    expect(GC.getSelectedActionIds()).toContain(id);
    chrome.storage.local.set({ [ENABLED]: false });
    expect(radio(id).checked).toBe(false);
    expect(GC.getSelectedActionIds()).not.toContain(id);
  });

  it("still returns selections while the whole sidebar is hidden (shortcut runs)", () => {
    const GC = load();
    const id = GC.ACTION_BUTTON_IDS.ARCHIVE_ALL_PAGES;
    radio(id).checked = true;
    expect(document.getElementById("gc-root").classList.contains("gc-hidden")).toBe(true);
    expect(GC.getSelectedActionIds()).toContain(id);
  });

  it("ignores a checked option whose row is hidden", () => {
    const GC = load();
    const id = GC.ACTION_BUTTON_IDS.DELETE_THIS_PAGE;
    radio(id).checked = true;
    expect(GC.getSelectedActionIds()).not.toContain(id);
  });
});

describe("delete safety", () => {
  it("refuses to run when Delete is turned off", async () => {
    const GC = load();
    const { onClick } = addGmailButton("Delete");
    await GC.actionDeleteThisPage();
    await GC.actionDeleteAllPages();
    expect(onClick).not.toHaveBeenCalled();
    const logged = vi
      .mocked(console.log)
      .mock.calls.map((c) => String(c[0]))
      .join("\n");
    expect(logged).toMatch(/Delete is turned off/);
  });

  it("asks with Delete / Cancel and never auto-proceeds", async () => {
    vi.useFakeTimers();
    const GC = load({ [ENABLED]: true });
    const pending = GC.confirmDelete("Delete 3 conversations?", { skipConfirm: false });
    expect(confirmVisible()).toBe(true);
    expect(document.getElementById("gc-confirm-proceed").textContent).toBe("Delete");
    expect(document.getElementById("gc-confirm-stop").textContent).toBe("Cancel");
    await vi.advanceTimersByTimeAsync(10000);
    expect(confirmVisible()).toBe(true);
    document.getElementById("gc-confirm-stop").click();
    await expect(pending).resolves.toBe(false);
    expect(document.getElementById("gc-confirm-stop").textContent).toBe("Stop");
    vi.useRealTimers();
  });

  it("cancelling stops a running Execute Selected", async () => {
    const GC = load({ [ENABLED]: true });
    GC.state.batchExecuting = true;
    const pending = GC.confirmDelete("Delete?", { skipConfirm: false });
    document.getElementById("gc-confirm-stop").click();
    await pending;
    expect(GC.state.stopExecutionRequested).toBe(true);
  });

  it("skips the question only when that popup toggle is on", async () => {
    const GC = load({ [ENABLED]: true, [SKIP]: true });
    await expect(GC.confirmDelete("Delete?", await GC.readDeleteSettings())).resolves.toBe(true);
    expect(confirmVisible()).toBe(false);
  });

  it("never matches Delete forever or the extension's own buttons", () => {
    const GC = load({ [ENABLED]: true });
    const { btn: forever } = addGmailButton("Delete forever", { act: "10" });
    expect(GC.isGmailDeleteControl(forever)).toBe(false);
    expect(GC.isGmailDeleteControl(document.getElementById(GC.ACTION_BUTTON_IDS.DELETE_THIS_PAGE))).toBe(false);
    const { btn: real } = addGmailButton("Delete");
    expect(GC.findDeleteControl()).toBe(real);
  });

  it("has no keyboard fallback: no Delete button means nothing is deleted", async () => {
    const GC = load({ [ENABLED]: true });
    const keys = vi.spyOn(GC, "triggerKeySequence");
    await expect(GC.applyToSelected("delete")).rejects.toThrow(/Nothing was deleted/);
    expect(keys).not.toHaveBeenCalled();
  });
});
