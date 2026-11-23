// Smoke tests: load the manifest's content scripts into hand-built Gmail fixtures
// (jsdom, chrome.* stubbed) and check the sidebar mounts and sender detection works.
import { describe, expect, it } from "vitest";
import { getManifestContentScripts, loadContentScripts } from "./load-content.js";

describe("manifest", () => {
  it("declares at least one content script", () => {
    expect(getManifestContentScripts().length).toBeGreaterThan(0);
  });
});

describe("content script on the conversation list", () => {
  it("mounts the sidebar and reports no open sender", () => {
    const { exports, chrome } = loadContentScripts({ fixture: "gmail-list.html", hash: "#inbox" });

    expect(document.getElementById("gc-root")).not.toBeNull();
    expect(document.getElementById("gc-toggle")).not.toBeNull();
    expect(document.querySelectorAll("#gc-root .gc-btn").length).toBeGreaterThan(0);
    expect(chrome.storage.local.get).toHaveBeenCalled();

    expect(typeof exports.findOpenEmailSender).toBe("function");
    expect(exports.findOpenEmailSender()).toBe("");
  });

  it("does not mount a second sidebar when injected again into the same page", () => {
    loadContentScripts({ fixture: "gmail-list.html", hash: "#inbox" });
    loadContentScripts({ resetDom: false });
    expect(document.querySelectorAll("#gc-root").length).toBe(1);
    expect(document.querySelectorAll("#gc-toggle").length).toBe(1);
  });
});

describe("content script on an open thread", () => {
  it("mounts the sidebar and detects the open email sender", () => {
    const { exports } = loadContentScripts({
      fixture: "gmail-thread.html",
      hash: "#inbox/FMfcgzQBBBBB1111"
    });

    expect(document.getElementById("gc-root")).not.toBeNull();
    expect(document.getElementById("gc-toggle")).not.toBeNull();

    const sender = exports.findOpenEmailSender();
    expect(sender.toLowerCase()).toBe("news@shop.example");
    if (exports.normalizeEmail) expect(exports.normalizeEmail(sender)).toBe("news@shop.example");
    if (exports.getOpenEmailSubject) {
      expect(exports.getOpenEmailSubject()).toBe("Weekly deals: 50% off everything");
    }
  });
});
