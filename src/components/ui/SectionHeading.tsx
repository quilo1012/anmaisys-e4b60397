import { cn } from "@/lib/utils";

/**
 * Small caps label with a rule running to the edge, used to separate the sections
 * of a landing page. Shared so the Dashboard and the welcome screen label their
 * groups identically instead of drifting apart.
 */
export function SectionHeading({
  children,
  aside,
  className,
}: {
  children: React.ReactNode;
  /** Optional control on the right — a filter that governs this section only. */
  aside?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{children}</h2>
      <div className="h-px flex-1 bg-border" />
      {aside}
    </div>
  );
}

export default SectionHeading;
