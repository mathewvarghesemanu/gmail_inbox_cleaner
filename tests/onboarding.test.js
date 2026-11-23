// Sidebar tour: starts by itself on first visit, one step at a time, skippable.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadContentScripts } from "./load-content.js";

const SEEN = "onboardingSidebarSeen";

function load(storage = {}) {
  const { chrome } = loadContentScripts({
    fixture: "gmail-list.html", hash: "#inbox", storage: { [SEEN]: false, ...storage }
  });
  const GC = window.__gc;
  GC.mountSidebar();
  GC.refreshCoachOverlay();
  return { GC, chrome };
}

const layer = () => document.getElementById("gc-coach-layer");
const count = () => document.querySelector(".gc-coach-count")?.textContent;

beforeEach(() => {
  vi.spyOn(Element.prototype, "getClientRects").mockReturnValue([{ width: 1, height: 1 }]);
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    left: 700, right: 1000, top: 100, bottom: 140, width: 300, height: 40, x: 700, y: 100
  });
});
afterEach(() => {
  window.__gc?.finishTour?.();
  document.body.style.backgroundColor = "";
  vi.restoreAllMocks();
});

describe("sidebar tour", () => {
  it("starts by itself on the first visit, opening the panel at step 1", () => {
    load();
    expect(document.getElementById("gc-root").classList.contains("gc-hidden")).toBe(false);
    expect(layer()?.dataset.mode).toBe("step");
    expect(count()).toBe("Step 1 of 5");
    expect(document.querySelector("#gc-context.gc-coach-target")).not.toBeNull();
  });

  it("moves on with Next and finishes on the last step", () => {
    const { chrome } = load();
    for (let step = 2; step <= 5; step += 1) {
      document.querySelector(".gc-coach-next").click();
      expect(count()).toBe(`Step ${step} of 5`);
    }
    document.querySelector(".gc-coach-next").click();
    expect(layer()).toBeNull();
    expect(chrome.__store[SEEN]).toBe(true);
  });

  it("can be skipped with Skip tour or Escape", () => {
    const { chrome } = load();
    document.querySelector(".gc-coach-skip").click();
    expect(layer()).toBeNull();
    expect(chrome.__store[SEEN]).toBe(true);

    const second = load();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(layer()).toBeNull();
    expect(second.chrome.__store[SEEN]).toBe(true);
  });

  it("pauses on the toggle when minimised, with Skip still available", () => {
    const { GC } = load();
    document.getElementById("gc-minimize").click();
    GC.refreshCoachOverlay();
    expect(layer()?.dataset.mode).toBe("paused");
    expect(document.querySelector(".gc-coach-skip")).not.toBeNull();
  });

  it("does not start once seen, but can be replayed", () => {
    const { GC } = load({ [SEEN]: true });
    expect(layer()).toBeNull();
    GC.startTour();
    expect(count()).toBe("Step 1 of 5");
  });

  it("starts when the popup asked a new Gmail tab to", () => {
    load({ [SEEN]: true, onboardingTourRequested: Date.now() });
    expect(count()).toBe("Step 1 of 5");
  });

  it("picks ink from the page background", () => {
    const { GC } = load({ [SEEN]: true });
    document.body.style.backgroundColor = "rgb(32, 33, 36)";
    expect(GC.samplePageTone(10, 10)).toBe("dark");
    document.body.style.backgroundColor = "rgb(255, 255, 255)";
    expect(GC.samplePageTone(10, 10)).toBe("light");
  });
});
