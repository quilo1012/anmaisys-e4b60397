import { cn } from "@/lib/utils";

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
  title, description, module = "Workforce", children, className,
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
  /** Controls belonging to this screen — a period picker, Export, Print. */
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "rounded-xl bg-[hsl(var(--section))] p-4 text-white shadow-sm",
        // Ink on paper: the navy would print as a solid block and the page is meant to
        // be handed to somebody.
        "print:bg-white print:p-0 print:text-black print:shadow-none",
        className,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="font-display text-2xs font-semibold uppercase tracking-[0.18em] text-white/60 print:text-black/50">
            {module}
          </div>
          <h1 className="truncate font-display text-xl font-bold tracking-tight">{title}</h1>
          {description && (
            <p className="text-xs text-white/70 print:text-black/70">{description}</p>
          )}
        </div>
        {children && (
          <div className="flex flex-wrap items-center gap-2">{children}</div>
        )}
      </div>
    </header>
  );
}
