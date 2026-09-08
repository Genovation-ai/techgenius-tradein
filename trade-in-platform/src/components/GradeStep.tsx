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
  onSelect: (g: ConditionGrade) => void;
  onContinue: () => void;
}

const grades: ConditionGrade[] = ["flawless", "good", "average", "fair", "defective"];

export function GradeStep({ aiResult, grade, valuation, onSelect, onContinue }: Props) {
  const locked = isGradeLockedToDefective(valuation);
  const lockNote = gradeLockReason(valuation);

  return (
    <section className="flow-panel">
      <header className="flow-header">
        <p className="flow-kicker">Confirm grade</p>
        <h1>State of your device</h1>
        <p className="flow-lead">
          Pick the band that matches what you see and how it works. We’ll verify at intake.
        </p>
      </header>

      {aiResult ? (
        <div className="ai-prefills-block">
          <p className="ai-prefills">
            Photo check suggested <strong>{gradeLabels[aiResult.suggestedGrade]}</strong>
            {aiResult.confidence ? ` (${aiResult.confidence}% match)` : ""}
            {aiResult.usedMedia ? " from your multi-angle photos" : ""}. You can still choose a
            different band unless locked by checklist.
          </p>
          {aiResult.issues && aiResult.issues.length > 0 ? (
            <ul className="grade-issue-list">
              {aiResult.issues.slice(0, 8).map((issue) => (
                <li key={issue.id}>
                  <strong>{issue.label}</strong>
                  <span>
                    {issue.angle} · {issue.severity}
                  </span>
                </li>
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
              <ul>
                {gradeDefinitions[g].map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </button>
          );
        })}
      </div>

      <button
        type="button"
        className="btn btn-primary flow-cta"
        disabled={!grade}
        onClick={onContinue}
      >
        See my cash offer
      </button>
    </section>
  );
}
