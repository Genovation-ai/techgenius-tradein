import { IconBack, TgMark } from "./BrandIcons";
import { stepLabels, stepOrder, type TradeInStep } from "../lib/tradeInTypes";
import { useOrgBranding } from "../hooks/useOrgBranding";
import "./TradeInProgress.css";

interface Props {
  step: TradeInStep;
  onBack?: () => void;
  /**
   * A different journey on the same rail. The repair flow has its own steps
   * and names; passing them here keeps one progress bar for both rather than
   * a second component that drifts from the first.
   */
  overrideOrder?: string[];
  overrideLabels?: Record<string, string>;
  overrideCurrent?: string;
}

export function TradeInProgress({ step, onBack, overrideOrder, overrideLabels, overrideCurrent }: Props) {
  const branding = useOrgBranding();
  const order: string[] = overrideOrder ?? stepOrder;
  const labels: Record<string, string> = overrideLabels ?? stepLabels;
  const current: string = overrideCurrent ?? step;
  const visible = order.filter((s) => s !== "done");
  const last = visible[visible.length - 1];
  const idx = visible.indexOf(current === "done" ? last : current);

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
          {branding.logoUrl ? (
            <img src={branding.logoUrl} alt="" className="tip-brand-logo" height={20} />
          ) : (
            <TgMark size={20} />
          )}
          <span>{branding.companyName}</span>
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
              <span className="tip-label">{labels[s]}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
