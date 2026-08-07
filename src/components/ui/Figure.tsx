import { cn } from "@/lib/utils";

/**
 * A number a screen is answerable for.
 *
 * Lives in `ui/` because it is not a workforce idea. The app had EIGHT components for
 * "a label and a number" — three of them called `Kpi`, in three files, with three
 * different prop shapes, and two called `Figure`. Two different things under one name
 * is a trap for whoever edits next.
 *
 * Every workforce screen opens with a row of identical grey boxes, and the box holding
 * "People: 176" looks exactly like the box holding "Gap to settle: 191.55 h". One is
 * context and the other is two hundred hours nobody has reconciled. A reader scanning
 * the row has no way to tell which is which, so they read all five or none.
 *
 * Two things fix that, and they are the only two.
 *
 * THE LEAD FIGURE. One number per screen is the screen's answer — what it is for. It
 * is set larger and darker, and the rest sit beside it at reduced weight as its
 * supporting cast. A row of equals has no answer in it.
 *
 * THE LEDGER RULE. Nearly every figure here is signed, and the sign is the whole point:
 * an hour bank runs above or below zero, hours are earned or owed, shifts are over or
 * short. `financeClose` spends four paragraphs on the difference. So the rule is
 * structural rather than decorative — an earned figure STANDS ON a line, an owed figure
 * HANGS FROM one. The position of the rule is the sign, read before the digits are.
 *
 * Colour still carries it too, for anyone who does not catch the rule and for the
 * eight per cent of men who would not see the difference between the greens and ambers
 * at all.
 */

export type FigureTone = "neutral" | "earned" | "owed";

export function Figure({
  label, value, unit, tone = "neutral", lead = false, hint, bare = false, className,
}: {
  label: string;
  /** Already formatted. This decides nothing about rounding — the caller knows. */
  value: string;
  /** "h", "days", "people". Set apart from the figure so the number reads alone. */
  unit?: string;
  tone?: FigureTone;
  /** The screen's answer. One per screen, or the idea stops working. */
  lead?: boolean;
  hint?: string;
  /**
   * No card around it. For figures already inside a card — a row of four inside one
   * panel is one object, and giving each its own border makes four.
   */
  bare?: boolean;
  className?: string;
}) {
  return (
    <div
      // The lead is bigger and it is first. It also had a tinted ground and a coloured
      // border, which is one idea said three times and reads as a highlighted card
      // rather than an answer. Size and position carry it; the ledger rule stays the
      // only colour in the row, so it is the thing the eye finds.
      className={cn(bare ? "min-w-0" : "rounded-xl border bg-card p-3", className)}
    >
      <div className="truncate text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </div>

      {/* The rule goes above an owed figure and below an earned one, so the sign is
          legible as a position before the digits are read at all. */}
      <div
        // Three pixels, not two. These screens are read on a tablet on the floor, at
        // arm's length and often in daylight strong enough to wash a hairline out — the
        // same reason the tab strip is 36px and the whole pill is the target. Two
        // pixels is right for a desk and disappears standing up.
        className={cn(
          "mt-1 inline-flex flex-col",
          tone === "owed" && "border-t-[3px] border-[hsl(var(--warning-strong))] pt-0.5",
          tone === "earned" && "border-b-[3px] border-[hsl(var(--success-strong))] pb-0.5",
        )}
      >
        <span className="flex items-baseline gap-1">
          <span
            className={cn(
              // Plex Mono, not Inter: these come off clocks and machines, and a figure
              // that reads like the label beside it is a figure nobody checks twice.
              "font-figure font-semibold tabular-nums leading-none tracking-tight",
              lead ? "text-3xl" : "text-xl",
              tone === "owed" && "text-warning-strong",
              tone === "earned" && "text-success-strong",
            )}
          >
            {value}
          </span>
          {unit && (
            <span className="text-xs font-medium text-muted-foreground">{unit}</span>
          )}
        </span>
      </div>

      {hint && <div className="mt-1 text-2xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

/**
 * The lead figure first, the rest beside it.
 *
 * Flex rather than a fixed column count. A twelve-column grid with the lead at three
 * and the rest at two overflows the moment a screen has six figures — 3 + 5×2 is
 * thirteen — and leaves a hole when it has four. These rows genuinely differ in length:
 * Finance Close has six, Attendance four. Growing from the content cannot be off by
 * one.
 *
 * The lead takes about half again the width of its neighbours. On a phone they stack
 * and the lead is simply first, which is the same claim made by position.
 */
export function FigureRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap [&>*]:min-w-[9rem] [&>*]:flex-1 [&>*:first-child]:sm:flex-[1.6]">
      {children}
    </div>
  );
}
