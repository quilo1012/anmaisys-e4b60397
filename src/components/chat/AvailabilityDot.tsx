import { Check, Clock, Minus, Plane } from "lucide-react";
import { cn } from "@/lib/utils";
import { AVAILABILITY_LABEL, type AvailabilityStatus } from "@/lib/communicationPresence";

const LOOK: Record<AvailabilityStatus, { fill: string; Icon: typeof Check | null }> = {
  online: { fill: "bg-success text-success-foreground", Icon: Check },
  busy: { fill: "bg-destructive text-destructive-foreground", Icon: null },
  do_not_disturb: { fill: "bg-destructive text-destructive-foreground", Icon: Minus },
  away: { fill: "bg-warning text-warning-foreground", Icon: Clock },
  offline: { fill: "border-2 border-muted-foreground bg-background text-muted-foreground", Icon: null },
  on_holiday: { fill: "bg-primary text-primary-foreground", Icon: Plane },
};

const SIZE = { sm: "h-3 w-3", md: "h-4 w-4" } as const;
const ICON = { sm: "h-2 w-2", md: "h-2.5 w-2.5" } as const;

/**
 * The status as a small dot. Colour is never the only signal: each status has its own
 * mark (a tick, a bar, a clock, a plane, a hollow ring, a solid disc), so it still reads
 * to someone who cannot tell red from green, on paper and in greyscale. The words are on
 * the element for screen readers and for the tooltip.
 */
export function AvailabilityDot({ status, size = "sm", className }: {
  status: AvailabilityStatus; size?: keyof typeof SIZE; className?: string;
}) {
  const { fill, Icon } = LOOK[status];
  const label = AVAILABILITY_LABEL[status];
  return (
    <span
      role="img" aria-label={label} title={label} data-availability={status}
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full", SIZE[size], fill, className)}
    >
      {Icon && <Icon className={ICON[size]} strokeWidth={3.5} aria-hidden />}
    </span>
  );
}

/** Dot and words together, where there is room for both. */
export function AvailabilityLabel({ status, className }: { status: AvailabilityStatus; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs text-muted-foreground", className)}>
      <AvailabilityDot status={status} />
      {AVAILABILITY_LABEL[status]}
    </span>
  );
}
