import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "./Button";

interface SectionBoundaryProps {
  children: ReactNode;
  /** What the part is called in the sentence: "This part got tangled" by default, "The summary got tangled" with one. */
  name?: string;
  /** Changes when the part's data does: a failed part tries again with it, so a fresh answer from the server heals it. */
  resetKey?: unknown;
  className?: string;
}

interface State {
  error: unknown;
  key: unknown;
}

/**
 * One section of a screen that failed to draw, said small, in place, while the rest of the screen keeps working (a
 * screen's own error screen, ui/ErrorScreen, is for the whole page). Nothing is lost: it is only drawing that failed.
 * Tries again by itself when `resetKey` changes, and has a quiet "Try again".
 */
export class SectionBoundary extends Component<SectionBoundaryProps, State> {
  override state: State = { error: null, key: this.props.resetKey };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error: error ?? new Error("Unknown error") };
  }

  static getDerivedStateFromProps(props: SectionBoundaryProps, state: State): Partial<State> | null {
    return Object.is(props.resetKey, state.key) ? null : { error: null, key: props.resetKey };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error("A section failed to draw", error, info.componentStack);
  }

  override render() {
    if (this.state.error === null) return this.props.children;
    const { name = "This part", className } = this.props;
    return (
      <div
        role="alert"
        className={className ?? "bg-ink/3 text-ink-soft flex flex-col items-start gap-2 rounded-lg p-4"}
      >
        <p className="text-body text-ink font-semibold">{name} got tangled</p>
        <p className="text-small">Nothing you saved is lost. The rest of the page still works.</p>
        <Button size="sm" variant="quiet" onClick={() => this.setState({ error: null })}>
          Try again
        </Button>
      </div>
    );
  }
}
