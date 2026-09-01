import { IconBack, TgMark } from "./BrandIcons";
import { stepLabels, stepOrder, type TradeInStep } from "../lib/tradeInTypes";
import "./TradeInProgress.css";

interface Props {
  step: TradeInStep;
  onBack?: () => void;
}

export function TradeInProgress({ step, onBack }: Props) {
  const visible = stepOrder.filter((s) => s !== "done");
  const idx = visible.indexOf(step === "done" ? "checkout" : step);

  return (
    <div className="tip-bar">
      <div className="tip-top">
        {onBack ? (
          <button type="button" className="tip-back" onClick={onBack} aria-label="Go back">
            <IconBack size={18} />
            Back
          </button>
        ) : (
          <span className="tip-back-spacer" />
        )}
        <div className="tip-brand">
          <TgMark size={20} />
          <span>Tech Genius</span>
        </div>
        <span className="tip-count">
          {Math.min(idx + 1, visible.length)} / {visible.length}
        </span>
      </div>
      <ol className="tip-steps" aria-label="Trade-in progress">
        {visible.map((s, i) => {
          const state = i < idx ? "done" : i === idx ? "current" : "todo";
          return (
            <li key={s} className={`tip-step tip-step--${state}`}>
              <span className="tip-dot" aria-hidden />
              <span className="tip-label">{stepLabels[s]}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
