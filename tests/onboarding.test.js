// First-run sidebar onboarding: a note points at the toggle, then annotated arrows
// point at the panel's controls until the user dismisses them.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadContentScripts } from "./load-content.js";

const SEEN = "onboardingSidebarSeen";

function load(storage = {}) {
  const { chrome } = loadContentScripts({ fixture: "gmail-list.html", hash: "#inbox", storage });
  const GC = window.__gc;
  GC.mountSidebar();
  GC.refreshCoachOverlay?.();
  return { GC, chrome };
}

const toggle = () => document.getElementById("gc-toggle");
const layer = () => document.getElementById("gc-coach-layer");
const notes = () => [...document.querySelectorAll(".gc-coach-note")];
const openPanel = (GC) => {
  toggle().click();
  GC.refreshCoachOverlay();
};

beforeEach(() => {
  vi.spyOn(Element.prototype, "getClientRects").mockReturnValue([{ width: 1, height: 1 }]);
  // jsdom has no layout: give every element a box so targets count as visible.
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    left: 700, right: 1000, top: 100, bottom: 140, width: 300, height: 40, x: 700, y: 100
  });
});
afterEach(() => {
  document.getElementById("gc-coach-layer")?.remove();
  document.body.style.backgroundColor = "";
  vi.restoreAllMocks();
});

describe("sidebar onboarding", () => {
  it("points at the toggle for first-time users", () => {
    load();
    expect(layer()?.dataset.mode).toBe("toggle");
    expect(notes()).toHaveLength(1);
    expect(toggle().classList.contains("gc-toggle-intro")).toBe(true);
    expect(document.querySelectorAll(".gc-coach-arrow")).toHaveLength(1);
  });

  it("switches to four annotated arrows when the panel opens", () => {
    const { GC } = load();
    openPanel(GC);
    expect(layer()?.dataset.mode).toBe("tour");
    expect(notes()).toHaveLength(4);
    expect(toggle().classList.contains("gc-toggle-intro")).toBe(false);
    document.querySelectorAll(".gc-coach-arrow").forEach((path) => {
      expect(path.getAttribute("d")).toMatch(/^M [\d.-]+ [\d.-]+ Q /);
    });
    // Panel sits on the right of the viewport, so notes go on its left.
    expect(layer().dataset.side).toBe("left");
  });

  it("is dismissed for good with Got it", () => {
    const { GC, chrome } = load();
    openPanel(GC);
    document.querySelector(".gc-coach-done").click();
    expect(layer()).toBeNull();
    expect(chrome.__store[SEEN]).toBe(true);
    GC.refreshCoachOverlay();
    expect(layer()).toBeNull();
  });

  it("is dismissed with Escape while the tour shows", () => {
    const { GC, chrome } = load();
    openPanel(GC);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(layer()).toBeNull();
    expect(chrome.__store[SEEN]).toBe(true);
  });

  it("goes back to the toggle note when the panel is minimised mid-tour", () => {
    const { GC } = load();
    openPanel(GC);
    document.getElementById("gc-minimize").click();
    GC.refreshCoachOverlay();
    expect(layer()?.dataset.mode).toBe("toggle");
  });

  it("never shows once seen", () => {
    const { GC } = load({ [SEEN]: true });
    openPanel(GC);
    expect(layer()).toBeNull();
    expect(toggle().classList.contains("gc-toggle-intro")).toBe(false);
  });

  it("uses light ink on a dark page and dark ink on a light page", () => {
    const { GC } = load();
    document.body.style.backgroundColor = "rgb(32, 33, 36)";
    expect(GC.samplePageTone(10, 10)).toBe("dark");
    document.body.style.backgroundColor = "rgb(255, 255, 255)";
    expect(GC.samplePageTone(10, 10)).toBe("light");
  });
});
