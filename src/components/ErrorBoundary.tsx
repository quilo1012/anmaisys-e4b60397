import { Component, ErrorInfo, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AlertTriangle } from "lucide-react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  info: ErrorInfo | null;
}

/** First meaningful frame of a stack — enough to point at a file/line without a wall of text. */
function firstFrame(error: Error | null, info: ErrorInfo | null): string {
  const stack = error?.stack || "";
  const line = stack.split("\n").map((l) => l.trim()).find((l) => l.startsWith("at ") && !/ErrorBoundary/.test(l));
  if (line) return line;
  const comp = info?.componentStack?.split("\n").map((l) => l.trim()).find(Boolean);
  return comp || "";
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("ErrorBoundary caught:", error, info);
    this.setState({ info });
  }

  // A deterministic crash (bad data, a stale chunk after deploy) re-throws the
  // instant we reset React state, so "Try again" looked like it did nothing.
  // A hard reload fetches fresh code and clears the transient.
  handleReload = () => window.location.reload();
  handleReset = () => this.setState({ hasError: false, error: null, info: null });

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      const { error, info } = this.state;
      const detail = firstFrame(error, info);
      return (
        <div className="p-6 flex items-center justify-center min-h-[300px]">
          <Card className="max-w-md w-full">
            <CardContent className="p-6 text-center space-y-4">
              <AlertTriangle className="h-10 w-10 text-destructive mx-auto" />
              <div>
                <h2 className="text-lg font-semibold">Something went wrong</h2>
                <p className="text-sm text-muted-foreground mt-1 break-words">
                  {error?.message || "Unexpected error"}
                </p>
                {detail && (
                  <p className="mt-2 font-mono text-[11px] leading-snug text-muted-foreground/70 break-words">
                    {error?.name ? `${error.name} · ` : ""}{detail}
                  </p>
                )}
              </div>
              <div className="flex items-center justify-center gap-2">
                <Button onClick={this.handleReload}>Reload</Button>
                <Button variant="outline" onClick={this.handleReset}>Try again</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
