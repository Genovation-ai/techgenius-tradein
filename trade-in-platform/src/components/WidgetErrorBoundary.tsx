import { Component, type ErrorInfo, type ReactNode } from "react";
import { emitWidgetEvent } from "../lib/widgetEvents";

interface Props {
  children: ReactNode;
  /**
   * Replaces the shopper-facing fallback. The admin portal passes its own,
   * because "call the shop" is nonsense advice to the person running it.
   * Receives a retry that clears the error and re-renders the subtree.
   */
  fallback?: (retry: () => void, message: string) => ReactNode;
  /** Tags the console line so a crash is traceable to a surface. */
  label?: string;
}

interface State {
  failed: boolean;
  message: string;
}

/**
 * Last line of defence for the embedded widget.
 *
 * Without this, a throw during render unmounts the whole React tree and the
 * shopper is left looking at an empty gap in the middle of the /sell page —
 * no message, no way to recover, and nothing to tell us it happened. That is a
 * lost sale we would never hear about.
 *
 * Instead: keep the space occupied, say plainly that the estimator is down,
 * give the shopper a way to reach the shop anyway, and fire an event the host
 * page can forward to analytics.
 */
export class WidgetErrorBoundary extends Component<Props, State> {
  state: State = { failed: false, message: "" };

  static getDerivedStateFromError(error: unknown): State {
    return {
      failed: true,
      message: error instanceof Error ? error.message : String(error),
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Still surface it in the console — swallowing it entirely would make this
    // harder to debug than the crash it replaces.
    console.error(
      `[Reclaim${this.props.label ? ` ${this.props.label}` : ""}] crashed:`,
      error,
      info.componentStack,
    );
    // Message only: component stacks and shopper input never leave the page.
    emitWidgetEvent("techgenius:widget_error", { error: error.name || "Error" });
  }

  private retry = (): void => {
    this.setState({ failed: false, message: "" });
  };

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    if (this.props.fallback) return this.props.fallback(this.retry, this.state.message);

    return (
      <div className="tg-widget-error" role="alert">
        <h2>The trade-in estimator isn’t loading</h2>
        <p>
          Something went wrong on our side, not yours. Your device is still worth
          what it’s worth — we just can’t show you the number right now.
        </p>
        <div className="tg-widget-error__actions">
          <button type="button" onClick={this.retry} className="tg-widget-error__retry">
            Try again
          </button>
          <a href="tel:+12894555556" className="tg-widget-error__call">
            Call (289) 455-5556
          </a>
        </div>
        <p className="tg-widget-error__detail">
          Or email <a href="mailto:info@techgenius.ca">info@techgenius.ca</a> and
          we’ll quote it by hand.
        </p>
      </div>
    );
  }
}
