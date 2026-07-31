import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { PowerOff, ClipboardList, PenTool, CalendarClock, Users } from "lucide-react";
import { useWorkOrders } from "@/hooks/useWorkOrders";
import { useStoppedLinesCount } from "@/hooks/useStoppedLinesCount";
import { usePmSchedules, pmStatus } from "@/hooks/usePreventiveMaintenance";
import { useAuth } from "@/contexts/AuthContext";
import { useRole } from "@/hooks/useRole";
import { useAttendance, useEmployees, useShiftPatterns, worksOn } from "@/hooks/useWorkforce";
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

  // Headcount only for those who can actually read the tables. Row-level security
  // returns nothing rather than an error to everyone else, and a tile reading "0
  // people" because of a policy is exactly the kind of confident wrong number this
  // strip exists to avoid.
  const { can } = useRole();
  const showPeople = can("workforce.view");
  const { data: employees } = useEmployees();
  const { data: patterns } = useShiftPatterns();
  const today = new Date();
  const { data: attendance } = useAttendance(today.toISOString().slice(0, 10));

  const people = useMemo(() => {
    if (!showPeople) return null;
    const byPattern = new Map((patterns ?? []).map((p) => [p.id, p]));
    const due = (employees ?? []).filter((e) => {
      if (!e.active) return false;
      const pat = e.shift_pattern_id ? byPattern.get(e.shift_pattern_id) : null;
      // No pattern means unrecorded, not off. Counting them as "not due" would
      // shrink the headcount for a reason nobody chose.
      return !pat || worksOn(pat.days, today);
    });
    const byId = new Map((attendance ?? []).map((a) => [a.employee_id, a.status]));
    const away = due.filter((e) => ["absent", "sick"].includes(byId.get(e.id) ?? "")).length;
    return { due: due.length, away };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- today is derived per render on purpose
  }, [showPeople, employees, patterns, attendance]);

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
    <section aria-label="Live status" className={`grid grid-cols-2 gap-3 ${people ? "lg:grid-cols-5" : "lg:grid-cols-4"}`}>
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
      {people && (
        <KpiCard
          label="On shift today"
          value={people.due - people.away}
          sublabel={people.away ? `${people.away} away of ${people.due} due in` : `${people.due} due in, nobody away`}
          icon={<Users className="h-4 w-4" />}
          accent={people.away ? "warning" : "info"}
          onClick={() => navigate("/dashboard/workforce")}
        />
      )}
    </section>
  );
}

export default FactoryStatusStrip;
