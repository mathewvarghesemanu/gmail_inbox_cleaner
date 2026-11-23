// Generic helpers: sleep/waitFor, storage wrappers, DOM query/click/visibility, dragging, h().
(() => {
  const GC = window.__gc;
  if (!GC || GC.skipLoad) return;

  const { CONTEXT_INVALIDATED_MESSAGE, SELECTORS, state } = GC;

  /** Handles sleep. */
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  /** Returns the first element matching any selector in an ordered list (or a single selector). */
  function queryFirst(root, selectors) {
    if (!root) return null;
    const list = Array.isArray(selectors) ? selectors : [selectors];
    for (const selector of list) {
      const el = root.querySelector(selector);
      if (el) return el;
    }
    return null;
  }

  /** Returns the first non-empty attribute value across an ordered selector list. */
  function firstAttr(root, selectors, attr) {
    if (!root) return "";
    const list = Array.isArray(selectors) ? selectors : [selectors];
    for (const selector of list) {
      const value = root.querySelector(selector)?.getAttribute(attr);
      if (value) return value;
    }
    return "";
  }

  /** Returns the first non-empty trimmed textContent across an ordered selector list. */
  function firstText(root, selectors) {
    if (!root) return "";
    const list = Array.isArray(selectors) ? selectors : [selectors];
    for (const selector of list) {
      const value = root.querySelector(selector)?.textContent?.trim();
      if (value) return value;
    }
    return "";
  }

  /** Applies top/left position to a fixed element, clearing right/transform overrides. */
  function applyElPosition(el, top, left, clamp = true) {
    if (clamp) {
      const w = el.offsetWidth || 40;
      const h = el.offsetHeight || 40;
      top = Math.max(0, Math.min(top, window.innerHeight - h));
      left = Math.max(0, Math.min(left, window.innerWidth - w));
    }
    el.style.top = top + "px";
    el.style.left = left + "px";
    el.style.right = "auto";
    el.style.bottom = "auto";
    el.style.transform = "none";
  }

  /** Clears inline position so the element falls back to its CSS default placement. */
  function resetElPosition(el) {
    ["top", "left", "right", "bottom", "transform"].forEach((prop) => el.style.removeProperty(prop));
  }

  /** Keeps a dragged fixed element inside the viewport; resets to CSS default if barely visible. No-op while hidden or at default placement. */
  function keepElInView(el) {
    if (!el || !el.offsetWidth || !el.style.left) return;
    const minVisible = 40;
    const rect = el.getBoundingClientRect();
    const visibleW = Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0);
    const visibleH = Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0);
    if (visibleW < Math.min(minVisible, rect.width / 2) || visibleH < Math.min(minVisible, rect.height / 2)) {
      resetElPosition(el);
      return;
    }
    applyElPosition(el, rect.top, rect.left);
  }

  /** Makes a fixed element draggable. If posKey provided, persists position via chrome.storage.local. axis: "x"|"y"|null for both. */
  function makeDraggable(el, posKey, handleEl, axis) {
    if (!handleEl) handleEl = el;

    if (posKey) {
      safeStorageGet([posKey], (result) => {
        if (result[posKey]) {
          applyElPosition(el, result[posKey].top, result[posKey].left, false);
          keepElInView(el);
        }
      });
    }

    let drag = null;
    let didMove = false;

    handleEl.style.cursor = "grab";

    handleEl.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      if (e.target !== handleEl && e.target.closest("button,input,a,select,textarea")) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      drag = { startX: e.clientX, startY: e.clientY, origLeft: rect.left, origTop: rect.top };
      didMove = false;
      handleEl.style.cursor = "grabbing";
      document.body.style.userSelect = "none";
    });

    document.addEventListener("mousemove", (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      if (!didMove && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
      didMove = true;
      const newTop = axis === "x" ? drag.origTop : drag.origTop + dy;
      const newLeft = axis === "y" ? drag.origLeft : drag.origLeft + dx;
      applyElPosition(el, newTop, newLeft);
    });

    document.addEventListener("mouseup", () => {
      if (!drag) return;
      drag = null;
      handleEl.style.cursor = "grab";
      document.body.style.userSelect = "";
      if (didMove && posKey) {
        const rect = el.getBoundingClientRect();
        safeStorageSet({ [posKey]: { top: rect.top, left: rect.left } });
      }
    });

    if (el === handleEl) {
      handleEl.addEventListener("click", (e) => {
        if (didMove) {
          e.stopImmediatePropagation();
          e.preventDefault();
          didMove = false;
        }
      }, true);
    }
  }
  /** Checks whether context invalidated error. */
  function isContextInvalidatedError(error) {
    return String(error?.message || "").toLowerCase().includes("extension context invalidated");
  }

  /** Handles mark extension context invalidated. */
  function markExtensionContextInvalidated(error) {
    if (state.extensionContextInvalidated) return;
    state.extensionContextInvalidated = true;
    console.warn("[GmailCleaner] Extension context invalidated. Waiting for reinjection.", error);
  }

  /** Handles safe storage get. */
  function safeStorageGet(keys, onSuccess) {
    if (state.extensionContextInvalidated) return;
    try {
      chrome.storage.local.get(keys, (result) => {
        if (state.extensionContextInvalidated) return;
        const lastError = chrome.runtime?.lastError;
        if (lastError) {
          if (String(lastError.message || "").includes(CONTEXT_INVALIDATED_MESSAGE)) {
            markExtensionContextInvalidated(lastError);
          }
          return;
        }
        onSuccess(result);
      });
    } catch (error) {
      if (isContextInvalidatedError(error)) {
        markExtensionContextInvalidated(error);
        return;
      }
      throw error;
    }
  }

  /** Handles safe storage set. */
  function safeStorageSet(payload) {
    if (state.extensionContextInvalidated) return;
    try {
      chrome.storage.local.set(payload, () => {
        const lastError = chrome.runtime?.lastError;
        if (lastError && String(lastError.message || "").includes(CONTEXT_INVALIDATED_MESSAGE)) {
          markExtensionContextInvalidated(lastError);
        }
      });
    } catch (error) {
      if (isContextInvalidatedError(error)) {
        markExtensionContextInvalidated(error);
        return;
      }
      throw error;
    }
  }

  /**
   * Polls predicate until it returns a truthy value (which is returned) or the timeout
   * elapses (returns null). shouldAbort() is checked before each poll; when it returns
   * true the wait ends early with null. The predicate gets one last check at timeout.
   */
  async function waitFor(predicate, { timeout = 5000, interval = 100, shouldAbort = null } = {}) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (shouldAbort && shouldAbort()) return null;
      const value = predicate();
      if (value) return value;
      await sleep(interval);
    }
    if (shouldAbort && shouldAbort()) return null;
    return predicate() || null;
  }

  /**
   * Fixed "let Gmail settle" pause taken after Gmail has already signalled it is
   * ready. Skipped in Fast mode (popup setting). Polling intervals, retry backoffs
   * and pauses with no DOM signal to wait on must keep using sleep().
   */
  function settle(ms) {
    return GC.state?.fastMode ? Promise.resolve() : sleep(ms);
  }

  /** Waits for selector. */
  function waitForSelector(selector, timeout = 7000) {
    return waitFor(() => document.querySelector(selector), { timeout, interval: 150 });
  }

  /** Sets log. */
  function setLog(msg) {
    console.log(`[GmailCleaner] ${msg}`);
  }

  /** Checks whether editable target. */
  function isEditableTarget(target) {
    if (!target) return false;
    const tag = (target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return true;
    if (target.isContentEditable) return true;
    return Boolean(target.closest?.("[contenteditable='true']"));
  }

  /** Triggers key sequence. */
  function triggerKeySequence(sequence) {
    for (const key of sequence) {
      const down = new KeyboardEvent("keydown", {
        key,
        bubbles: true,
        cancelable: true
      });
      document.dispatchEvent(down);

      const up = new KeyboardEvent("keyup", {
        key,
        bubbles: true,
        cancelable: true
      });
      document.dispatchEvent(up);
    }
  }

  /** Dispatches menu click sequence. */
  function dispatchMenuClickSequence(el) {
    if (!el) return;
    const events = ["pointerdown", "mousedown", "pointerup", "mouseup", "click"];
    for (const type of events) {
      const event =
        type.startsWith("pointer")
          ? new PointerEvent(type, { bubbles: true, cancelable: true, pointerType: "mouse" })
          : new MouseEvent(type, { bubbles: true, cancelable: true, view: window });
      el.dispatchEvent(event);
    }
  }

  /** Checks whether disabled control. */
  function isDisabledControl(el) {
    if (!el) return true;
    if ((el.getAttribute("aria-disabled") || "").toLowerCase() === "true") return true;
    if ((el.getAttribute("disabled") || "").toLowerCase() === "true") return true;
    if (el.hasAttribute("disabled")) return true;
    const tabIndex = el.getAttribute("tabindex");
    if (tabIndex === "-1") return true;
    return false;
  }

  /** Normalizes comparable url. */
  function normalizeComparableUrl(url) {
    try {
      return new URL(String(url || ""), location.href).toString();
    } catch (_) {
      return String(url || "");
    }
  }

  /** Navigates within gmail. */
  function navigateWithinGmail(url) {
    const target = String(url || "").trim();
    if (!target) return;
    try {
      const parsed = new URL(target, location.href);
      const sameOrigin = parsed.origin === location.origin;
      const samePath = parsed.pathname === location.pathname;
      if (sameOrigin && samePath && parsed.hash) {
        window.location.hash = parsed.hash;
        return;
      }
      window.location.href = parsed.toString();
    } catch (_) {
      if (target.startsWith("#")) {
        window.location.hash = target;
      } else {
        window.location.href = target;
      }
    }
  }

  /** Handles robust click. */
  function robustClick(el) {
    if (!el) return;
    try {
      el.scrollIntoView({ block: "center", inline: "center" });
    } catch (_) {}

    try {
      el.focus?.();
    } catch (_) {}

    try {
      el.click();
    } catch (_) {}

    const mouseDown = new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window });
    const mouseUp = new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window });
    const click = new MouseEvent("click", { bubbles: true, cancelable: true, view: window });

    el.dispatchEvent(mouseDown);
    el.dispatchEvent(mouseUp);
    el.dispatchEvent(click);

    // Fallback for role=link elements that react to keyboard activation.
    if (el.matches(SELECTORS.roleLinkOrButton)) {
      el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
      el.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", bubbles: true, cancelable: true }));
    }
  }

  /** Checks whether visible. */
  function isVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  }

  /**
   * Tiny DOM builder: h(tag, attrs, ...children).
   * attrs are set with setAttribute (true -> empty attribute, false/null/undefined -> skipped);
   * children may be strings (text nodes), nodes, arrays, or null.
   */
  function h(tag, attrs = {}, ...children) {
    const el = document.createElement(tag);
    for (const [name, value] of Object.entries(attrs || {})) {
      if (value === false || value === null || value === undefined) continue;
      el.setAttribute(name, value === true ? "" : String(value));
    }
    const append = (child) => {
      if (child === null || child === undefined || child === false) return;
      if (Array.isArray(child)) {
        child.forEach(append);
        return;
      }
      el.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
    };
    children.forEach(append);
    return el;
  }

  Object.assign(GC, { applyElPosition, dispatchMenuClickSequence, firstAttr, firstText, h,
    isContextInvalidatedError, isDisabledControl, isEditableTarget, isVisible, keepElInView, makeDraggable,
    markExtensionContextInvalidated, navigateWithinGmail, normalizeComparableUrl, queryFirst,
    resetElPosition, robustClick, safeStorageGet, safeStorageSet, setLog, settle, sleep, triggerKeySequence, waitFor,
    waitForSelector });
})();
