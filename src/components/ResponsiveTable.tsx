import { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Responsive table → cards helper.
 *
 * On md+ screens renders the passed `table` node (typically a shadcn <Table>).
 * On smaller screens renders `cards` — a vertical stack of `TableCard`s,
 * each exposing its fields as "Label: value" rows. Keeps existing tables
 * usable on phones without horizontal scroll gymnastics or letter-per-line
 * wrapping.
 *
 * Presentational only — no data, no permissions.
 */
export function ResponsiveTable({
  table,
  cards,
  breakpoint = "md",
  className,
  cardsClassName,
}: {
  table: ReactNode;
  cards: ReactNode;
  /** Tailwind breakpoint at which we switch from cards → table. */
  breakpoint?: "sm" | "md" | "lg";
  className?: string;
  cardsClassName?: string;
}) {
  const hidden =
    breakpoint === "sm"
      ? "hidden sm:block"
      : breakpoint === "lg"
        ? "hidden lg:block"
        : "hidden md:block";
  const shown =
    breakpoint === "sm"
      ? "sm:hidden"
      : breakpoint === "lg"
        ? "lg:hidden"
        : "md:hidden";
  return (
    <div className={className}>
      <div className={hidden}>{table}</div>
      <div className={cn(shown, "space-y-2", cardsClassName)}>{cards}</div>
    </div>
  );
}

interface TableCardProps {
  children: ReactNode;
  onClick?: () => void;
  className?: string;
  title?: ReactNode;
  right?: ReactNode;
}

/**
 * Card wrapper for a single row in the mobile view. Optional `title`/`right`
 * render a header strip. Clickable when `onClick` is provided.
 */
export function TableCard({ children, onClick, className, title, right }: TableCardProps) {
  const clickable = !!onClick;
  return (
    <div
      className={cn(
        "rounded-md border bg-card p-3 space-y-1.5 shadow-sm",
        clickable && "cursor-pointer active:scale-[0.99] transition-transform hover:bg-muted/40",
        className,
      )}
      onClick={onClick}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick?.();
              }
            }
          : undefined
      }
    >
      {(title || right) && (
        <div className="flex items-center justify-between gap-2 pb-1.5 border-b">
          <div className="font-semibold text-sm min-w-0 truncate">{title}</div>
          {right && <div className="shrink-0">{right}</div>}
        </div>
      )}
      {children}
    </div>
  );
}

interface TableCardFieldProps {
  label: ReactNode;
  value: ReactNode;
  className?: string;
  /** When true, stacks label above value — useful for long text. */
  block?: boolean;
}

/** "Label: value" row inside a TableCard. */
export function TableCardField({ label, value, className, block }: TableCardFieldProps) {
  if (block) {
    return (
      <div className={cn("space-y-0.5", className)}>
        <div className="text-2xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="text-sm break-words">{value}</div>
      </div>
    );
  }
  return (
    <div className={cn("flex items-start justify-between gap-3", className)}>
      <span className="text-2xs uppercase tracking-wide text-muted-foreground shrink-0 pt-0.5">
        {label}
      </span>
      <span className="text-sm text-right break-words min-w-0 flex-1">{value}</span>
    </div>
  );
}
