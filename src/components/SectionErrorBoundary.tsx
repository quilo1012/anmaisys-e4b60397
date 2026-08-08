import { Component, ErrorInfo, ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { logSystemError } from "@/lib/telemetry";

interface Props {
  children: ReactNode;
  /** Names the block, so the message says which one failed. */
  title?: string;
}

interface State {
  hasError: boolean;
  message: string | null;
}

/**
 * Contains a failure to one block of a screen.
 *
 * The app-level ErrorBoundary catches everything, which means one widget throwing
 * takes the whole page with it — on a line TV or an operator's tablet that is the
 * difference between "this chart is unavailable" and a blank screen mid-shift.
 *
 * Deliberately narrower than the app boundary: it does not reload on a stale build
 * (that is the app boundary's job, and doing it here would reload the page from
 * under someone reading the rest of it) but it does report, so a widget that fails
 * quietly still reaches Root Diagnostics.
 */
export class SectionErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message || null };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("SectionErrorBoundary caught:", error, info);
    logSystemError("REACT_CRASH", `${this.props.title ?? "Section"}: ${error.message || "render crash"}`, {
      stack: error.stack,
      metadata: { section: this.props.title, componentStack: info.componentStack?.slice(0, 2000) },
    });
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div
        role="alert"
        className="flex min-h-[140px] flex-col items-center justify-center rounded-lg border border-warning/40 bg-warning/10 p-4 text-center"
      >
        <AlertTriangle className="mb-2 h-5 w-5 text-warning-strong" />
        <p className="text-sm font-semibold">{this.props.title ?? "This section"} could not be shown</p>
        <p className="mt-0.5 max-w-sm text-2xs text-muted-foreground">
          The rest of the screen is unaffected. {this.state.message}
        </p>
        <Button
          variant="outline"
          size="sm"
          className="mt-2 h-7 text-xs"
          onClick={() => this.setState({ hasError: false, message: null })}
        >
          <RefreshCw className="mr-1 h-3 w-3" /> Try again
        </Button>
      </div>
    );
  }
}

export default SectionErrorBoundary;
