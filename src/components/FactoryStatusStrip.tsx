import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { PowerOff, ClipboardList, PenTool, CalendarClock } from "lucide-react";
import { useWorkOrders } from "@/hooks/useWorkOrders";
import { useStoppedLinesCount } from "@/hooks/useStoppedLinesCount";
import { usePmSchedules, pmStatus } from "@/hooks/usePreventiveMaintenance";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import type { Database } from "@/integrations/supabase/types";

type AppRole = Database["public"]["Enums"]["app_role"];

/** Roles that run the factory and are shown this strip. */
const STATUS_ROLES: AppRole[] = ["admin", "manager", "maintenance_manager", "supervisor", "planner"];

/**
 * The four things that need a person right now, at the top of the landing screen.
 *
 * Shared rather than copied so the Dashboard cannot drift from what it showed a
 * moment earlier on another screen — same numbers, same wording, same colours.
 *
 * Renders nothing for roles that do not run the factory.
 */
export function FactoryStatusStrip() {
  const { role } = useAuth();
  const navigate = useNavigate();
  const show = !!role && STATUS_ROLES.includes(role as AppRole);

  const { data: openWOs } = useWorkOrders({ statusIn: show ? ["open"] : undefined });
  const { data: finishedWOs } = useWorkOrders({ statusIn: show ? ["finished"] : undefined });
  const { data: stoppedLines } = useStoppedLinesCount();
  const { data: pmSchedules } = usePmSchedules();

  const pmOverdue = useMemo(
    () => (pmSchedules ?? []).filter((s) => pmStatus(s) === "overdue").length,
    [pmSchedules],
  );
  const notAccepted = useMemo(
    () => (openWOs ?? []).filter((w) => !w.received_at).length,
    [openWOs],
  );

  if (!show) return null;

  const awaiting = finishedWOs?.length ?? 0;

  return (
    <section aria-label="Live status" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatusTile
        label="Lines stopped"
        value={stoppedLines ?? 0}
        hint={stoppedLines ? "Production is down" : "All lines running"}
        icon={<PowerOff className="h-4 w-4" />}
        tone={stoppedLines ? "danger" : "ok"}
        onClick={() => navigate("/dashboard/work-orders?status=open")}
      />
      <StatusTile
        label="Not accepted"
        value={notAccepted}
        hint={notAccepted ? "No engineer has taken these" : "Every order has an owner"}
        icon={<ClipboardList className="h-4 w-4" />}
        tone={notAccepted ? "warning" : "ok"}
        onClick={() => navigate("/dashboard/work-orders?status=open")}
      />
      <StatusTile
        label="Awaiting sign-off"
        value={awaiting}
        hint="Finished, waiting for the maintenance manager"
        icon={<PenTool className="h-4 w-4" />}
        tone={awaiting > 0 ? "info" : "ok"}
        onClick={() => navigate("/dashboard/work-orders?status=finished")}
      />
      <StatusTile
        label="PM overdue"
        value={pmOverdue}
        hint={pmOverdue ? "Past the scheduled date" : "Preventive plan on track"}
        icon={<CalendarClock className="h-4 w-4" />}
        tone={pmOverdue ? "warning" : "ok"}
        onClick={() => navigate("/dashboard/preventive")}
      />
    </section>
  );
}

function StatusTile({
  label, value, hint, icon, tone, onClick,
}: {
  label: string; value: number; hint: string;
  icon: React.ReactNode;
  tone: "ok" | "info" | "warning" | "danger";
  onClick: () => void;
}) {
  // Left-border accent + muted label + large number: the KpiCard shape used across
  // the reports, so the landing screen belongs to the same system.
  const accent: Record<string, string> = {
    ok: "border-l-emerald-500",
    info: "border-l-blue-500",
    warning: "border-l-amber-500",
    danger: "border-l-destructive",
  };
  const valueTone: Record<string, string> = {
    ok: "",
    info: "",
    warning: "text-amber-600 dark:text-amber-400",
    danger: "text-destructive",
  };
  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } }}
      className={cn(
        "cursor-pointer border-l-4 transition-colors hover:bg-muted/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        accent[tone],
      )}
    >
      <CardContent className="pt-4 pb-3">
        <div className="mb-1 flex items-center gap-2 text-muted-foreground">
          {icon}
          <span className="text-xs font-medium">{label}</span>
        </div>
        <p className={cn("text-3xl font-bold leading-tight tabular-nums", value > 0 ? valueTone[tone] : "")}>{value}</p>
        <p className="mt-1 text-[10px] leading-snug text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  );
}

export default FactoryStatusStrip;
