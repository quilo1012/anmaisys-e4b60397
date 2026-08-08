import { useEffect, useRef, useState } from "react";
import { CheckCircle2, AlertCircle, RefreshCw, CircleDashed } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";

export type SyncState = "idle" | "syncing" | "success" | "error";

interface Props {
  /** True while a refetch/mutation is in flight. */
  isSyncing: boolean;
  /** Error from the last sync attempt, if any. */
  error?: Error | string | null;
  /** Optional label prefix. */
  label?: string;
  className?: string;
}

/**
 * Compact status pill: shows live sync activity, last success time, and errors.
 * Drop into any header — it tracks transitions on its own.
 */
export function SyncStatusIndicator({ isSyncing, error, label = "Sync", className }: Props) {
  const [lastSuccess, setLastSuccess] = useState<Date | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [, force] = useState(0);
  const wasSyncing = useRef(false);

  useEffect(() => {
    if (wasSyncing.current && !isSyncing) {
      if (error) {
        setLastError(typeof error === "string" ? error : error.message);
      } else {
        setLastSuccess(new Date());
        setLastError(null);
      }
    }
    wasSyncing.current = isSyncing;
  }, [isSyncing, error]);

  // Re-render every 30s so "last synced" stays fresh.
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  let state: SyncState = "idle";
  if (isSyncing) state = "syncing";
  else if (lastError) state = "error";
  else if (lastSuccess) state = "success";

  const cfg = {
    idle:    { Icon: CircleDashed, cls: "bg-muted text-muted-foreground border-border", text: "Idle" },
    syncing: { Icon: RefreshCw,    cls: "bg-primary/15 text-primary border-primary/30", text: "Syncing…" },
    success: { Icon: CheckCircle2, cls: "bg-success/15 text-success-strong border-success/30", text: lastSuccess ? `Synced ${formatDistanceToNow(lastSuccess, { addSuffix: true })}` : "Synced" },
    error:   { Icon: AlertCircle,  cls: "bg-destructive/15 text-destructive-strong border-destructive/30", text: lastError ? `Sync failed: ${lastError.slice(0, 60)}` : "Sync failed" },
  }[state];

  const { Icon } = cfg;

  return (
    <div
      title={state === "error" ? lastError ?? "" : cfg.text}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium tabular-nums",
        cfg.cls,
        className,
      )}
    >
      <Icon className={cn("h-3.5 w-3.5", state === "syncing" && "animate-spin")} />
      <span className="hidden sm:inline">{label}:</span>
      <span className="truncate max-w-[200px]">{cfg.text}</span>
    </div>
  );
}
