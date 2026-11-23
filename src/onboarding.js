// First-run onboarding for the Gmail sidebar: the toggle pulses until the panel
// is first opened, then a short inline coach card walks through the sections once.
(() => {
  const GC = window.__gc;
  if (!GC || GC.skipLoad) return;

  const { ONBOARDING_SIDEBAR_KEY, STRINGS, h, safeStorageGet, safeStorageSet } = GC;

  const STEPS = [
    { target: ".gc-section-prepare", ...STRINGS.onboarding.steps[0] },
    { target: ".gc-section-archive", ...STRINGS.onboarding.steps[1] },
    { target: "#gc-execute-selected", ...STRINGS.onboarding.steps[2] }
  ];

  let pending = false;
  let stepIndex = -1;

  /** Removes the coach card and any highlight. */
  function clearCoach() {
    document.getElementById("gc-coach")?.remove();
    document.querySelectorAll(".gc-coach-target").forEach((el) => el.classList.remove("gc-coach-target"));
  }

  /** Ends the tour for good (finished or skipped). */
  function finishOnboarding() {
    pending = false;
    stepIndex = -1;
    clearCoach();
    document.getElementById("gc-toggle")?.classList.remove("gc-toggle-intro");
    safeStorageSet({ [ONBOARDING_SIDEBAR_KEY]: true });
  }

  /** Builds the coach card for one step. */
  function buildCoach(step, index) {
    const ui = STRINGS.onboarding;
    const last = index === STEPS.length - 1;
    const next = h("button", { type: "button", class: "gc-coach-next" }, last ? ui.done : ui.next);
    const skip = h("button", { type: "button", class: "gc-coach-skip" }, ui.skip);
    next.addEventListener("click", () => (last ? finishOnboarding() : showStep(index + 1)));
    skip.addEventListener("click", finishOnboarding);
    const card = h(
      "div",
      { id: "gc-coach", role: "dialog", "aria-live": "polite", "aria-label": ui.ariaLabel },
      h("p", { class: "gc-coach-count" }, ui.count(index + 1, STEPS.length)),
      h("p", { class: "gc-coach-title" }, step.title),
      h("p", { class: "gc-coach-text" }, step.text),
      h("div", { class: "gc-coach-actions" }, skip, next)
    );
    card.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      finishOnboarding();
    });
    return card;
  }

  /** Shows step index: highlights its target and inserts the card right after it. */
  function showStep(index) {
    clearCoach();
    const step = STEPS[index];
    const target = step && document.querySelector(`#gc-root ${step.target}`);
    if (!target) {
      finishOnboarding();
      return;
    }
    stepIndex = index;
    target.classList.add("gc-coach-target");
    const card = buildCoach(step, index);
    target.after(card);
    card.scrollIntoView?.({ block: "nearest" });
    card.querySelector(".gc-coach-next")?.focus({ preventScroll: true });
  }

  /** Called whenever the panel opens; starts the tour on the very first open. */
  function onPanelOpened() {
    if (!pending || stepIndex >= 0) return;
    document.getElementById("gc-toggle")?.classList.remove("gc-toggle-intro");
    showStep(0);
  }

  /** Reads the seen flag and arms the toggle pulse for first-time users. */
  function initOnboarding() {
    // A remount rebuilds the panel, so any card from before is gone.
    stepIndex = -1;
    safeStorageGet([ONBOARDING_SIDEBAR_KEY], (result) => {
      if (result?.[ONBOARDING_SIDEBAR_KEY] === true) return;
      pending = true;
      const root = document.getElementById("gc-root");
      if (root && !root.classList.contains("gc-hidden")) {
        onPanelOpened();
      } else {
        document.getElementById("gc-toggle")?.classList.add("gc-toggle-intro");
      }
    });
  }

  Object.assign(GC, { finishOnboarding, initOnboarding, onPanelOpened });
})();
