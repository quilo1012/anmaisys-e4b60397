import { cn } from "@/lib/utils";
// The plain mark, not public/appliedlogo.jpeg — that one is the "Applied Nutrition
// MAINTENANCE" lockup with the gear and spanners, and has no business on a
// production screen. Same import the print header uses.
import appliedMark from "@/assets/appliedlogo.jpeg";

/**
 * The band at the top of a screen naming which module you are in.
 *
 * NOT `SectionHeading`, which is a small-caps divider between groups WITHIN a page,
 * and not `PageHeader`, which is a plain title row. Three objects, three names — it
 * was called `SectionHeader`, one letter from `SectionHeading`, sitting in the same
 * folder. The app had just been through eight components for "a label and a number",
 * three of them called `Kpi`, and this was the same trap being set again.
 *
 * The board had a navy band; Employee, Annual Leave, Attendance and Finance Close each
 * had a bare `<h1>` on white. Five screens about the same hundred and seventy-six
 * people, reached through the same tabs, behind the same PIN — and two different
 * headers between them, so moving from the board to the close read as leaving the
 * section rather than turning a page.
 *
 * The navy is the board's own, promoted to a token and given to all five. It is the
 * one heavy element on the page, which is what lets everything under it stay quiet.
 *
 * The eyebrow says WORKFORCE on every one of them. Not decoration: it is the answer to
 * "where am I" for somebody who arrived on the Finance Close from a link and has never
 * seen the tabs.
 */
export function ModuleHeader({
  title, description, module = "Workforce", brand = false, compact = false, children, className,
}: {
  title: string;
  description?: string;
  /**
   * The tab set this screen belongs to — the answer to "where am I".
   *
   * Era texto cravado dentro do componente, o que fazia dele um `WorkforceHeader`
   * com nome de primitivo. Custou uma contradição real: o Production Headcount está
   * no grupo Production da barra lateral e a banda dizia-lhe Workforce, por isso o
   * ecrã dava duas respostas diferentes à mesma pergunta.
   *
   * Nomeia o conjunto de separadores em que se pode andar, e não o grupo da barra
   * lateral: é entre separadores que se navega sem sair da página.
   */
  module?: string;
  /**
   * Show the Applied Nutrition mark inside the band.
   *
   * Off by default, and that is the point: on a desktop the sidebar already carries
   * it, and a second one on the same screen is noise. The floor answers overtime from
   * a phone, where the sidebar is a closed drawer and nothing on the page says whose
   * system this is — so the mark rides here, and only below the width where the
   * sidebar appears.
   */
  brand?: boolean;
  /**
   * One row, for a screen whose subject is below the band rather than in it.
   *
   * The board's band was three lines of title (eyebrow, name, description) beside a row
   * of controls, and on a 1366×768 laptop that band, the tabs above it and the shift
   * bar under it pushed Line 1 to the bottom edge of the screen. Compact drops the
   * eyebrow — the Workforce tabs directly above already answer "where am I" — and moves
   * the description into the title's tooltip, so the band is one line of controls tall.
   */
  compact?: boolean;
  /** Controls belonging to this screen — a period picker, Export, Print. */
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "rounded-xl bg-[hsl(var(--section))] text-white shadow-sm",
        compact ? "px-3 py-2 md:px-4" : "p-3 md:p-4",
        // Ink on paper: the navy would print as a solid block and the page is meant to
        // be handed to somebody.
        "print:bg-white print:p-0 print:text-black print:shadow-none",
        className,
      )}
    >
      <div className={cn("flex flex-wrap items-center justify-between", compact ? "gap-x-3 gap-y-2" : "gap-3")}>
        {brand && (
          <div className="hidden md:block lg:hidden">
            <img
              src={appliedMark}
              alt="Applied Nutrition"
              className="h-9 w-auto max-w-28 shrink-0 rounded-md object-contain print:ring-0"
            />
          </div>
        )}
        {compact ? (
          <h1
            className="shrink-0 font-display text-lg font-bold leading-tight tracking-tight"
            title={description}
          >
            {title}
          </h1>
        ) : (
          <div className="min-w-0 flex-1">
            <div className="font-display text-2xs font-semibold uppercase tracking-[0.18em] text-white/60 print:text-black/50">
              {module}
            </div>
            <h1 className="truncate font-display text-xl font-bold tracking-tight">{title}</h1>
            {description && (
              <p className="text-xs text-white/70 print:text-black/70">{description}</p>
            )}
          </div>
        )}
        {children && (
          <div className={cn("flex flex-wrap items-center gap-2", compact && "min-w-0 flex-1 justify-end")}>{children}</div>
        )}
      </div>
    </header>
  );
}
