// Regression: opening an email from a search and running Execute Selected
// paged through the whole inbox looking for it. Discovery now scans the list
// the email was opened from (search/label/category/All Mail) when usable.
import { describe, expect, it } from "vitest";
import { loadContentScripts } from "./load-content.js";

function loadGc() {
  loadContentScripts({ fixture: "gmail-thread.html", hash: "#inbox/FMfcgzQBBBBB1111" });
  return window.__gc;
}

describe("getUsableOriginListHash", () => {
  it("uses the search the email was opened from", () => {
    const GC = loadGc();
    expect(GC.getUsableOriginListHash("#search/receipts+2024/FMfcgzQBBBBB1111")).toBe("#search/receipts+2024");
  });

  it("uses labels, categories and All Mail", () => {
    const GC = loadGc();
    expect(GC.getUsableOriginListHash("#label/Work/FMfcgzQ1")).toBe("#label/work");
    expect(GC.getUsableOriginListHash("#category/promotions/FMfcgzQ1")).toBe("#category/promotions");
    expect(GC.getUsableOriginListHash("#all/FMfcgzQ1")).toBe("#all");
  });

  it("falls back (empty) for inbox and one-sender searches", () => {
    const GC = loadGc();
    expect(GC.getUsableOriginListHash("#inbox/FMfcgzQ1")).toBe("");
    expect(GC.getUsableOriginListHash("#search/from%3Anews%40shop.example/FMfcgzQ1")).toBe("");
    expect(GC.getUsableOriginListHash("#search/from:news@shop.example+in:inbox/FMfcgzQ1")).toBe("");
  });
});
