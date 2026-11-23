// Sidebar tour: starts by itself on first visit, one step at a time, skippable.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadContentScripts } from "./load-content.js";

const SEEN = "onboardingSidebarSeen";
const TOTAL = 8;

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
    expect(count()).toBe(`Step 1 of ${TOTAL}`);
    expect(document.querySelector("#gc-context.gc-coach-target")).not.toBeNull();
  });

  it("moves on with Next and finishes on the last step", () => {
    const { chrome } = load();
    for (let step = 2; step <= TOTAL; step += 1) {
      document.querySelector(".gc-coach-next").click();
      expect(count()).toBe(`Step ${step} of ${TOTAL}`);
    }
    document.querySelector(".gc-coach-next").click();
    expect(layer()).toBeNull();
    expect(chrome.__store[SEEN]).toBe(true);
  });

  it("covers dragging, the Inbox section and Show Archived", () => {
    load();
    const titles = [];
    for (let step = 1; step <= TOTAL; step += 1) {
      titles.push(document.querySelector(".gc-coach-note-title").textContent);
      document.querySelector(".gc-coach-next").click();
    }
    expect(titles).toEqual(["Open an email first", "Move it anywhere", "Prepare", "Archive", "Move on",
      "Changed your mind?", "Run it all", "Tuck it away"]);
  });

  it("points one arrow at Archive and one at Delete when Delete is on", () => {
    load({ deleteOpenEmailEnabled: true });
    const next = () => document.querySelector(".gc-coach-next").click();
    next(); next(); next();
    expect(document.querySelector(".gc-coach-note-title").textContent).toBe("Archive or delete");
    expect(document.querySelector(".gc-coach-note-text").textContent).toMatch(/Delete/);
    expect(document.querySelectorAll(".gc-coach-arrow")).toHaveLength(2);
    expect(document.querySelector(".gc-delete-group.gc-coach-target")).not.toBeNull();
  });

  it("lands the minimise arrow on the button itself", () => {
    const minimize = () => document.getElementById("gc-minimize");
    load();
    const realRect = Element.prototype.getBoundingClientRect.getMockImplementation();
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function rect() {
      if (this === minimize()) return { left: 968, right: 992, top: 108, bottom: 132, width: 24, height: 24 };
      return realRect.call(this);
    });
    for (let step = 1; step < TOTAL; step += 1) document.querySelector(".gc-coach-next").click();
    const head = document.querySelector(".gc-coach-arrow-head").getAttribute("d");
    const [, tipX, tipY] = head.match(/L ([\d.]+) ([\d.]+)/);
    expect(Number(tipX)).toBe(980);
    expect(Number(tipY)).toBe(105);
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
    expect(count()).toBe(`Step 1 of ${TOTAL}`);
  });

  it("starts when the popup asked a new Gmail tab to", () => {
    load({ [SEEN]: true, onboardingTourRequested: Date.now() });
    expect(count()).toBe(`Step 1 of ${TOTAL}`);
  });

  it("picks ink from the page background", () => {
    const { GC } = load({ [SEEN]: true });
    document.body.style.backgroundColor = "rgb(32, 33, 36)";
    expect(GC.samplePageTone(10, 10)).toBe("dark");
    document.body.style.backgroundColor = "rgb(255, 255, 255)";
    expect(GC.samplePageTone(10, 10)).toBe("light");
  });
});
