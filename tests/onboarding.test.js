// First-run sidebar onboarding: toggle pulse, then a one-time coach tour.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadContentScripts } from "./load-content.js";

const SEEN = "onboardingSidebarSeen";

function load(storage = {}) {
  const { chrome } = loadContentScripts({ fixture: "gmail-list.html", hash: "#inbox", storage });
  const GC = window.__gc;
  GC.mountSidebar();
  return { GC, chrome };
}

const toggle = () => document.getElementById("gc-toggle");
const coach = () => document.getElementById("gc-coach");
const openPanel = () => toggle().click();
const highlighted = () => document.querySelector(".gc-coach-target");

beforeEach(() => {
  vi.spyOn(Element.prototype, "getClientRects").mockReturnValue([{ width: 1, height: 1 }]);
});
afterEach(() => vi.restoreAllMocks());

describe("sidebar onboarding", () => {
  it("pulses the toggle for first-time users, but not after the tour", () => {
    load();
    expect(toggle().classList.contains("gc-toggle-intro")).toBe(true);
    document.body.innerHTML = "";
    load({ [SEEN]: true });
    expect(toggle().classList.contains("gc-toggle-intro")).toBe(false);
  });

  it("walks through three steps on first open, then marks the tour seen", () => {
    const { chrome } = load();
    openPanel();
    expect(toggle().classList.contains("gc-toggle-intro")).toBe(false);
    expect(highlighted()?.classList.contains("gc-section-prepare")).toBe(true);
    expect(coach().textContent).toContain("1 of 3");

    coach().querySelector(".gc-coach-next").click();
    expect(highlighted()?.classList.contains("gc-section-archive")).toBe(true);
    coach().querySelector(".gc-coach-next").click();
    expect(highlighted()?.id).toBe("gc-execute-selected");
    expect(coach().querySelector(".gc-coach-next").textContent).toBe("Got it");

    coach().querySelector(".gc-coach-next").click();
    expect(coach()).toBeNull();
    expect(highlighted()).toBeNull();
    expect(chrome.__store[SEEN]).toBe(true);
  });

  it("can be skipped with the Skip button or Escape", () => {
    const { chrome } = load();
    openPanel();
    coach().querySelector(".gc-coach-skip").click();
    expect(coach()).toBeNull();
    expect(chrome.__store[SEEN]).toBe(true);

    document.body.innerHTML = "";
    const second = load();
    openPanel();
    coach().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(coach()).toBeNull();
    expect(second.chrome.__store[SEEN]).toBe(true);
  });

  it("does not restart the tour when the panel is reopened mid-tour", () => {
    load();
    openPanel();
    coach().querySelector(".gc-coach-next").click();
    document.getElementById("gc-minimize").click();
    openPanel();
    expect(coach().textContent).toContain("2 of 3");
  });

  it("never shows the tour once seen", () => {
    load({ [SEEN]: true });
    openPanel();
    expect(coach()).toBeNull();
  });
});
