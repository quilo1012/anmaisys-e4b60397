import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Loader2, Settings2, FileSpreadsheet } from "lucide-react";
import { invokeFunction } from "@/lib/invokeFunction";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Whether the SharePoint reader actually answered — not when the screen last tried.
 *
 * The old badge went green on any completed local refetch, so a tunnel that had
 * been dead for weeks still read "Synced a minute ago" and nobody investigated
 * while the plan figures drifted from the workbook. This asks the reader itself,
 * through the `health` mode of rag-sharepoint-sync, which returns a structured
 * unavailable state with the configured address when the reader is down.
 */

export type RagServiceHealth =
  | { state: "ok"; checkedAt: string; base: string | null; service: string | null }
  | { state: "unreachable" | "not_configured" | "failed"; checkedAt: string; base: string | null; message: string };

export function useRagServiceHealth() {
  return useQuery({
    queryKey: ["rag-service-health"],
    // The reader restarts often; re-ask every few minutes rather than trusting a
    // check taken when the page first opened.
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    refetchOnWindowFocus: true,
    retry: false,
    queryFn: async (): Promise<RagServiceHealth> => {
      const checkedAt = new Date().toISOString();
      const { data, error } = await invokeFunction<any>("rag-sharepoint-sync", { mode: "health" });
      // A failed health call carries the function's own JSON body in `details`.
      const payload = (error as any)?.details ?? data;
      const kind = payload?.error;
      if (kind === "not_configured") {
        return {
          state: "not_configured",
          checkedAt,
          base: null,
          message: payload?.message || "No SharePoint reader address is set.",
        };
      }
      if (kind || error) {
        return {
          state: kind === "unreachable" ? "unreachable" : "failed",
          checkedAt,
          base: payload?.base ?? null,
          message: payload?.message || (error as any)?.message || "The SharePoint reader did not answer.",
        };
      }
      return {
        state: "ok",
        checkedAt,
        base: data?.base ?? null,
        service: data?.health?.service ?? null,
      };
    },
  });
}

function shortTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
}

export function RagSyncHealthBadge({
  isBusy,
  isAdmin,
  onOpenSettings,
  onOpenManualImport,
  className,
}: {
  /** True while the screen is reading or writing its own data. */
  isBusy?: boolean;
  /** Only an admin sees the configured address. */
  isAdmin?: boolean;
  onOpenSettings?: () => void;
  onOpenManualImport?: () => void;
  className?: string;
}) {
  const { data, isLoading, isFetching, refetch } = useRagServiceHealth();

  const healthy = data?.state === "ok";
  const checking = isLoading || (isFetching && !data);

  const cls = checking
    ? "bg-muted text-muted-foreground border-border"
    : healthy
      ? "bg-success/15 text-success-strong border-success/30"
      : "bg-destructive/15 text-destructive-strong border-destructive/30";

  const text = checking
    ? "Checking service…"
    : healthy
      ? `Synced — service answered ${shortTime((data as any).checkedAt)}`
      : data?.state === "not_configured"
        ? "Sync unavailable — no reader address set"
        : "Sync unavailable — the SharePoint reader is not responding";

  const Icon = checking ? Loader2 : healthy ? CheckCircle2 : AlertTriangle;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={text}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium tabular-nums",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            cls,
            className,
          )}
        >
          <Icon className={cn("h-3.5 w-3.5 shrink-0", (checking || isBusy) && "animate-spin")} />
          <span className="hidden sm:inline">Sync:</span>
          <span className="truncate max-w-[230px]">{text}</span>
        </button>
      </PopoverTrigger>

      <PopoverContent align="start" className="w-[340px] max-w-[92vw] space-y-2 text-xs">
        <div className="text-sm font-semibold">
          {healthy ? "SharePoint reader is answering" : "SharePoint reader is not answering"}
        </div>

        {healthy ? (
          <p className="text-muted-foreground">
            The service replied at {shortTime((data as any).checkedAt)}. The plan figures on this board
            can be refreshed from SharePoint.
          </p>
        ) : (
          <>
            <p className="text-muted-foreground">{(data as any)?.message}</p>
            <p className="text-muted-foreground">
              While it is down, the workbook can still be brought in by hand: download the
              "Production RAG Performance" file from SharePoint and use the manual import.
            </p>
          </>
        )}

        {isAdmin && (data as any)?.base && (
          <p className="break-all text-muted-foreground">
            Configured address: <span className="font-mono">{(data as any).base}</span>
          </p>
        )}

        <div className="flex flex-wrap gap-2 pt-1">
          <Button size="sm" variant="outline" className="h-8" onClick={() => void refetch()}>
            Check again
          </Button>
          {!healthy && onOpenManualImport && (
            <Button size="sm" className="h-8" onClick={onOpenManualImport}>
              <FileSpreadsheet className="mr-1 h-3.5 w-3.5" />Import file by hand
            </Button>
          )}
          {isAdmin && onOpenSettings && (
            <Button size="sm" variant="outline" className="h-8" onClick={onOpenSettings}>
              <Settings2 className="mr-1 h-3.5 w-3.5" />Service address
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
