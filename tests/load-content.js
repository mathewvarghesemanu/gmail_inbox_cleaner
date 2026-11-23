// Test helper: loads the extension's content scripts into the current (jsdom) test
// environment and returns their internals.
//
// Strategy:
//   1. Content scripts are read from manifest.json `content_scripts[0].js` and executed
//      in manifest order with `vm.runInThisContext` (classic-script semantics, so
//      top-level declarations are shared between files exactly like in Chrome).
//   2. Before running, `globalThis.__GC_TEST__ = {}` is defined; the content script's
//      test hook fills `__GC_TEST__.exports` with internal functions.
//   3. If a DOM-free `src/matching.js` exists (CommonJS export guard), its exports are
//      `require`d and preferred for the pure matching helpers.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { vi } from "vitest";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

/** Returns the content script file list (relative paths) from manifest.json, in order. */
export function getManifestContentScripts() {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
  const files = [];
  for (const entry of manifest.content_scripts || []) {
    for (const file of entry.js || []) {
      if (!files.includes(file)) files.push(file);
    }
  }
  return files;
}

/** Requires src/matching.js when it exists (post-refactor layout); otherwise returns null. */
export function requireMatchingModule() {
  const file = path.join(ROOT, "src", "matching.js");
  if (!fs.existsSync(file)) return null;
  try {
    const mod = require(file);
    return mod && typeof mod === "object" && Object.keys(mod).length ? mod : null;
  } catch {
    return null;
  }
}

/** Reads a fixture from tests/fixtures and returns its <body> markup. */
export function readFixtureBody(name) {
  const html = fs.readFileSync(path.join(ROOT, "tests", "fixtures", name), "utf8");
  const doc = new DOMParser().parseFromString(html, "text/html");
  return doc.body.innerHTML;
}

/** Creates a minimal in-memory chrome.* stub sufficient for the content script. */
export function createChromeStub(initialStorage = {}) {
  const store = { ...initialStorage };
  const changeListeners = [];
  const messageListeners = [];
  const pick = (keys) => {
    if (keys == null) return { ...store };
    if (typeof keys === "string") return keys in store ? { [keys]: store[keys] } : {};
    if (Array.isArray(keys)) {
      return Object.fromEntries(keys.filter((k) => k in store).map((k) => [k, store[k]]));
    }
    return Object.fromEntries(Object.entries(keys).map(([k, def]) => [k, k in store ? store[k] : def]));
  };
  const local = {
    get: vi.fn((keys, cb) => {
      const result = pick(keys);
      if (typeof cb === "function") cb(result);
      return Promise.resolve(result);
    }),
    set: vi.fn((items, cb) => {
      const changes = {};
      for (const [k, v] of Object.entries(items || {})) {
        changes[k] = { oldValue: store[k], newValue: v };
        store[k] = v;
      }
      if (typeof cb === "function") cb();
      changeListeners.forEach((fn) => fn(changes, "local"));
      return Promise.resolve();
    }),
    remove: vi.fn((keys, cb) => {
      [].concat(keys).forEach((k) => delete store[k]);
      if (typeof cb === "function") cb();
      return Promise.resolve();
    })
  };
  return {
    __store: store,
    __messageListeners: messageListeners,
    storage: {
      local,
      onChanged: {
        addListener: (fn) => changeListeners.push(fn),
        removeListener: (fn) => {
          const i = changeListeners.indexOf(fn);
          if (i >= 0) changeListeners.splice(i, 1);
        }
      }
    },
    runtime: {
      id: "test-extension-id",
      lastError: undefined,
      getURL: (p) => `chrome-extension://test-extension-id/${p}`,
      sendMessage: vi.fn((_msg, cb) => {
        if (typeof cb === "function") cb();
        return Promise.resolve();
      }),
      onMessage: {
        addListener: (fn) => messageListeners.push(fn),
        removeListener: () => {}
      }
    }
  };
}

/**
 * Loads the manifest's content scripts into the current jsdom document.
 *
 * @param {object} [options]
 * @param {string} [options.fixture]  fixture file name in tests/fixtures (body is injected first)
 * @param {string} [options.hash]     location.hash to set before loading (e.g. "#inbox")
 * @param {string} [options.search]   location.search to set before loading (e.g. "?view=pt")
 * @param {object} [options.storage]  initial chrome.storage.local contents
 * @param {boolean} [options.silent]  silence console.log noise (default true)
 * @param {boolean} [options.resetDom] replace document.body before loading (default true)
 * @returns {{ exports: object, chrome: object }}
 */
export function loadContentScripts(options = {}) {
  const { fixture, hash = "", search = "", storage = {}, silent = true, resetDom = true } = options;

  if (silent) vi.spyOn(console, "log").mockImplementation(() => {});

  if (search || hash) {
    window.history.replaceState(null, "", `${window.location.pathname}${search}${hash}`);
  }
  if (resetDom) document.body.innerHTML = fixture ? readFixtureBody(fixture) : "";

  const chrome = createChromeStub(storage);
  globalThis.chrome = chrome;
  delete window.__gmailCleanerLoaded;
  globalThis.__GC_TEST__ = {};

  for (const file of getManifestContentScripts()) {
    const source = fs.readFileSync(path.join(ROOT, file), "utf8");
    vm.runInThisContext(source, { filename: path.join(ROOT, file) });
  }

  const hookExports = globalThis.__GC_TEST__.exports || {};
  const matching = requireMatchingModule() || {};
  return { exports: { ...hookExports, ...matching }, chrome };
}

/**
 * Returns the pure matching helpers. Prefers src/matching.js (DOM-free, post-refactor);
 * falls back to loading the content scripts (requires a jsdom environment) for anything missing.
 */
export function loadMatchingFunctions(names = []) {
  const matching = requireMatchingModule();
  if (matching && names.every((n) => typeof matching[n] === "function")) return matching;
  const { exports } = loadContentScripts();
  return exports;
}
