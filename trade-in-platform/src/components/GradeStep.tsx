import {
  gradeDefinitions,
  gradeLabels,
  gradeTaglines,
  type ConditionGrade,
} from "../data/catalog";
import type { AiScanResult } from "../lib/tradeInTypes";
import "./FormSteps.css";
import "./OfferStep.css";

interface Props {
  aiResult: AiScanResult | null;
  grade: ConditionGrade | null;
  /** The single legal confirmation that replaced two checklist questions. */
  owned: boolean;
  onOwned: (v: boolean) => void;
  onSelect: (g: ConditionGrade) => void;
  onContinue: () => void;
  /**
   * What each condition is worth. Not shown on the cards — the panel beside
   * them shows the one the customer picked — but it decides whether the
   * button can say "Continue" or has to admit the price is still coming.
   */
  prices?: Partial<Record<ConditionGrade, number | null>>;
}

const grades: ConditionGrade[] = ["flawless", "good", "average", "fair", "defective"];

export function GradeStep({
  aiResult,
  grade,
  owned,
  onOwned,
  onSelect,
  onContinue,
  prices,
}: Props) {

  return (
    <section className="flow-panel">
      <header className="flow-header">
        <h1>What sort of shape is it in?</h1>
        <p className="flow-lead">
          Pick the one that sounds like your device. We check it when it arrives — if it is better
          than you said, you get the higher price.
        </p>
      </header>

      {/* Only when photos were actually taken. Skipping them still produces a
          scan result, and claiming "from your photos" over nothing is the kind
          of small untruth a customer notices. */}
      {aiResult && aiResult.usedMedia ? (
        <div className="ai-prefills-block">
          {/* A percentage next to a guess invites an argument about the
              percentage. Say what it thinks and let the customer overrule it. */}
          <p className="ai-prefills">
            From your photos this looks like <strong>{gradeLabels[aiResult.suggestedGrade]}</strong>.
            Pick something else if you disagree.
          </p>
          {aiResult.issues && aiResult.issues.length > 0 ? (
            <ul className="grade-issue-list">
              {aiResult.issues.slice(0, 4).map((issue) => (
                <li key={issue.id}>{issue.label}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <div className="grade-list">
        {grades.map((g) => {
          // The cards must never disable each other. Condition is stated only
          // here now, so the valuation the lock reads is derived from the card
          // the customer just tapped — and As-Is sets powerOn:false, which used
          // to lock the step and grey out every other card. That trapped anyone
          // who tapped As-Is (even to read it) with no way back to a higher
          // grade. We verify the real condition when the device arrives, so the
          // honest model is to let them pick freely and correct it on receipt.
          const selected = grade === g;
          return (
            <button
              key={g}
              type="button"
              className={`grade-card ${selected ? "grade-card--on" : ""}`}
              onClick={() => onSelect(g)}
            >
              {/* No price here. Five figures side by side turns "which of
                  these describes my phone" into "which of these pays most",
                  and the customer picks the number instead of the truth —
                  then the device arrives and the grade has to be corrected.
                  The price for the condition they chose appears beside it,
                  the moment they choose. */}
              <span className="grade-card-title">{gradeLabels[g]}</span>
              <span className="grade-card-tagline">{gradeTaglines[g]}</span>
              {/* Five cards each listing six or seven bullets made this a
                  5,000px page to answer one question. The tagline is what a
                  customer chooses on; the full definition appears for the card
                  they picked, which is the only one they need to check. */}
              {selected ? (
                <ul>
                  {gradeDefinitions[g].map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              ) : null}
            </button>
          );
        })}
      </div>

      {/* Two checklist questions — clean IMEI and activation lock — collapsed
          into the one sentence a customer can actually answer. It stays
          required: we cannot buy a locked or stolen device. */}
      <label className="own-confirm">
        <input type="checkbox" checked={owned} onChange={(e) => onOwned(e.target.checked)} />
        <span>
          It is mine to sell, not lost or stolen, and the iCloud or Google account lock is off.
        </span>
      </label>

      <button
        type="button"
        className="btn btn-primary flow-cta"
        disabled={!grade || !owned}
        onClick={onContinue}
      >
        {grade && prices && prices[grade] != null ? "Continue" : "See my cash offer"}
      </button>
    </section>
  );
}
