/**
 * Bring a flow panel's top into view when the customer moves between steps.
 *
 * Shared by the trade-in and the repair flow because both had the same bug and
 * only one of them would otherwise have been fixed.
 */

/**
 * How much of the top of the viewport the shop's own header is covering.
 *
 * The widget is a guest on someone else's page, and most of them have a sticky
 * header. Scrolling the widget's top to y=0 tucked the step heading underneath
 * it, so the customer arrived at a step already looking past its title. Rather
 * than hard-coding a guess, ask the browser what is actually painted at the top
 * centre and measure the fixed or sticky ones.
 */
export function stickyHeaderOffset(): number {
  if (typeof document.elementsFromPoint !== "function") return 0;
  let offset = 0;
  for (const el of document.elementsFromPoint(window.innerWidth / 2, 1)) {
    const pos = getComputedStyle(el).position;
    if (pos !== "fixed" && pos !== "sticky") continue;
    const rect = el.getBoundingClientRect();
    // Only bars pinned to the top, and only sane ones — a full-screen fixed
    // overlay would otherwise push the scroll target off the page.
    if (rect.top <= 0 && rect.bottom > offset && rect.height < window.innerHeight / 2) {
      offset = rect.bottom;
    }
  }
  return offset;
}

/** Are we running inside someone else's page? */
export function isEmbedded(): boolean {
  try {
    return window.top !== window.self;
  } catch {
    // A cross-origin parent throws on access, which itself proves we are framed.
    return true;
  }
}

/**
 * Put `root`'s top where the customer can see it.
 *
 * Embedded, the page that scrolls is not ours. On Framer the widget runs inside
 * an about:srcdoc iframe sized to its content, so window.scrollTo moves a
 * document with nothing to scroll: the customer stays where they were, near the
 * bottom of the taller step they just left, looking at the continue button with
 * the question off-screen above it. That is the "screen starts from the lower
 * end" the shop reported, and why it was worst on a phone, where the device
 * grid is longest. scrollIntoView is the call that crosses the frame boundary —
 * browsers walk it up through ancestor documents.
 *
 * Standalone we can be exact instead, and allow for the shop's sticky header.
 */
export function scrollFlowIntoView(root: HTMLElement | null): void {
  if (!root) return;
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const behavior: ScrollBehavior = reduce ? "auto" : "smooth";

  if (isEmbedded()) {
    root.scrollIntoView({ block: "start", behavior });
    return;
  }

  const top = root.getBoundingClientRect().top + window.scrollY - stickyHeaderOffset() - 12;
  // Only pull the page up. Scrolling down to the widget on a step change is the
  // same yank the first-mount guard avoids.
  if (window.scrollY > top) {
    window.scrollTo({ top: Math.max(0, top), behavior });
  }
}
