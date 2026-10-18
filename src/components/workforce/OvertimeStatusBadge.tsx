import { StatusBadge } from "@/components/ui/StatusBadge";
import { OVERTIME_STATUS } from "@/lib/overtimeStatus";
import type { CalendarStatus } from "@/lib/overtimeCalendar";
import { cn } from "@/lib/utils";

export function OvertimeStatusBadge({ status, className }: { status: CalendarStatus; className?: string }) {
  const look = OVERTIME_STATUS[status];
  const Icon = look.icon;
  return <StatusBadge status={look.badge} size="sm" className={cn("max-w-full", look.surface, className)}
    label={<><Icon className="h-3.5 w-3.5 shrink-0" aria-hidden /><span>{look.label}</span></>} />;
}