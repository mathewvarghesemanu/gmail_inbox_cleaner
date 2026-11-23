// Sidebar tour: a step-by-step note drawn on the page beside the panel, with a
// curved arrow pointing at the control it explains. Starts by itself on the first
// Gmail visit (opening the panel), and can be replayed from the extension popup.
// Text and arrow colours follow the page background behind the note.
(() => {
  const GC = window.__gc;
  if (!GC || GC.skipLoad) return;

  const { ONBOARDING_REQUEST_KEY, ONBOARDING_SIDEBAR_KEY, STRINGS, detectGmailTheme, h, parseOpaqueColor,
    safeStorageGet, safeStorageSet } = GC;

  const SVG_NS = "http://www.w3.org/2000/svg";
  const NOTE_WIDTH = 230;
  /** Horizontal room the arrow takes between the note and its target. */
  const ARROW_GAP = 112;
  const EDGE = 12;
  /** A popup request older than this (ms) is stale and ignored. */
  const REQUEST_MAX_AGE = 2 * 60 * 1000;

  const STEP_TARGETS = ["#gc-context", ".gc-section-prepare", ".gc-section-archive", "#gc-execute-selected",
    "#gc-minimize"];

  let active = false;
  let stepIndex = 0;
  /** What is on screen: "step-<n>", "paused" or "". */
  let shown = "";
  let layer = null;
  let loopHandle = 0;
  let lastLayoutKey = "";

  const raf = (fn) =>
    typeof window.requestAnimationFrame === "function" ? window.requestAnimationFrame(fn) : setTimeout(fn, 16);
  const cancelRaf = (handle) =>
    typeof window.cancelAnimationFrame === "function" ? window.cancelAnimationFrame(handle) : clearTimeout(handle);

  /** Creates an SVG element with attributes. */
  function svg(tag, attrs = {}) {
    const el = document.createElementNS(SVG_NS, tag);
    Object.entries(attrs).forEach(([name, value]) => el.setAttribute(name, String(value)));
    return el;
  }

  /** Relative luminance (0 dark .. 1 light) of an {r, g, b} colour. */
  function luminance({ r, g, b }) {
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  }

  /**
   * Returns "dark" when the page behind (x, y) is dark, else "light". Background
   * images (Gmail photo themes) cannot be sampled, so they fall back to Gmail's theme.
   */
  function samplePageTone(x, y) {
    const ours = (el) => el.closest?.("#gc-coach-layer, #gc-root, #gc-toggle");
    const hit = typeof document.elementsFromPoint === "function"
      ? document.elementsFromPoint(x, y).find((el) => !ours(el))
      : null;
    if (hit) {
      for (let node = hit; node && node.nodeType === Node.ELEMENT_NODE; node = node.parentElement) {
        const style = getComputedStyle(node);
        const color = parseOpaqueColor(style.backgroundColor);
        if (color) return luminance(color) < 0.5 ? "dark" : "light";
        if (style.backgroundImage && style.backgroundImage !== "none") break;
      }
    }
    return detectGmailTheme();
  }

  /** Arced arrow from (sx, sy) to (ex, ey), bowing upward like a hand-drawn callout. */
  function arrowPaths(sx, sy, ex, ey) {
    const dx = ex - sx;
    const lift = 26 + Math.min(30, Math.abs(ey - sy) * 0.3);
    const cx = sx + dx * 0.5;
    const cy = Math.min(sy, ey) - lift;
    const curve = `M ${sx} ${sy} Q ${cx} ${cy}, ${ex} ${ey}`;
    // Arrowhead follows the curve's tangent at the tip (from the control point).
    const angle = Math.atan2(ey - cy, ex - cx);
    const len = 12;
    const spread = 0.48;
    const a = [ex - len * Math.cos(angle - spread), ey - len * Math.sin(angle - spread)];
    const b = [ex - len * Math.cos(angle + spread), ey - len * Math.sin(angle + spread)];
    const head = `M ${a[0]} ${a[1]} L ${ex} ${ey} L ${b[0]} ${b[1]}`;
    return { curve, head };
  }

  /** Removes the overlay and the in-panel highlight. */
  function removeLayer() {
    layer?.remove();
    layer = null;
    lastLayoutKey = "";
    document.querySelectorAll(".gc-coach-target").forEach((el) => el.classList.remove("gc-coach-target"));
  }

  /** Builds the overlay for the current step, or the "paused" note on the toggle. */
  function buildLayer(kind) {
    removeLayer();
    const ui = STRINGS.onboarding;
    const total = ui.steps.length;
    const copy = kind === "paused" ? ui.paused : ui.steps[stepIndex];
    const last = stepIndex === total - 1;

    const curve = svg("path", { class: "gc-coach-arrow", pathLength: 1 });
    const head = svg("path", { class: "gc-coach-arrow-head" });
    const arrows = svg("svg", { class: "gc-coach-arrows", "aria-hidden": "true" });
    arrows.append(curve, head);

    const skip = h("button", { type: "button", class: "gc-coach-skip" }, "✕ ", ui.skip);
    skip.addEventListener("click", finishTour);
    const controls = h("div", { class: "gc-coach-controls" }, skip);
    if (kind !== "paused") {
      const next = h("button", { type: "button", class: "gc-coach-next" }, last ? ui.done : `${ui.next} →`);
      next.addEventListener("click", () => (last ? finishTour() : goToStep(stepIndex + 1)));
      controls.append(next);
    }

    const note = h(
      "div",
      { class: "gc-coach-note" },
      kind === "paused" ? null : h("p", { class: "gc-coach-count" }, ui.count(stepIndex + 1, total)),
      h("p", { class: "gc-coach-note-title" }, copy.title),
      h("p", { class: "gc-coach-note-text" }, copy.text),
      controls
    );

    layer = h("div", { id: "gc-coach-layer", "data-mode": kind, role: "dialog", "aria-label": ui.ariaLabel });
    layer.append(arrows, note);
    layer.__parts = { note, curve, head };
    document.body.appendChild(layer);
    // Keyboard users land on the main action; Enter moves on.
    (controls.querySelector(".gc-coach-next") || skip).focus({ preventScroll: true });
  }

  /** Visible rect of el, clipped to the panel body (scrolled-away targets return null). */
  function visibleRect(el) {
    if (!el || el.classList.contains("gc-hidden")) return null;
    const rect = el.getBoundingClientRect();
    if (!rect.width && !rect.height) return null;
    const body = document.getElementById("gc-body")?.getBoundingClientRect();
    if (body && el.closest("#gc-body")) {
      const mid = rect.top + rect.height / 2;
      if (mid < body.top || mid > body.bottom) return null;
    }
    return rect;
  }

  /**
   * Positions the note beside the panel (or toggle) on whichever side has more
   * room, with the arrow ending just outside the panel edge level with the target.
   */
  function layout(anchorBox, rect) {
    const { note, curve, head } = layer.__parts;
    const side = anchorBox.left >= window.innerWidth - anchorBox.right ? "left" : "right";
    const room = side === "left" ? anchorBox.left : window.innerWidth - anchorBox.right;
    const width = Math.min(NOTE_WIDTH, Math.max(150, room - ARROW_GAP - EDGE));
    const x = side === "left"
      ? Math.max(EDGE, anchorBox.left - ARROW_GAP - width)
      : Math.min(window.innerWidth - EDGE - width, anchorBox.right + ARROW_GAP);
    layer.dataset.side = side;
    note.style.width = `${width}px`;

    // The panel is scrolled so the target is in view (see goToStep); if it still is
    // not, point at the panel itself rather than at nothing.
    const target = rect || anchorBox;
    const anchorY = target.top + Math.min(target.height / 2, 22);
    const anchorX = side === "left"
      ? Math.min(target.left, anchorBox.left) - 5
      : Math.max(target.right, anchorBox.right) + 5;
    const height = note.offsetHeight || 120;
    const titleOffset = note.querySelector(".gc-coach-note-title")?.offsetTop ?? 18;
    const y = Math.min(Math.max(EDGE, anchorY - titleOffset - 10), window.innerHeight - EDGE - height);
    note.style.left = `${x}px`;
    note.style.top = `${y}px`;

    const startX = side === "left" ? x + width + 8 : x - 8;
    const startY = y + titleOffset + 10;
    const paths = arrowPaths(startX, startY, anchorX, anchorY);
    curve.setAttribute("d", paths.curve);
    head.setAttribute("d", paths.head);

    const tone = samplePageTone(x + width / 2, y + height / 2);
    [note, curve, head].forEach((el) => (el.dataset.tone = tone));
  }

  /** Decides what to show from the panel/toggle state and lays it out. */
  function refreshCoachOverlay() {
    if (!active) {
      if (layer) removeLayer();
      return;
    }
    const root = document.getElementById("gc-root");
    const toggle = document.getElementById("gc-toggle");
    const panelOpen = root && !root.classList.contains("gc-hidden") && root.style.display !== "none";
    const toggleShown = toggle && !toggle.classList.contains("gc-toggle-covered") && toggle.style.display !== "none";
    const next = panelOpen ? `step-${stepIndex}` : toggleShown ? "paused" : "";
    toggle?.classList.toggle("gc-toggle-intro", next === "paused");

    if (next !== shown || (next && !layer?.isConnected)) {
      shown = next;
      if (next) buildLayer(next === "paused" ? "paused" : "step");
      else removeLayer();
    }
    if (!shown) return;

    const anchorBox = (shown === "paused" ? toggle : root).getBoundingClientRect();
    let rect = anchorBox;
    if (shown !== "paused") {
      const targetEl = root.querySelector(STEP_TARGETS[stepIndex]);
      if (targetEl && !targetEl.classList.contains("gc-coach-target")) targetEl.classList.add("gc-coach-target");
      rect = visibleRect(targetEl);
    }
    const key = [shown, window.innerWidth, window.innerHeight, anchorBox.left, anchorBox.top, anchorBox.right,
      anchorBox.bottom, rect ? `${rect.left},${rect.top},${rect.height}` : "-"].join("|");
    if (key === lastLayoutKey) return;
    lastLayoutKey = key;
    layout(anchorBox, rect);
  }

  /** Shows step index (scrolling its target into view inside the panel). */
  function goToStep(index) {
    stepIndex = index;
    shown = "";
    document.querySelector(`#gc-root ${STEP_TARGETS[index]}`)?.scrollIntoView?.({ block: "nearest" });
    refreshCoachOverlay();
  }

  /** Follows panel drags, scrolling and resizes while the tour runs. */
  function startLoop() {
    cancelRaf(loopHandle);
    const tick = () => {
      if (!active) return;
      refreshCoachOverlay();
      loopHandle = raf(tick);
    };
    tick();
  }

  /** Escape skips the tour. */
  function onKeydown(event) {
    if (event.key !== "Escape" || !active || !shown) return;
    event.preventDefault();
    event.stopPropagation();
    finishTour();
  }

  /** Starts (or restarts) the tour at step 1, opening the panel. */
  function startTour() {
    if (!document.getElementById("gc-root")) return;
    active = true;
    shown = "";
    stepIndex = 0;
    GC.openPanel();
    document.removeEventListener("keydown", onKeydown, true);
    document.addEventListener("keydown", onKeydown, true);
    startLoop();
  }

  /** Ends the tour (finished or skipped) and remembers it was seen. */
  function finishTour() {
    active = false;
    shown = "";
    cancelRaf(loopHandle);
    removeLayer();
    document.getElementById("gc-toggle")?.classList.remove("gc-toggle-intro");
    document.removeEventListener("keydown", onKeydown, true);
    safeStorageSet({ [ONBOARDING_SIDEBAR_KEY]: true });
  }

  /** Called when the panel opens from the toggle; resumes a paused tour. */
  function onPanelOpened() {
    if (active) refreshCoachOverlay();
  }

  /**
   * On mount: starts the tour on the first visit, or when the popup's "Take the
   * tour" opened this tab. Remounts keep a running tour going.
   */
  function initOnboarding() {
    if (active) {
      startLoop();
      return;
    }
    safeStorageGet([ONBOARDING_SIDEBAR_KEY, ONBOARDING_REQUEST_KEY], (result) => {
      const requestedAt = Number(result?.[ONBOARDING_REQUEST_KEY]) || 0;
      const requested = requestedAt > 0 && Date.now() - requestedAt < REQUEST_MAX_AGE;
      if (requestedAt) safeStorageSet({ [ONBOARDING_REQUEST_KEY]: 0 });
      if (active || (result?.[ONBOARDING_SIDEBAR_KEY] === true && !requested)) return;
      startTour();
    });
  }

  // "Take the tour" in the popup, when this Gmail tab is the active one.
  try {
    chrome.runtime?.onMessage?.addListener((message, _sender, sendResponse) => {
      if (message?.type !== "gc-start-tour") return undefined;
      startTour();
      sendResponse({ ok: !!document.getElementById("gc-root") });
      return undefined;
    });
  } catch {
    // Extension context gone (extension reloaded); nothing to listen for.
  }

  Object.assign(GC, { finishTour, initOnboarding, onPanelOpened, refreshCoachOverlay, samplePageTone, startTour });
})();
