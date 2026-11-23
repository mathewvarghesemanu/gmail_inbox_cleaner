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
