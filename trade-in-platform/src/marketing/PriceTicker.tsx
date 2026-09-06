import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { fetchDevices, type ApiDevice } from "../lib/tradeInApi";

/**
 * Ambient backdrop for the sign-in panel.
 *
 * Two columns of real models and the prices this engine would pay for them,
 * drifting slowly upward. It is atmosphere, but atmosphere made of the product's
 * own output rather than an abstract gradient — the thing being sold, quietly
 * running behind the form.
 *
 * Deliberately low-contrast and never interactive: a sign-in screen's job is the
 * password field, and anything here that pulled the eye would be working against
 * that. Hidden on small screens and frozen for reduced-motion.
 */
export function PriceTicker() {
  const reduce = useReducedMotion();
  const [rows, setRows] = useState<Array<{ name: string; price: number }>>([]);

  useEffect(() => {
    let cancelled = false;
    void fetchDevices({ categoryId: "smartphone", limit: 300 })
      .then((devices: ApiDevice[]) => {
        if (cancelled) return;
        // max_price_flawless is already on the catalogue payload, so this costs
        // no extra requests — no quote call per row on a page nobody has signed
        // into yet.
        // Sorted by value, not the alphabet. Unsorted this opened on
        // "Galaxy A13 $49" — true, and a poor advertisement for what the
        // engine is worth to a shop.
        const priced = devices
          .filter((d) => (d.max_price_flawless ?? 0) > 40)
          .map((d) => ({ name: d.name, price: Math.round(d.max_price_flawless ?? 0) }))
          .sort((a, b) => b.price - a.price);
        setRows(priced.slice(0, 20));
      })
      .catch(() => setRows([]));
    return () => {
      cancelled = true;
    };
  }, []);

  if (!rows.length) return null;

  const columns = [rows.filter((_, i) => i % 2 === 0), rows.filter((_, i) => i % 2 === 1)];

  return (
    <div className="rc-ticker" aria-hidden>
      {columns.map((col, ci) => (
        <motion.div
          key={ci}
          className="rc-ticker-col"
          style={{ left: ci === 0 ? "6%" : "58%" }}
          initial={{ y: ci === 0 ? 0 : -80 }}
          animate={reduce ? {} : { y: ["0%", "-50%"] }}
          transition={{
            duration: ci === 0 ? 58 : 74,
            repeat: Infinity,
            ease: "linear",
          }}
        >
          {/* Doubled so the loop point never shows a gap. */}
          {[...col, ...col].map((r, i) => (
            <span className="rc-ticker-row" key={`${r.name}-${i}`}>
              {r.name}
              <b>${r.price}</b>
            </span>
          ))}
        </motion.div>
      ))}
    </div>
  );
}
