// Theme setting (popup): Auto follows Gmail's theme; Light / Dark force the sidebar.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadContentScripts } from "./load-content.js";

const THEME = "themePreference";

function load(storage = {}) {
  const { chrome } = loadContentScripts({ fixture: "gmail-list.html", hash: "#inbox", storage });
  const GC = window.__gc;
  GC.mountSidebar();
  return { GC, chrome };
}

const theme = () => document.getElementById("gc-root").dataset.gcTheme;

beforeEach(() => {
  vi.spyOn(Element.prototype, "getClientRects").mockReturnValue([{ width: 1, height: 1 }]);
});
afterEach(() => {
  document.body.style.backgroundColor = "";
  vi.restoreAllMocks();
});

describe("theme setting", () => {
  it("defaults to Auto, following Gmail's background", () => {
    const { GC } = load();
    expect(GC.state.themePreference).toBe("auto");
    document.body.style.backgroundColor = "rgb(32, 33, 36)";
    GC.applyTheme();
    expect(theme()).toBe("dark");
  });

  it("forces Dark on a light Gmail", () => {
    load({ [THEME]: "dark" });
    expect(theme()).toBe("dark");
  });

  it("forces Light on a dark Gmail", () => {
    const { GC } = load({ [THEME]: "light" });
    document.body.style.backgroundColor = "rgb(32, 33, 36)";
    GC.applyTheme();
    expect(theme()).toBe("light");
  });

  it("follows live changes from the popup and ignores unknown values", () => {
    const { GC, chrome } = load();
    chrome.storage.local.set({ [THEME]: "dark" });
    expect(theme()).toBe("dark");
    chrome.storage.local.set({ [THEME]: "sepia" });
    expect(GC.state.themePreference).toBe("auto");
    expect(theme()).toBe("light");
  });
});
