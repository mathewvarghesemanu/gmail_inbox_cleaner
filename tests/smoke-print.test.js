// Gmail print view (?view=pt) must never get the sidebar (v2.3.1 regression guard).
import { describe, expect, it } from "vitest";
import { loadContentScripts } from "./load-content.js";

describe("content script in Gmail print view", () => {
  it("does not inject the sidebar", () => {
    loadContentScripts({ fixture: "gmail-thread.html", search: "?view=pt" });
    expect(document.getElementById("gc-root")).toBeNull();
    expect(document.getElementById("gc-toggle")).toBeNull();
  });
});
