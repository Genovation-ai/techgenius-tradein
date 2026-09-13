import { useRef } from "react";
import { motion, useReducedMotion, useScroll, useSpring, useTransform } from "framer-motion";

/**
 * The section's own argument, drawn.
 *
 * "Most shops guess. Guessing is what costs you." sat beside forty per cent of
 * empty column, and the point it makes is a quantity — what guessing costs —
 * which is the kind of thing a picture carries better than a paragraph.
 *
 * Two bars scrub against scroll over ten trade-ins: one shop quoting from
 * published prices, one guessing. The guesser's margin does not fall steadily;
 * it swings, because sometimes you overpay and sometimes the customer walks,
 * and both cost you. By the bottom of the section the gap is the argument.
 *
 * Scrubbed rather than played. A loop would run whether or not anyone was
 * looking and would finish before a reader reached the sentence it illustrates;
 * tying it to scroll position means the reader sets the pace, and it holds
 * still while they read. Reduced motion gets the finished state, which is the
 * state that carries the meaning anyway.
 */

const DEALS = 10;
// A guesser's run: over on some, under on others, and under means no deal at all.
const GUESSED = [82, 61, 74, 38, 66, 24, 58, 31, 47, 19];
const PRICED = [88, 86, 89, 85, 88, 87, 86, 88, 87, 88];

export function MarginDrift() {
  const ref = useRef<HTMLDivElement | null>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start 0.85", "end 0.35"],
  });
  const eased = useSpring(scrollYProgress, { stiffness: 90, damping: 26, mass: 0.4 });
  // How many of the ten have "happened" at this scroll position.
  const dealt = useTransform(eased, (v) => v * DEALS);

  return (
    <div className="rc-drift" ref={ref} aria-hidden>
      <p className="rc-drift-cap">Ten trade-ins, same devices</p>
      <div className="rc-drift-plot">
        {Array.from({ length: DEALS }, (_, i) => (
          <div className="rc-drift-col" key={i}>
            <Bar value={PRICED[i]} index={i} dealt={dealt} kind="priced" reduce={!!reduce} />
            <Bar value={GUESSED[i]} index={i} dealt={dealt} kind="guessed" reduce={!!reduce} />
          </div>
        ))}
      </div>
      <div className="rc-drift-key">
        <span className="rc-drift-swatch rc-drift-swatch--priced" /> Priced from the market
        <span className="rc-drift-swatch rc-drift-swatch--guessed" /> Guessed
      </div>
    </div>
  );
}

function Bar({
  value,
  index,
  dealt,
  kind,
  reduce,
}: {
  value: number;
  index: number;
  dealt: ReturnType<typeof useTransform<number, number>>;
  kind: "priced" | "guessed";
  reduce: boolean;
}) {
  // Each bar grows across its own single deal, so they arrive one after another
  // rather than all rising together like a loading screen.
  const h = useTransform(dealt, [index, index + 1], [0, value], { clamp: true });
  const height = useTransform(h, (v) => `${v}%`);
  return (
    <span className={`rc-drift-bar rc-drift-bar--${kind}`}>
      <motion.i style={reduce ? { height: `${value}%` } : { height }} />
    </span>
  );
}
