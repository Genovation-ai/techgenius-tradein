import { useId, useState } from "react";

/**
 * The steps for one screen, folded away until asked for.
 *
 * Every page carries a one-line lead saying what it is, which is enough once
 * you know the product and not nearly enough on your first week. Printing the
 * full procedure on every screen would bury the actual work under instructions
 * nobody re-reads, so it lives behind one line of text: closed, the page looks
 * exactly as it did; open, it says what to do in the order you do it.
 *
 * Deliberately not a tooltip or a modal. Both hide on the next click, which is
 * useless while you are following steps, and neither can be read by someone
 * who arrived by keyboard without losing their place.
 */
export function HowThisWorks({ steps, label = "How this works" }: { steps: string[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();

  return (
    <div className="admin-how">
      <button
        type="button"
        className="admin-how-toggle"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="admin-how-chev" aria-hidden>
          {open ? "−" : "+"}
        </span>
        {label}
      </button>
      <ol id={id} className="admin-how-steps" hidden={!open}>
        {steps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
    </div>
  );
}
