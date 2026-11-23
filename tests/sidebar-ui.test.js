// Sidebar UI behaviors: option toggling, control states and feedback.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadContentScripts } from "./load-content.js";

function load(storage = {}) {
  loadContentScripts({ fixture: "gmail-list.html", hash: "#inbox", storage });
  const GC = window.__gc;
  GC.mountSidebar();
  return GC;
}

/** Enables the option inputs (they are disabled while no email is open). */
function enableInputs() {
  document.querySelectorAll(".gc-action-checkbox").forEach((el) => {
    el.disabled = false;
  });
}

const input = (id) => document.querySelector(`.gc-action-checkbox[data-action-id='${id}']`);

/** Simulates a real mouse click (mousedown then click) on el. */
function userClick(el) {
  el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  el.click();
}

beforeEach(() => {
  vi.spyOn(Element.prototype, "getClientRects").mockReturnValue([{ width: 1, height: 1 }]);
});
afterEach(() => vi.restoreAllMocks());

describe("radio options", () => {
  it("clear when the checked radio is clicked again", () => {
    const GC = load();
    enableInputs();
    const archiveAll = input(GC.ACTION_BUTTON_IDS.ARCHIVE_ALL_PAGES);
    archiveAll.checked = false;

    userClick(archiveAll);
    expect(archiveAll.checked).toBe(true);
    expect(GC.getSelectedActionIds()).toContain(GC.ACTION_BUTTON_IDS.ARCHIVE_ALL_PAGES);

    userClick(archiveAll);
    expect(archiveAll.checked).toBe(false);
    expect(GC.getSelectedActionIds()).not.toContain(GC.ACTION_BUTTON_IDS.ARCHIVE_ALL_PAGES);
  });

  it("still switch within a group", () => {
    const GC = load();
    enableInputs();
    const thisPage = input(GC.ACTION_BUTTON_IDS.ARCHIVE_THIS_PAGE);
    const allPages = input(GC.ACTION_BUTTON_IDS.ARCHIVE_ALL_PAGES);
    userClick(thisPage);
    expect(thisPage.checked).toBe(true);
    userClick(allPages);
    expect(allPages.checked).toBe(true);
    expect(thisPage.checked).toBe(false);
  });
});

describe("context bar", () => {
  it("explains disabled actions when no email is open", () => {
    load();
    const bar = document.getElementById("gc-context");
    expect(bar.classList.contains("gc-context-sender")).toBe(false);
    expect(bar.textContent).toMatch(/open an email/i);
  });

  it("shows the detected sender once an email is open", () => {
    loadContentScripts({ fixture: "gmail-thread.html", hash: "#inbox/FMfcgzQBBBBB1111" });
    window.__gc.refreshOpenEmailState();
    const bar = document.getElementById("gc-context");
    expect(bar.textContent).not.toMatch(/open an email/i);
    expect(bar.classList.contains("gc-context-sender")).toBe(true);
    expect(bar.querySelector(".gc-context-value").textContent.toLowerCase()).toBe("news@shop.example");
  });
});

describe("next email preview", () => {
  it("shows one line with sender and subject, without internal ids", () => {
    const GC = load();
    enableInputs();
    const goNext = input(GC.ACTION_BUTTON_IDS.GO_TO_NEXT_PAGE);
    goNext.checked = true;
    GC.state.nextTarget = { ...GC.createEmptyNextTarget(), url: "https://mail.google.com/#inbox/x",
      sender: "a@b.example", subject: "Hello", threadToken: "SECRET-TOKEN" };
    GC.renderNextEmailTargetSection();
    const section = document.getElementById("gc-next-target-section");
    expect(section.classList.contains("gc-hidden")).toBe(false);
    expect(section.textContent).toContain("a@b.example – Hello");
    expect(section.textContent).not.toContain("SECRET-TOKEN");
  });
});

describe("archive / delete scope rows", () => {
  it("use short visible labels but keep full names for toasts and tooltips", () => {
    const GC = load();
    const button = document.getElementById(GC.ACTION_BUTTON_IDS.ARCHIVE_ALL_PAGES);
    expect(button.textContent).toBe("All pages");
    expect(GC.getButtonLabel(button)).toBe(GC.LABELS.ARCHIVE_ALL_PAGES);
    expect(button.getAttribute("aria-label")).toBe(GC.LABELS.ARCHIVE_ALL_PAGES);
  });

  it("hide the whole delete group until delete is enabled", () => {
    const GC = load();
    const group = document.querySelector(".gc-delete-group");
    expect(group.classList.contains("gc-hidden")).toBe(true);
    GC.setDeleteFeatureVisibility(true);
    expect(group.classList.contains("gc-hidden")).toBe(false);
  });
});

describe("working progress", () => {
  it("shows the current step and progress, and clears them when work ends", () => {
    const GC = load();
    GC.setWorking(true);
    GC.setWorkingStep("Step 2/3: Archive all pages", GC.ACTION_BUTTON_IDS.ARCHIVE_ALL_PAGES);
    GC.setProgress(GC.STRINGS.ui.bulkProgress(3, 150, "archived"));
    const working = document.getElementById("gc-working");
    expect(working.textContent).toContain("Step 2/3: Archive all pages");
    expect(working.textContent).toContain("Page 3 · 150 archived");
    const row = document.getElementById(GC.ACTION_BUTTON_IDS.ARCHIVE_ALL_PAGES).closest(".gc-action-row");
    expect(row.classList.contains("gc-row-active")).toBe(true);

    GC.setWorking(false);
    expect(working.querySelector(".gc-working-text").textContent).toBe(GC.STRINGS.ui.working);
    expect(working.querySelector(".gc-working-detail").classList.contains("gc-hidden")).toBe(true);
    expect(row.classList.contains("gc-row-active")).toBe(false);
  });
});

describe("status area", () => {
  it("replaces the static log and success badge with one typed message area", () => {
    load();
    expect(document.getElementById("gc-log")).toBeNull();
    expect(document.getElementById("gc-success")).toBeNull();
    const status = document.getElementById("gc-status");
    for (const id of ["gc-confirm", "gc-toast", "gc-undo"]) {
      expect(status.contains(document.getElementById(id))).toBe(true);
    }
  });

  it("styles errors and announces them assertively", () => {
    const GC = load();
    GC.reportError("Could not find Gmail's Delete button.");
    const toast = document.getElementById("gc-toast");
    expect(toast.textContent).toBe("Could not find Gmail's Delete button.");
    expect(toast.dataset.type).toBe("error");
    expect(toast.getAttribute("role")).toBe("alert");
  });
});

describe("execute / stop button", () => {
  it("shows Stop in place of Execute only while a batch runs", () => {
    const GC = load();
    const execute = document.getElementById("gc-execute-selected");
    const stop = document.getElementById("gc-stop-execution");
    expect(execute.classList.contains("gc-hidden")).toBe(false);
    expect(stop.classList.contains("gc-hidden")).toBe(true);

    GC.state.batchExecuting = true;
    GC.setWorking(true);
    expect(execute.classList.contains("gc-hidden")).toBe(true);
    expect(stop.classList.contains("gc-hidden")).toBe(false);
    expect(stop.disabled).toBe(false);

    GC.state.batchExecuting = false;
    GC.setWorking(false);
    expect(execute.classList.contains("gc-hidden")).toBe(false);
    expect(stop.classList.contains("gc-hidden")).toBe(true);
  });
});
