import {
  gradeDefinitions,
  gradeLabels,
  gradeLockReason,
  gradeTaglines,
  isGradeLockedToDefective,
  type ConditionGrade,
  type ValuationAnswers,
} from "../data/catalog";
import type { AiScanResult } from "../lib/tradeInTypes";
import "./FormSteps.css";
import "./OfferStep.css";

interface Props {
  aiResult: AiScanResult | null;
  grade: ConditionGrade | null;
  valuation: ValuationAnswers;
  /** The single legal confirmation that replaced two checklist questions. */
  owned: boolean;
  onOwned: (v: boolean) => void;
  onSelect: (g: ConditionGrade) => void;
  onContinue: () => void;
}

const grades: ConditionGrade[] = ["flawless", "good", "average", "fair", "defective"];

export function GradeStep({
  aiResult,
  grade,
  valuation,
  owned,
  onOwned,
  onSelect,
  onContinue,
}: Props) {
  const locked = isGradeLockedToDefective(valuation);
  const lockNote = gradeLockReason(valuation);

  return (
    <section className="flow-panel">
      <header className="flow-header">
        <p className="flow-kicker">Condition</p>
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

      {locked && lockNote ? (
        <p className="grade-lock-banner" role="status">
          {lockNote}
        </p>
      ) : null}

      <div className="grade-list">
        {grades.map((g) => {
          const disabled = locked && g !== "defective";
          const selected = grade === g;
          return (
            <button
              key={g}
              type="button"
              disabled={disabled}
              aria-disabled={disabled}
              className={`grade-card ${selected ? "grade-card--on" : ""}${disabled ? " grade-card--locked" : ""}`}
              onClick={() => {
                if (disabled) return;
                onSelect(g);
              }}
            >
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
        See my cash offer
      </button>
    </section>
  );
}
