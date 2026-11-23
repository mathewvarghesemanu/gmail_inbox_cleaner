// First-run onboarding for the Gmail sidebar: annotation notes drawn on the page
// beside the panel, each with a curved arrow pointing at the control it explains.
// Before the first open a single note points at the toggle. Text and arrow colours
// follow the page background behind each note, so they stay readable on any theme.
(() => {
  const GC = window.__gc;
  if (!GC || GC.skipLoad) return;

  const { ONBOARDING_SIDEBAR_KEY, STRINGS, detectGmailTheme, h, parseOpaqueColor, safeStorageGet,
    safeStorageSet } = GC;

  const SVG_NS = "http://www.w3.org/2000/svg";
  const NOTE_WIDTH = 210;
  /** Horizontal room the arrow takes between a note and its target. */
  const ARROW_GAP = 112;
  const NOTE_SPACING = 16;
  const EDGE = 12;

  const TOUR_TARGETS = ["#gc-context", ".gc-section-prepare", ".gc-section-archive", "#gc-execute-selected"];

  let pending = false;
  /** "toggle", "tour" or "" (nothing shown). */
  let mode = "";
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

  /** Builds one note (title + text) and its arrow paths. */
  function buildNote(copy, index) {
    const note = h(
      "div",
      { class: "gc-coach-note", style: `--gc-coach-delay:${index * 160}ms` },
      h("p", { class: "gc-coach-note-title" }, copy.title),
      h("p", { class: "gc-coach-note-text" }, copy.text)
    );
    const curve = svg("path", { class: "gc-coach-arrow", pathLength: 1, style: `--gc-coach-delay:${index * 160}ms` });
    const head = svg("path", { class: "gc-coach-arrow-head", style: `--gc-coach-delay:${index * 160 + 420}ms` });
    return { note, curve, head };
  }

  /** Removes the overlay. */
  function removeLayer() {
    layer?.remove();
    layer = null;
    lastLayoutKey = "";
  }

  /** Builds the overlay for a mode ("toggle" or "tour"). */
  function buildLayer(nextMode) {
    removeLayer();
    const ui = STRINGS.onboarding;
    const copies = nextMode === "toggle" ? [ui.toggle] : ui.notes;
    const arrows = svg("svg", { class: "gc-coach-arrows", "aria-hidden": "true" });
    layer = h("div", { id: "gc-coach-layer", "data-mode": nextMode, role: "note", "aria-label": ui.ariaLabel });
    layer.append(arrows);
    layer.__notes = copies.map((copy, index) => {
      const parts = buildNote(copy, index);
      arrows.append(parts.curve, parts.head);
      layer.append(parts.note);
      return parts;
    });
    if (nextMode === "tour") {
      const done = h("button", { type: "button", class: "gc-coach-done" }, ui.done);
      done.addEventListener("click", finishOnboarding);
      const footer = h(
        "div",
        { class: "gc-coach-footer", style: `--gc-coach-delay:${copies.length * 160 + 200}ms` },
        done,
        h("span", { class: "gc-coach-esc" }, ui.escHint)
      );
      layer.append(footer);
      layer.__footer = footer;
    }
    document.body.appendChild(layer);
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

  /**
   * Positions notes beside the panel (or the toggle): on whichever side has more
   * room, stacked without overlap, each arrow ending at its target's edge.
   */
  function layout(anchorBox, targets) {
    if (!layer) return;
    const side = anchorBox.left >= window.innerWidth - anchorBox.right ? "left" : "right";
    const width = Math.min(NOTE_WIDTH, Math.max(140, (side === "left" ? anchorBox.left : window.innerWidth -
      anchorBox.right) - ARROW_GAP - EDGE));
    const x = side === "left"
      ? Math.max(EDGE, anchorBox.left - ARROW_GAP - width)
      : Math.min(window.innerWidth - EDGE - width, anchorBox.right + ARROW_GAP);
    layer.dataset.side = side;

    const items = layer.__notes.map((parts, index) => {
      const rect = targets[index];
      parts.note.style.width = `${width}px`;
      const hidden = !rect;
      parts.note.classList.toggle("gc-coach-off", hidden);
      parts.curve.classList.toggle("gc-coach-off", hidden);
      parts.head.classList.toggle("gc-coach-off", hidden);
      if (hidden) return null;
      const anchorY = rect.top + Math.min(rect.height / 2, 22);
      // Tip stops just outside the panel edge (the layer sits under the panel).
      const anchorX = side === "left" ? Math.min(rect.left, anchorBox.left) - 5 : Math.max(rect.right, anchorBox.right) + 5;
      return { parts, anchorX, anchorY, height: parts.note.offsetHeight || 48, y: anchorY - 12 };
    }).filter(Boolean);

    // Stack top to bottom without overlap, then pull back up if the last spills off screen.
    for (let i = 1; i < items.length; i += 1) {
      const prev = items[i - 1];
      items[i].y = Math.max(items[i].y, prev.y + prev.height + NOTE_SPACING);
    }
    const footerHeight = layer.__footer ? 52 : 0;
    const last = items[items.length - 1];
    const overflow = last ? last.y + last.height + footerHeight - (window.innerHeight - EDGE) : 0;
    if (overflow > 0) items.forEach((item) => (item.y -= overflow));
    items.forEach((item) => (item.y = Math.max(EDGE, item.y)));

    items.forEach(({ parts, anchorX, anchorY, y, height }) => {
      parts.note.style.left = `${x}px`;
      parts.note.style.top = `${y}px`;
      const startX = side === "left" ? x + width + 8 : x - 8;
      const startY = y + 11;
      const { curve, head } = arrowPaths(startX, startY, anchorX, anchorY);
      parts.curve.setAttribute("d", curve);
      parts.head.setAttribute("d", head);
      const tone = samplePageTone(x + width / 2, y + height / 2);
      parts.note.dataset.tone = tone;
      parts.curve.dataset.tone = tone;
      parts.head.dataset.tone = tone;
    });

    if (layer.__footer && last) {
      const top = last.y + last.height + 14;
      layer.__footer.style.left = `${x}px`;
      layer.__footer.style.top = `${top}px`;
      layer.__footer.dataset.tone = samplePageTone(x + 40, top + 16);
    }
  }

  /** Decides what to show from the current panel/toggle state and lays it out. */
  function refreshCoachOverlay() {
    if (!pending) {
      removeLayer();
      return;
    }
    const root = document.getElementById("gc-root");
    const toggle = document.getElementById("gc-toggle");
    const panelOpen = root && !root.classList.contains("gc-hidden") && root.style.display !== "none";
    const toggleShown = toggle && !toggle.classList.contains("gc-toggle-covered") && toggle.style.display !== "none";
    const nextMode = panelOpen ? "tour" : toggleShown ? "toggle" : "";
    toggle?.classList.toggle("gc-toggle-intro", nextMode === "toggle");

    if (nextMode !== mode || (nextMode && !layer?.isConnected)) {
      mode = nextMode;
      if (mode) buildLayer(mode);
      else removeLayer();
    }
    if (!mode) return;

    const anchorEl = mode === "tour" ? root : toggle;
    const box = anchorEl.getBoundingClientRect();
    const targets = mode === "tour"
      ? TOUR_TARGETS.map((selector) => visibleRect(root.querySelector(selector)))
      : [box];
    const key = [mode, window.innerWidth, window.innerHeight, box.left, box.top, box.right, box.bottom,
      ...targets.map((r) => (r ? `${r.left},${r.top},${r.height}` : "-"))].join("|");
    if (key === lastLayoutKey) return;
    lastLayoutKey = key;
    layout(box, targets);
  }

  /** Follows panel drags, scrolling and resizes while onboarding is pending. */
  function startLoop() {
    cancelRaf(loopHandle);
    const tick = () => {
      if (!pending) return;
      refreshCoachOverlay();
      loopHandle = raf(tick);
    };
    tick();
  }

  /** Escape dismisses the tour (only while it is on screen). */
  function onKeydown(event) {
    if (event.key !== "Escape" || mode !== "tour") return;
    event.preventDefault();
    event.stopPropagation();
    finishOnboarding();
  }

  /** Ends onboarding for good. */
  function finishOnboarding() {
    pending = false;
    mode = "";
    cancelRaf(loopHandle);
    removeLayer();
    document.getElementById("gc-toggle")?.classList.remove("gc-toggle-intro");
    document.removeEventListener("keydown", onKeydown, true);
    safeStorageSet({ [ONBOARDING_SIDEBAR_KEY]: true });
  }

  /** Called when the panel opens; switches straight to the tour. */
  function onPanelOpened() {
    if (pending) refreshCoachOverlay();
  }

  /** Reads the seen flag and starts onboarding for first-time users. */
  function initOnboarding() {
    safeStorageGet([ONBOARDING_SIDEBAR_KEY], (result) => {
      if (result?.[ONBOARDING_SIDEBAR_KEY] === true || pending) return;
      pending = true;
      document.addEventListener("keydown", onKeydown, true);
      startLoop();
    });
  }

  Object.assign(GC, { finishOnboarding, initOnboarding, onPanelOpened, refreshCoachOverlay, samplePageTone });
})();
