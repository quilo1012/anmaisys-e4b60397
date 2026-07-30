import { Component, ErrorInfo, ReactNode } from "react";
import { logSystemError } from "@/lib/telemetry";
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
    logSystemError("REACT_CRASH", error.message || "React render crash", {
      stack: error.stack,
      metadata: { componentStack: info.componentStack?.slice(0, 4000) },
    });
    void this.reloadIfStaleBuild();
  }

  /**
   * If a newer build has been published, reload into it.
   *
   * A crash we have already fixed keeps happening until the tablet picks up the new
   * bundle, and a tablet parked on this error card never does: the periodic update
   * check reloads on the next background or shows a banner, and neither happens
   * while an operator stares at a broken screen waiting for someone to help. On
   * 30/07 a shop tablet crashed at 05:41 on a chunk whose fix had shipped hours
   * earlier, because nothing closed that loop.
   *
   * Only fires when the served entry bundle differs from the running one, so a
   * genuine bug in the current build still shows the card instead of reloading
   * forever. Once per minute at most, for the same reason.
   */
  private async reloadIfStaleBuild() {
    const KEY = "__crash_reload_at";
    try {
      const last = Number(sessionStorage.getItem(KEY) || "0");
      if (Date.now() - last < 60_000) return;

      const running = Array.from(document.querySelectorAll<HTMLScriptElement>('script[type="module"][src]'))
        .map((s) => s.src)
        .find((src) => /\/assets\/.*\.js/.test(src));
      if (!running) return; // dev server has no hashed entry to compare

      const res = await fetch(`/index.html?_=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) return;
      const html = await res.text();
      const served = html.match(/<script[^>]+type="module"[^>]+src="([^"]*\/assets\/[^"]+\.js)"/i)?.[1];
      if (!served) return;

      if (new URL(served, location.href).pathname !== new URL(running, location.href).pathname) {
        sessionStorage.setItem(KEY, String(Date.now()));
        window.location.reload();
      }
    } catch {
      /* offline or blocked — leave the card up so the operator can retry by hand */
    }
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
              <AlertTriangle className="h-10 w-10 text-destructive-strong mx-auto" />
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
