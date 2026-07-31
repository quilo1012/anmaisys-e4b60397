import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { PowerOff, ClipboardList, PenTool, CalendarClock } from "lucide-react";
import { useWorkOrders } from "@/hooks/useWorkOrders";
import { useStoppedLinesCount } from "@/hooks/useStoppedLinesCount";
import { usePmSchedules, pmStatus } from "@/hooks/usePreventiveMaintenance";
import { useAuth } from "@/contexts/AuthContext";
import { KpiCard } from "@/components/reports/KpiCard";
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


  // Headcount deliberately NOT here. It lives on its own screen while the module is
  // still being built: a half-finished number on the landing strip is read as fact by
  // everyone who passes it, and this one moves every time attendance is edited.
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
      <KpiCard
        label="Lines stopped"
        value={stoppedLines ?? 0}
        sublabel={stoppedLines ? "Production is down" : "All lines running"}
        icon={<PowerOff className="h-4 w-4" />}
        accent={stoppedLines ? "danger" : "ok"}
        toneValue
        onClick={() => navigate("/dashboard/work-orders?status=open")}
      />
      <KpiCard
        label="Not accepted"
        value={notAccepted}
        sublabel={notAccepted ? "No engineer has taken these" : "Every order has an owner"}
        icon={<ClipboardList className="h-4 w-4" />}
        accent={notAccepted ? "warning" : "ok"}
        toneValue
        onClick={() => navigate("/dashboard/work-orders?status=open")}
      />
      <KpiCard
        label="Awaiting sign-off"
        value={awaiting}
        sublabel="Finished, waiting for the maintenance manager"
        icon={<PenTool className="h-4 w-4" />}
        accent={awaiting > 0 ? "info" : "ok"}
        toneValue
        onClick={() => navigate("/dashboard/work-orders?status=finished")}
      />
      <KpiCard
        label="PM overdue"
        value={pmOverdue}
        sublabel={pmOverdue ? "Past the scheduled date" : "Preventive plan on track"}
        icon={<CalendarClock className="h-4 w-4" />}
        accent={pmOverdue ? "warning" : "ok"}
        toneValue
        onClick={() => navigate("/dashboard/preventive")}
      />
    </section>
  );
}

export default FactoryStatusStrip;
