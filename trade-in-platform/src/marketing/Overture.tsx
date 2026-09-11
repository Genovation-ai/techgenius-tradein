import { useCallback, useEffect, useRef, useState } from "react";
import "./Overture.css";

/**
 * The moment before the landing page.
 *
 * The product's whole claim is that a vague device becomes an exact number, so
 * that is what this shows: a price unsettled, resolving, and landing. A logo
 * fading up would have been the default and would have said nothing about what
 * is being sold.
 *
 * It obeys the landing page's own rule that the price is never coloured — the
 * figure resolves in white, and the single emerald accent stays on the hairline
 * that measures the wait, so the colour still means "live" when the landing
 * takes over.
 *
 * Three things keep it from becoming an obstacle:
 *   - it plays once per session, so returning to the tab is not a performance;
 *   - anything a person does skips it — key, pointer, scroll, or the button;
 *   - a request for reduced motion means it never mounts at all.
 *
 * The landing renders underneath the whole time, so nothing about the page's
 * load or layout waits on this.
 */

const DIGITS = "0123456789";
const SETTLE_MS = 1150;
const HOLD_MS = 380;
const SEEN_KEY = "rc-overture-seen";

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

function alreadySeen(): boolean {
  try {
    return sessionStorage.getItem(SEEN_KEY) === "1";
  } catch {
    // Private windows can throw on access. A visitor who cannot be remembered
    // sees it once per page view rather than not at all.
    return false;
  }
}

export function Overture({ target = 1274 }: { target?: number }) {
  const [show, setShow] = useState(() => !alreadySeen() && !prefersReducedMotion());
  const [leaving, setLeaving] = useState(false);
  const [display, setDisplay] = useState("0000");
  const raf = useRef(0);
  /* Guarded by a ref rather than by `leaving`, and holding no dependency on
     state, so `finish` keeps one identity for the life of the component. An
     earlier version closed over `leaving`: calling it changed the callback,
     which re-ran the effect below, whose cleanup cleared the very timer the
     call had just scheduled — so the overture faded and then sat there for
     ever, over the page. */
  const done = useRef(false);
  const hideTimer = useRef(0);

  const finish = useCallback(() => {
    if (done.current) return;
    done.current = true;
    setLeaving(true);
    try {
      sessionStorage.setItem(SEEN_KEY, "1");
    } catch {
      /* nothing to remember with; it simply plays again next time */
    }
    hideTimer.current = window.setTimeout(() => setShow(false), 520);
  }, []);

  // The hide timer belongs to the component, not to the animation effect, so
  // only unmounting cancels it.
  useEffect(() => () => clearTimeout(hideTimer.current), []);

  useEffect(() => {
    if (!show) return;
    const digits = String(target).length;
    const started = performance.now();
    let settleTimer = 0;

    const tick = (now: number) => {
      const t = Math.min(1, (now - started) / SETTLE_MS);
      // Digits lock left to right, the way a mechanical display settles, so
      // the number reads as arriving at a value rather than counting up to it.
      const locked = Math.floor(t * t * digits);
      const out = String(target)
        .split("")
        .map((c, i) => (i < locked ? c : DIGITS[Math.floor(Math.random() * 10)]))
        .join("");
      setDisplay(out);
      if (t < 1) {
        raf.current = requestAnimationFrame(tick);
      } else {
        setDisplay(String(target));
        settleTimer = window.setTimeout(finish, HOLD_MS);
      }
    };
    raf.current = requestAnimationFrame(tick);

    const skip = () => finish();
    window.addEventListener("keydown", skip, { once: true });
    window.addEventListener("pointerdown", skip, { once: true });
    window.addEventListener("wheel", skip, { once: true, passive: true });
    window.addEventListener("touchstart", skip, { once: true, passive: true });

    return () => {
      cancelAnimationFrame(raf.current);
      clearTimeout(settleTimer);
      window.removeEventListener("keydown", skip);
      window.removeEventListener("pointerdown", skip);
      window.removeEventListener("wheel", skip);
      window.removeEventListener("touchstart", skip);
    };
  }, [show, target, finish]);

  // The landing is already mounted and interactive behind this, so locking the
  // scroll is the only thing needed to keep the two from fighting.
  useEffect(() => {
    if (!show) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [show]);

  if (!show) return null;

  return (
    <div className={`rc-overture${leaving ? " is-leaving" : ""}`} role="presentation">
      <div className="rc-overture-inner">
        <p className="rc-overture-mark">Reclaim</p>
        <p className="rc-overture-price" aria-hidden>
          <span className="rc-overture-cur">$</span>
          {display}
        </p>
        <p className="rc-overture-say">what a phone is worth, before you pay for it</p>
        <span className="rc-overture-rule" aria-hidden />
      </div>
      <button type="button" className="rc-overture-skip" onClick={finish}>
        Skip
      </button>
    </div>
  );
}
