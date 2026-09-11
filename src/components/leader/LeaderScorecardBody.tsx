import { Fragment, useMemo, useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Factory, FileWarning, HardHat } from "lucide-react";
import { ReportPrintHeader } from "@/components/reports/ReportPrintHeader";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { Figure } from "@/components/ui/Figure";
import {
  QUALITY_SEVERITIES, severityMeta, DOCUMENTATION_LABEL,
  validationMeta, SAFETY_KINDS, SAFETY_KIND_GROUPS,
  statusMeta, isFinished, actionHeadline, actionDetail, severityPoints,
} from "@/lib/qualityConstants";
import { useProfileNames } from "@/hooks/useProfileNames";
import { displayScore, GATE_CAP } from "@/lib/leaderScore";
import type { ActionCharge, ChargeReason, ScorecardPeriod, ScorecardResult } from "@/lib/leaderScorecard";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { Link } from "react-router-dom";

/**
 * The scorecard itself, with no idea where its rows came from.
 *
 * A manager opens it in a dialog off Production Performance, reading the tables
 * directly; a line leader opens it full-screen on a tablet, their rows arriving
 * through a SECURITY DEFINER function because RLS scopes that session to one line.
 * Both render this, so neither can be shown a different number for the same person.
 */

export const SCORECARD_PRINT_ID = "leader-scorecard-print";

export function periodLabelOf(period: ScorecardPeriod): string {
  return period.from === period.to
    ? format(new Date(`${period.from}T00:00:00`), "dd/MM/yyyy")
    : `${format(new Date(`${period.from}T00:00:00`), "dd/MM/yyyy")} — ${format(new Date(`${period.to}T00:00:00`), "dd/MM/yyyy")}`;
}

export function shiftLabelOf(period: ScorecardPeriod): string {
  return period.shift === "all" ? "All shifts" : period.shift === "DAY" ? "Day (06–18)" : "Night (18–06)";
}

/**
 * Quantities, in one locale.
 *
 * `toLocaleString()` with no argument follows the device, and these tablets are set to
 * Portuguese: 40648 printed as "40.648", directly beside "48.512 planned", on a card
 * whose every other figure is a percentage or a count of days. The dot reads as a
 * decimal point and the output of a shift reads as forty. The rest of the app already
 * pins its locale; this card was the one that did not.
 */
const fmt = (n: number) => n.toLocaleString("en-GB");

/**
 * One action's row: a link when there is somewhere to go, a plain row otherwise.
 *
 * Both spellings carry identical layout classes so the list does not reflow depending
 * on who is reading it. The link keeps the row's own text colours rather than taking
 * the anchor default — forty rows of underlined blue would turn a document into a
 * directory — and announces itself by hover, focus ring and cursor instead.
 *
 * `print:no-underline` because a printed card is handed to the leader on paper, where
 * an underline promises a destination the page cannot offer.
 */
function RowText({ href, label, children }: {
  href?: string;
  label: string;
  children: React.ReactNode;
}) {
  const shared = "min-w-0 grow basis-0 rounded-sm";
  if (!href) return <div className={shared}>{children}</div>;
  return (
    <Link
      to={href}
      aria-label={`Open ${label} in Quality`}
      className={cn(
        shared,
        "block no-underline transition-colors hover:bg-muted/50 focus-visible:outline-none",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset print:hover:bg-transparent",
      )}
    >
      {children}
    </Link>
  );
}

/** A section heading and the hairline that closes it — the card's only structural rule. */
function SectionHead({ id, icon: Icon, children, aside }: {
  id: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  aside?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex items-baseline gap-2 border-b pb-1.5">
      <Icon className="h-4 w-4 shrink-0 self-center text-muted-foreground" />
      <h3 id={id} className="font-display text-xs font-bold uppercase tracking-[0.14em]">
        {children}
      </h3>
      {aside && <span className="text-2xs text-muted-foreground">{aside}</span>}
    </div>
  );
}

/**
 * What happened to people in the period. Three columns, and never a fourth figure
 * summing them.
 *
 * The score is silent about safety until somebody is hurt badly enough to fire the
 * ceiling, so a leader whose team reported nine near misses and ran four toolbox talks
 * has been reading a card that never mentioned safety at all — and so has one with a
 * first aid case. Neither is scored, and neither should be; both belong on the page the
 * leader signs.
 *
 * The columns are `SAFETY_KIND_GROUPS`, printed with the hints it carries, because the
 * grouping is the one thing this band must not let a reader get wrong. First aid and
 * near miss are not degrees of a single event: one is somebody already hurt, the other
 * is the warning that arrived in time. `scorecard_safety_counts` is emphatic that the
 * two are never summed, and a row of six identical tiles is an invitation to sum them.
 *
 * Which is why the ledger rule from `Figure` does the work here. Harm HANGS FROM its
 * rule and signal and prevention STAND ON theirs, so the direction of good is legible
 * as a position before a digit is read, and the same "2" means opposite things in
 * adjacent columns. The empty state carries it further: a group with nothing in it says
 * something different in each column, because a zero does.
 */
function SafetyBand({ safety }: { safety: ScorecardResult["safety"] }) {
  const EMPTY: Record<string, string> = {
    harm: "Nobody was hurt.",
    // The one figure on this card that is bad news for being low. Said here rather than
    // left to the hint, because an empty column is exactly where it will be misread.
    signal: "Nothing reported — which reads as under-reporting, not as a safe line.",
    prevention: "Nothing recorded.",
  };

  return (
    <section aria-labelledby="sc-hs">
      <SectionHead id="sc-hs" icon={HardHat}>Health &amp; Safety</SectionHead>

      {/* Hairlines between the columns, not around them: a border on each would make
          three objects out of one reading, and boxing the groups is the visual form of
          the sum this band exists to prevent. */}
      <div className="grid gap-x-5 gap-y-4 sm:grid-cols-3 sm:divide-x sm:[&>*+*]:pl-5">
        {SAFETY_KIND_GROUPS.map((g) => {
          const kinds = SAFETY_KINDS.filter((k) => k.group === g.group && (safety.byKind[k.value] ?? 0) > 0);
          return (
            <div key={g.group} className="min-w-0">
              <p className="font-display text-2xs font-bold uppercase tracking-[0.14em]">{g.title}</p>
              <p className="mt-0.5 text-2xs leading-snug text-muted-foreground">{g.hint}</p>
              {kinds.length === 0 ? (
                <p className="mt-3 text-xs leading-snug text-muted-foreground">{EMPTY[g.group]}</p>
              ) : (
                <div className="mt-3 space-y-2.5">
                  {kinds.map((k) => (
                    <Figure
                      key={k.value}
                      bare
                      label={k.label}
                      value={fmt(safety.byKind[k.value])}
                      // Taken from the GROUP and never from the kind, so a seventh kind
                      // added to SAFETY_KINDS inherits the reading rather than needing a
                      // decision nobody remembers to come back and make.
                      tone={g.group === "harm" ? "owed" : "earned"}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="mt-4 border-t pt-2.5 text-2xs leading-snug text-muted-foreground">
        Not scored. A lost-time injury or a reportable accident puts a {GATE_CAP}% ceiling on the whole
        card instead — a ceiling only ever lowers a score, so no amount of production buys one back.
        {safety.rejected > 0 && ` ${safety.rejected} occurrence${safety.rejected === 1 ? " was" : "s were"} rejected by Quality and ${safety.rejected === 1 ? "is" : "are"} not counted here.`}
      </p>
    </section>
  );
}

/**
 * What a row cost, when it cost nothing, and why.
 *
 * Zero and "did not count" are different facts and a column printing only a number
 * says the same thing about both. `qualityScore` already distinguishes them in its
 * basis line; these are the same four rules in one word each, so a leader reading the
 * list and a leader reading the score are told the same story.
 */
const NOT_COUNTED: Record<Exclude<ChargeReason, "counted">, string> = {
  // Never "not attributable". A near miss is priced at zero so that reporting a hazard
  // can never cost the person who reported it — calling it unattributable turns that
  // into an argument about blame, which is the behaviour the pricing exists to prevent.
  safety: "not scored",
  rejected: "voided",
  not_theirs: "not theirs",
  // Not free — charged in the other pillar, at the rate the panel above prints.
  documentation: "on docs",
};

/**
 * Every action in the period, as a ledger a person can scan.
 *
 * Three things were wrong with it, and they compounded.
 *
 * It read its state off `closed_at`. That column is NULL on all 135 rows in the base
 * and no path in this repo writes it, so the answer was the same on every row — the 37
 * at `status = 'complete'` were each badged "Open", under a Quality block printing
 * "% closed" off `status`. See `isFinished`.
 *
 * It said everything in chips: severity, verdict and state stacked at the right of each
 * row, three pills of different widths, ragged down forty rows with no column to read.
 * A badge is a good way to say one thing on a row and a bad way to say the same thing
 * on all of them.
 *
 * And it never said what any of it COST. The card exists to explain a number a person
 * is appraised on, and the list of the actions behind that number was silent about the
 * arithmetic: an action worth four points and an action worth nothing looked identical,
 * on a base where 112 of 135 carry no grade at all and therefore charge zero. The
 * figures come from `result.charges` — built in `computeScorecard` from the same three
 * predicates `qualityScore` uses — and never from a sum taken here.
 *
 * So the state is a colour on the left edge and a word in a fixed column; the charge is
 * a figure in a column of its own; and the metadata is one dim line of type. The
 * furniture that is left marks what actually varies.
 */
function ActionsBlock({ actions, charges, actionHref, onGrade }: {
  actions: ScorecardResult["actions"];
  charges: ScorecardResult["charges"];
  actionHref?: (action: ScorecardResult["actions"][number]) => string;
  /**
   * Grade an action from here, when the reader is allowed to.
   *
   * Optional, and absent on purpose for the leader's own copy — the same asymmetry
   * `actionHref` carries, for a stronger reason. The line tablet is signed in as the
   * LINE, not as a person: a grade written from it would be unattributable, and the
   * one field it would change is the field that decides the score of the person
   * holding the tablet. The manager's copy passes this only when the session holds
   * `quality.manage`.
   */
  onGrade?: (action: ScorecardResult["actions"][number], severity: string | null) => Promise<void>;
}) {
  const [filter, setFilter] = useState<"all" | "open" | "complete">("all");
  const [saving, setSaving] = useState<string | null>(null);

  // Unfinished first, then newest first inside each group: the rows that still need
  // somebody are the rows a leader opens this card to find.
  const sorted = useMemo(() => {
    const byDate = (a: ScorecardResult["actions"][number], b: ScorecardResult["actions"][number]) =>
      new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime();
    const open = actions.filter((a) => !isFinished(a)).sort(byDate);
    const complete = actions.filter(isFinished).sort(byDate);
    return { open, complete, all: [...open, ...complete] };
  }, [actions]);

  /**
   * The two sentences the list owes the reader, said once each.
   *
   * "112 of 135 actions carry no severity" was true for months and appeared nowhere:
   * the card deducted zero and looked exactly like a card that had deducted zero
   * because the leader had done nothing wrong. An "Unrated" pill on each row was the
   * old answer and it was noise — the same chip on five rows out of five tells a
   * reader only that the chip exists.
   */
  const totals = useMemo(() => {
    let charged = 0, ungraded = 0, free = 0, ungradedPriced = 0;
    for (const a of actions) {
      const c = charges[a.id];
      charged += c?.charged ?? 0;
      if (c && c.counted && c.charged === 0) free += 1;
      if (!a.severity) {
        ungraded += 1;
        // Counted apart, because the sentence used to weld the two together and the
        // weld was false: it read "3 carry no grade and no priced label" over a set
        // where one of the three was priced at 5 by its labels. `actionPoints` is
        // MAX(labels, grade) — no grade does not mean no charge.
        if ((c?.charged ?? 0) > 0) ungradedPriced += 1;
      }
    }
    return { charged, ungraded, free, ungradedPriced };
  }, [actions, charges]);

  // The filter changes what is DRAWN and never what is counted — the heading, the note
  // beside it and every figure on the card stay on the full set.
  const shown = filter === "open" ? sorted.open : filter === "complete" ? sorted.complete : sorted.all;
  const dividerAfter = filter === "all" && sorted.open.length > 0 && sorted.complete.length > 0
    ? sorted.open.length
    : -1;

  const row = (a: ScorecardResult["actions"][number]) => {
    const st = statusMeta(a.status);
    const sev = a.severity ? severityMeta(a.severity) : null;
    const validation = validationMeta(a.validation_status);
    const charge: ActionCharge = charges[a.id]
      ?? { charged: 0, worth: 0, counted: true, reason: "counted", basis: "unpriced", explanation: "" };
    /**
     * Where the charge came from, when it did not come from the grade.
     *
     * Said only where the row cannot already answer it. A graded action prints its
     * grade one line up, so naming "severity" under the figure would repeat what the
     * eye has just read. The two cases that DO need a word are the ones that look like
     * arithmetic errors: a charge on a row carrying no grade at all, and a frozen
     * figure that today's prices no longer add up to.
     */
    const pricedBy = charge.counted && charge.charged > 0
      ? charge.basis === "labels" ? "labels"
        : charge.basis === "frozen" ? "old scale"
        : null
      : null;
    // Only a verdict that means something. "Open" beside the state word would be the
    // same idea twice in one column, in two vocabularies.
    const showValidation = a.validation_status === "validated" || a.validation_status === "rejected";
    // A safety occurrence is classified, not graded — it scores zero however it is
    // graded — so the grade picker has nothing to offer it. See actionPoints().
    const gradable = onGrade && a.domain !== "safety";

    const labels = (a.labels ?? []).filter(Boolean) as string[];
    // `title`, then `description` — the order `actionHeadline` sets for the whole app,
    // borrowed rather than restated so this card cannot drift from the Quality log it
    // links to. The two rungs below it are this card's own: `error_type` carries 54
    // safetyculture rows that hold nothing else, and the labels are the last thing a
    // row can be named by. Only 2 of 135 reach past all four.
    const primary = actionHeadline(a) ?? ((a.error_type ?? "").trim() || labels.join(" · "));
    // The batch the fault happened to, on the 14 rows that carry both — "Basix Oats
    // Coconut 3Kg / T26244 / 09-2026". `actionDetail` returns null when it would only
    // repeat the line above it.
    const detail = actionHeadline(a) ? actionDetail(a) : null;

    /**
     * The reference, first and in one place.
     *
     * It used to be last, at the end of a dotted list, on the rows that had one at all
     * — and before that it was eight characters of the row's uuid, a reference that
     * identifies the record in no screen, no export and no conversation. A reference
     * read out loud on the floor has to sit where the eye already is.
     *
     * `action_no` is NULL on 115 of the 135 rows and the two absences are different
     * facts. An action typed on the Quality screen may simply never have been given a
     * number. A SafetyCulture action always HAS one — `unique_id`, "A-1042" — and this
     * database does not hold it yet: the importer learned to read the field on 07/09
     * (see safetycultureFieldsArriveWhole.test.ts) and all 66 imported rows are still
     * NULL, including the 36 SafetyCulture has changed since. So the slot names the
     * system the number lives in rather than staying blank, and it fills itself with
     * the real number the day the import brings one — nothing here changes for that.
     */
    const ref = a.action_no ?? (a.source === "safetyculture" ? "SafetyCulture" : null);

    // One line of type, not text with pills in it.
    //
    // The labels drop out when they were what NAMED the row: "Bag Inside blender" as
    // the headline and "Bag Inside blender" again two lines below it is the same fact
    // twice, and the second one reads as a second fact.
    const namedByLabels = primary === labels.join(" · ");
    const meta = [
      format(new Date(a.recorded_at), "dd/MM"),
      a.line,
      a.shift === "DAY" ? "Day" : a.shift === "NIGHT" ? "Night" : a.shift,
      ...(namedByLabels ? [] : labels.slice(0, 3)),
      !namedByLabels && labels.length > 3 ? `+${labels.length - 3}` : null,
    ].filter(Boolean);

    return (
      <div key={a.id} className={cn("flex min-w-0 items-start gap-3 px-3 py-2.5 text-xs border-l-2", st.rule)}>
        <RowText href={actionHref?.(a)} label={a.action_no || primary || "action"}>
          {primary ? (
            <p className="line-clamp-2 text-sm font-medium text-foreground print:line-clamp-none" title={primary}>
              {primary}
            </p>
          ) : (
            <p className="text-sm italic text-muted-foreground">No description recorded</p>
          )}
          {detail && (
            <p className="mt-0.5 truncate text-2xs text-muted-foreground print:whitespace-normal" title={detail}>
              {detail}
            </p>
          )}
          {(ref || meta.length > 0) && (
            <p className="mt-1 text-2xs leading-snug text-muted-foreground">
              {ref && (
                <>
                  {/* A number is set as a figure and in the body ink, because it is read
                      back and typed in somewhere else. The name of the system it lives
                      in is not a reference and must not dress as one. */}
                  <span className={cn(a.action_no ? "font-figure text-foreground" : "italic")}>{ref}</span>
                  {meta.length > 0 && " · "}
                </>
              )}
              {meta.join(" · ")}
            </p>
          )}
        </RowText>

        {/* Fixed width, right-aligned: a column, so state can be read down the list
            rather than found on each row.

            Sentence case, and deliberately NOT the card's tracked-uppercase label
            idiom. That treatment belongs to the section headings, and fourteen rows of
            "TO DO" set in it put heading-weight type on every line of the list —
            shouting the one word that is the same on most rows. */}
        <div className="w-24 shrink-0 text-right sm:w-28">
          <p className={cn("text-2xs font-semibold", st.ink)}>{st.label}</p>

          {gradable ? (
            /* The one field that turns a zero into a real charge, editable where the
               reader is allowed. 112 of 135 actions carry no grade, and until now
               fixing that meant leaving the card, finding the row in the Quality log
               and coming back — so it did not get fixed. The write goes to `severity`
               and to nothing else; `trg_quality_action_freeze_points_upd` re-takes
               `points_at_creation` at the row's own scoring version, which is why the
               charge beside it moves on the next read and why this cannot quietly
               re-price an older period. */
            <Select
              value={a.severity ?? "none"}
              disabled={saving === a.id}
              onValueChange={async (v) => {
                setSaving(a.id);
                try { await onGrade!(a, v === "none" ? null : v); } finally { setSaving(null); }
              }}
            >
              <SelectTrigger
                aria-label={`Grade ${a.action_no || primary || "this action"}`}
                className={cn(
                  "mt-1 h-6 justify-end gap-1 border-none bg-transparent px-1 py-0 text-2xs shadow-none",
                  "hover:bg-muted focus:ring-1 print:hidden",
                  sev ? "text-muted-foreground" : "italic text-muted-foreground/60",
                )}
              >
                {saving === a.id ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  /* The word is written out rather than left to `SelectValue`'s
                     placeholder, which renders nothing at all until Radix has mounted
                     — so the trigger read as a bare chevron with no clue what it did. */
                  <SelectValue>{sev ? sev.label : "Grade"}</SelectValue>
                )}
              </SelectTrigger>
              <SelectContent align="end">
                {/* Ungraded is a real answer and stays reachable — an action priced only
                    by its labels needs no grade. The same option the Quality form offers. */}
                <SelectItem value="none">Not graded</SelectItem>
                {QUALITY_SEVERITIES.map((sv) => (
                  <SelectItem key={sv.value} value={sv.value}>
                    {sv.label} · {severityPoints(sv.value)}p
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}

          {/* Always present, and on paper it is the only spelling — a printed card is
              handed over and signed, where a dropdown is a control nobody can use. */}
          <p className={cn(
            "text-2xs", gradable && "hidden print:block",
            sev ? "text-muted-foreground" : "italic text-muted-foreground/60",
          )}>
            {sev ? sev.label : "Unrated"}
          </p>

          {showValidation && (
            <p className={cn("mt-0.5 text-2xs", a.validation_status === "rejected" ? "text-muted-foreground" : "text-foreground")}>
              {validation.label}
            </p>
          )}
        </div>

        {/* What it cost. The column the card existed without. */}
        <div className="w-14 shrink-0 text-right">
          {charge.counted ? (
            <>
              <p
                title={charge.explanation || undefined}
                className={cn(
                  "font-figure text-sm leading-none",
                  charge.charged > 0 ? "font-semibold text-foreground" : "text-muted-foreground/60",
                )}
              >
                {charge.charged}<span className="text-2xs font-normal">p</span>
              </p>
              {pricedBy && (
                <p className="mt-0.5 text-2xs leading-tight text-muted-foreground">{pricedBy}</p>
              )}
            </>
          ) : (
            <>
              <p className="font-figure text-sm leading-none text-muted-foreground/50">—</p>
              <p className="mt-0.5 text-2xs leading-tight text-muted-foreground">
                {NOT_COUNTED[charge.reason as Exclude<ChargeReason, "counted">]}
              </p>
            </>
          )}
        </div>
      </div>
    );
  };

  return (
    <section aria-labelledby="sc-actions">
      <SectionHead
        id="sc-actions"
        icon={AlertTriangle}
        aside={`· ${totals.charged} point${totals.charged === 1 ? "" : "s"} charged`}
      >
        Actions in this period ({actions.length})
      </SectionHead>

      {/* The sentence the card owed and never said. A period can deduct nothing because
          the leader did nothing wrong, or because nobody graded any of it, and the two
          were indistinguishable on the page — 112 of the 135 actions in the base carry
          no grade. Said once, in words, rather than as a pill repeated on every row. */}
      {(totals.free > 0 || totals.ungraded > 0) && (
        <p className="mb-2 text-2xs leading-snug text-muted-foreground">
          {totals.free > 0 && (
            <>{totals.free} of {actions.length} action{actions.length === 1 ? "" : "s"} charged nothing. </>
          )}
          {totals.ungraded > 0 && (
            <>
              {totals.ungraded} carr{totals.ungraded === 1 ? "ies" : "y"} no grade
              {totals.ungradedPriced > 0
                ? <>, and {totals.ungradedPriced === totals.ungraded
                    ? totals.ungraded === 1 ? "it is" : "they are"
                    : `${totals.ungradedPriced} of ${totals.ungraded === 1 ? "it" : "those"} ${totals.ungradedPriced === 1 ? "is" : "are"}`} priced by {totals.ungradedPriced === 1 ? "its" : "their"} labels anyway.</>
                : " and no priced label."}
            </>
          )}
          {onGrade && " Grading one here re-prices it against this period's ruler."}
        </p>
      )}

      {actions.length > 6 && (
        <div className="mb-2 flex gap-1 print:hidden" role="group" aria-label="Filter actions">
          {([["all", `All ${actions.length}`], ["open", `Open ${sorted.open.length}`], ["complete", `Complete ${sorted.complete.length}`]] as const).map(([v, label]) => (
            <button
              key={v}
              type="button"
              onClick={() => setFilter(v)}
              aria-pressed={filter === v}
              className={cn(
                "rounded-md border px-2.5 py-1 text-2xs font-medium transition-colors",
                filter === v ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/50",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      <div className="max-h-[26rem] overflow-y-auto rounded-md border print:max-h-none print:overflow-visible">
        {/* The header names the three columns the rows are actually built on. It said
            "Action / Status" over rows that had no column at all. */}
        <div className="hidden border-b bg-muted/30 px-3 py-1.5 text-2xs uppercase tracking-wide text-muted-foreground sm:flex print:hidden">
          <span className="grow basis-0">Action</span>
          <span className="w-24 shrink-0 text-right sm:w-28">{onGrade ? "State · grade" : "State"}</span>
          <span className="w-14 shrink-0 pl-3 text-right">Charge</span>
        </div>
        <div className="divide-y">
          {shown.map((a, i) => (
            <Fragment key={a.id}>
              {i === dividerAfter && (
                <div className="bg-muted/40 px-3 py-1 text-2xs uppercase tracking-wide text-muted-foreground">
                  Completed in this period
                </div>
              )}
              {row(a)}
            </Fragment>
          ))}
        </div>
      </div>
    </section>
  );
}


export function LeaderScorecardBody({ leaderName, period, result, actionHref, onGrade }: {
  leaderName: string | null;
  period: ScorecardPeriod;
  result: ScorecardResult;
  /**
   * Where an action row leads, when the reader is allowed to follow it.
   *
   * Optional, and absent on purpose for the leader's own copy: a line tablet is
   * RLS-scoped to one line and its user has no Quality permission, so a link into
   * /dashboard/quality would be a promise the session cannot keep. The manager's copy
   * passes one; the tablet gets the same rows as plain text.
   */
  actionHref?: (action: ScorecardResult["actions"][number]) => string;
  /**
   * Grade an action from the list, when the session may.
   *
   * Absent on the leader's own copy for the same reason `actionHref` is, only more
   * so: the tablet is signed in as the line rather than as a person, so a grade
   * written there is unattributable — and the field it changes is the one that
   * decides the score of whoever is holding it.
   */
  onGrade?: (action: ScorecardResult["actions"][number], severity: string | null) => Promise<void>;
}) {
  const { quality: q, docs, safety, production: p, score, actions, woRequests, woStopped } = result;

  /**
   * The three parts of the score, and what each is worth.
   *
   * A component with no data is dropped rather than drawn empty: computeScorecard
   * leaves it out and shares its weight between the others, so a segment sitting at
   * zero would claim a failure where there was only nothing to measure.
   */
  const parts = ([
    ["Production", score.production, score.applied.production_pct],
    ["Quality", score.quality, score.applied.quality_pct],
    ["Documentation", score.documentation, score.applied.documentation_pct],
  ] as const).filter(([, c, w]) => c.value !== null && w > 0);

  /**
   * Documentation is unscored because nobody has RULED on its actions, not because
   * there are none.
   *
   * The two are different facts and the card had one sentence for both. "There was
   * nothing to measure it on" is exactly right for a period with no production target;
   * printed over two open paperwork actions it tells the leader they made no paperwork
   * errors, which is the opposite of what the null means. It also ran directly against
   * the note beside it, which was at the same moment offering a −2% discount on the
   * pillar it had just said was not counted.
   *
   * So this case leaves the generic list and gets its own sentence below.
   */
  const docsAwaitingVerdict = score.documentation.value === null && docs.pending.length > 0;

  /**
   * The period raised quality actions and not one of them carries the label this block
   * scores on.
   *
   * The demerit is scoped to ONE label — `DOCUMENTATION_LABEL`, "Paperwork" — and that
   * is a deliberate, documented decision. What was not deliberate is the green box
   * printing "No penalty · 100% compliant" on top of it. Measured on 09/09/2026: zero
   * of the 135 actions in the base carry the label, while nine name a paperwork
   * failure in their own `error_type` — Missing signature or time, Check not recorded,
   * Missing check on spec, Incomplete checklist. So the card was reading "no action
   * was labelled" and printing "the leader made no paperwork errors".
   *
   * The score does not move. The claim does: a block that judged nothing must not
   * publish a compliance figure, which is exactly what the warning box directly above
   * this one already exists to stop.
   */
  const docsNeverLabelled =
    docs.penalised.length === 0 && docs.pending.length === 0 && docs.rejected.length === 0 &&
    actions.some((a) => a.domain !== "safety");

  /**
   * The pillar is unscored because nothing in the period carries the label it scores
   * on. Different fact again from "awaiting a verdict", and different from the generic
   * "there was nothing to measure it on" the dropped list prints.
   */
  const docsNothingJudged =
    score.documentation.value === null && docs.pending.length === 0;

  const dropped = ([
    ["Production", score.production], ["Quality", score.quality], ["Documentation", score.documentation],
  ] as const)
    .filter(([label, c]) => c.value === null
      && !(label === "Documentation" && (docsAwaitingVerdict || docsNothingJudged)))
    .map(([label]) => label);

  /**
   * Health & Safety in the header: a STATE, never a percentage and never a bar.
   *
   * A gate is a ceiling, not a weight (migration 20260818090000), so drawing it as a
   * block "as wide as it counts for" would be the same kind of lie this panel exists
   * to remove. The word carries the meaning and the colour only seconds it, because
   * the card prints as ink on white.
   */
  const hs: { word: string; caption: string; className: string; printClassName: string } =
    score.cap
      ? { word: "GATED", caption: `limited to ${score.cap.value}%`, className: "text-red-300", printClassName: "print:text-black" }
      : safety.total === 0
        ? { word: "WATCH", caption: "nothing reported", className: "text-amber-200", printClassName: "print:text-black" }
        : { word: "CLEAR", caption: `${safety.total} reported, none gating`, className: "text-emerald-200", printClassName: "print:text-black" };

  const barLabel = `How this score was built. ${parts
    .map(([label, c, w]) => `${label} ${displayScore(c.value)}% of 100, counting ${w}%`)
    .join(". ")}. Health and safety ${hs.word}: ${hs.caption}. It limits the score, never counts towards it.`;

  const HSBlock = () => (
    <div className="min-w-0">
      <span className="block truncate font-display text-[10px] font-bold uppercase tracking-[0.08em] text-white/60 print:text-black/50">
        <span className="sm:hidden">H&amp;S</span>
        <span className="hidden sm:inline">Health &amp; Safety</span>
      </span>

      <p className={`mt-1.5 font-figure text-base font-semibold leading-none sm:text-lg ${hs.className} ${hs.printClassName}`}>
        {hs.word}
      </p>
      <p className="mt-1 truncate font-figure text-2xs text-white/50 print:text-black/50">{hs.caption}</p>
      <p className="mt-0.5 truncate font-figure text-2xs text-white/40 print:text-black/40">limits, never counts</p>
    </div>
  );


  // Who signed each verdict — "Attributable", the first letter of ALCOA+.
  const { data: profileNames = [] } = useProfileNames();
  const nameOf = useMemo(() => {
    const m = new Map(profileNames.map((pn) => [pn.id, pn.name]));
    return (id: string | null) => (id ? m.get(id) ?? "—" : "—");
  }, [profileNames]);

  return (
    <div id={SCORECARD_PRINT_ID} className="space-y-5 print-content [&>div]:break-inside-avoid">
      <ReportPrintHeader
        title={`Leader Scorecard — ${leaderName ?? ""}`}
        periodLabel={periodLabelOf(period)}
        shift={shiftLabelOf(period)}
      />

      {/* The score, and the arithmetic behind it, as one object.

          This was a number beside three equal bordered boxes, one of which carried the
          words "weight 40%". Equal boxes claim the parts are equal; they are 40/30/30.
          Here each part is given the WIDTH it actually counts for and filled to what it
          scored, so 83/100/100 → 93 can be read off the shape before a digit is. The
          leader this card is about has to be able to check it, which is why none of it
          hides behind a tooltip.

          Navy on the brand's --section, the same panel ModuleHeader uses, so the one
          number the screen exists for is the one thing that is not a white card. It
          goes back to ink on paper for print — the page is meant to be handed over. */}
      {/* The ceiling, at the very top, before the number it limits.

          It used to sit BELOW the bars, in amber, at the foot of a panel people stop
          reading once they have the figure. That put the single most consequential
          sentence on the card in the position reserved for footnotes: a leader could
          take 49% away with them and never learn that it was a ceiling rather than a
          score, which is the one misreading this document cannot afford — it is the
          difference between "you performed badly" and "a food safety event happened on
          your line".

          Red and full width, above everything, so it is read before the figure and not
          after it. Never `print:hidden`: this card is printed and signed, and a printed
          49% with no ceiling on it is a document that says the wrong thing.

          Shown whether or not the ceiling BIT. A gate that fired on a week already
          below 49 changed no arithmetic, but it is still the fact of the period, and
          the wording below says exactly which of the two happened rather than claiming
          work the ceiling did not do. */}
      {score.cap && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-xl border-2 border-destructive/60 bg-destructive/10 p-4 print:rounded-none print:border print:border-black print:bg-white"
        >
          <AlertTriangle aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-destructive-strong print:text-black" />
          <div className="min-w-0 space-y-1.5">
            <p className="font-display text-2xs font-bold uppercase tracking-[0.14em] text-destructive-strong print:text-black">
              Score ceiling — {score.cap.named}
            </p>
            {score.cap.applied ? (
              <p className="text-xs leading-snug text-foreground print:text-black">
                This score is limited to {score.cap.value}% because a food safety gate fired in
                this period. A gate is a ceiling, never a weight — it records that the event
                happened on this line, in this period, whoever was at fault. No production can
                buy it back.
              </p>
            ) : (
              <p className="text-xs leading-snug text-foreground print:text-black">
                A food safety gate fired in this period, which limits a score to {score.cap.value}%.
                This period already scored below that, so the ceiling changed nothing — the
                occurrence still stands on the record. A gate is a ceiling, never a weight, and it
                records that the event happened on this line, in this period, whoever was at fault.
              </p>
            )}
          </div>
        </div>
      )}

      <div
        role="region"
        aria-label="Final score"
        className="rounded-xl bg-[hsl(var(--section))] p-4 text-white shadow-sm sm:p-5 print:rounded-none print:border print:bg-white print:p-0 print:text-black print:shadow-none"
      >
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:gap-7">
          <div className="shrink-0">
            <p className="font-display text-2xs font-bold uppercase leading-none tracking-[0.18em] text-white/60 print:text-black/50">
              Final score
            </p>
            <p className="mt-2 font-figure text-6xl font-semibold leading-none tracking-[-0.03em] sm:text-7xl">
              {score.final === null ? "—" : displayScore(score.final)}
              {score.final !== null && <span className="align-top text-2xl font-medium text-white/50 sm:text-3xl print:text-black/40">%</span>}
            </p>
            {/* The subtraction, beside the number it produced. A leader shown 49 with
                no sight of the 97 it was cut from cannot check the arithmetic, and this
                is the line they will argue with hardest — so it is next to the figure,
                not three paragraphs below it. Only when the ceiling actually bit. */}
            {score.cap?.applied && score.cap.weighted !== null && (
              <p className="mt-2 flex items-baseline gap-1.5 text-sm">
                <span className="font-figure line-through decoration-2 text-white/55 print:text-black/50">
                  {displayScore(score.cap.weighted)}%
                </span>
                <span aria-hidden className="text-white/55 print:text-black/50">→</span>
                <span className="font-figure font-semibold text-white print:text-black">{score.cap.value}%</span>
                <span className="rounded border border-white/30 px-1 py-px font-display text-2xs font-bold uppercase tracking-wide text-white/80 print:border-black/40 print:text-black">
                  Gated
                </span>
              </p>
            )}
          </div>

          {/* Width = what it counts for. Fill = what it scored.

              `grow basis-0` rather than `flex-1`, which is the same thing in the
              browser and not on paper: index.css prints with
              `.print-content [class*="flex"] { display: flex !important }`, and that
              substring catches `flex-1` too. This column became a flex ROW on the
              printed page, and the caption below the bars was laid out beside them,
              on top of the Documentation label. */}
          <div className="min-w-0 grow basis-0">
            <div role="img" aria-label={barLabel} className="flex flex-wrap items-end gap-x-1.5 gap-y-3">
              {parts.map(([label, c, w]) => (
                <div key={label} role="presentation" style={{ flexGrow: w }} className="min-w-0 basis-0">
                  {/* "Documentation" needs 99px and the narrow segment offers about 94
                      at 390px, so it clipped to "DOCUMENTATI…". The word is shortened
                      rather than the type, and only where the room runs out. */}
                  <span className="block truncate font-display text-[10px] font-bold uppercase tracking-[0.08em] text-white/60 print:text-black/50">
                    <span className="sm:hidden">{label === "Documentation" ? "Docs" : label}</span>
                    <span className="hidden sm:inline">{label}</span>
                  </span>
                  <div className="mt-1.5 h-3 overflow-hidden rounded-sm bg-white/15 print:border print:border-black/30 print:bg-white">
                    <div
                      className="h-full rounded-sm bg-white/90 print:bg-black/75"
                      style={{ width: `${Math.max(0, Math.min(100, c.value ?? 0))}%` }}
                    />
                  </div>
                  <p className="mt-1.5 font-figure text-base font-semibold leading-none sm:text-lg">
                    {displayScore(c.value)}%
                  </p>
                  {/* "of 40%" beside "85%" read as 85% OF 40%, which is 34 — the one
                      arithmetic this panel exists to make unambiguous. */}
                  <p className="mt-1 truncate font-figure text-2xs text-white/50 print:text-black/50">
                    counts {w}%
                  </p>
                </div>
              ))}
              {/* No track, no fill, no width claim: it carries no weight. It wraps to
                  full width below the bars where the row runs out of room. */}
              <div
                className="w-full min-w-0 border-t border-white/15 pt-2 sm:w-28 sm:shrink-0 sm:grow-0 sm:border-l sm:border-t-0 sm:pl-3 sm:pt-0 print:border-black/20"
              >
                <HSBlock />
              </div>
            </div>
            <p className="mt-3 text-2xs text-white/50 print:text-black/50">
              Each weighted block is as wide as it counts for, and as full as it scored.
              Health &amp; Safety carries no weight — it can only limit the score.
            </p>

          </div>
        </div>

        {/* The ceiling used to be explained here, at the foot of the panel, in amber.
            It is now the red banner at the TOP of the card, above the figure it limits,
            and the subtraction sits beside the number itself. Explaining a ceiling
            below the score it capped is explaining it to someone who has already
            stopped reading. */}

        {/* The period does not sit on one ruler.
            Quieter than the ceiling on purpose: nothing here is wrong, and nothing needs
            fixing. It is a caveat about comparability — the figures inside this period
            were measured under more than one version of the scale — and a leader
            comparing this card to an older one has to know that before they do. Loud
            styling would read as a fault and teach people to dismiss it. */}
        {score.scales && (
          <p className="mt-3 text-2xs leading-snug text-white/55 print:text-black/60">
            {score.scales}
          </p>
        )}

        {/* How each number was arrived at. On the panel rather than under it: the basis
            is the part a leader argues with, and it belongs beside the claim. */}
        <ul className="mt-4 grid gap-1 border-t border-white/15 pt-3 text-2xs text-white/70 sm:grid-cols-3 print:border-black/20 print:text-black/70">
          <li><b className="font-semibold text-white/90 print:text-black">Production</b> · {score.production.basis}</li>
          <li><b className="font-semibold text-white/90 print:text-black">Quality</b> · {score.quality.basis}</li>
          <li><b className="font-semibold text-white/90 print:text-black">Documentation</b> · {score.documentation.basis}</li>
        </ul>
        {docs.pending.length > 0 && (
          <p className="mt-2 text-2xs text-amber-200 print:text-black">
            {docsAwaitingVerdict ? (
              /* The pillar is not being scored. Say that first, say where its weight
                 went, and only then say what a verdict would do — a sentence that opens
                 with "−2% documentation" reads as a penalty already taken. */
              <>
                Documentation is not scored in this period: {docs.pending.length} paperwork
                action{docs.pending.length === 1 ? " is" : "s are"} still awaiting a verdict from Quality, so
                its weight is shared between the blocks above rather than counted as a full mark. {docs.pending.length === 1 ? "It is" : "They are"} charged to
                the quality score while open — a verdict moves the charge here at −{docs.penaltyPct}% each instead,
                and quality gives it back.
              </>
            ) : (
              <>
                {docs.pending.length} paperwork action{docs.pending.length === 1 ? "" : "s"} awaiting a verdict from
                Quality — counted in the quality score while open. Validating {docs.pending.length === 1 ? "it" : "them"} moves
                the charge here instead of adding to it: −{docs.penaltyPct}% documentation, and the quality score gives it back.
              </>
            )}
          </p>
        )}
        {docsNothingJudged && (
          <p className="mt-2 text-2xs text-amber-200 print:text-black">
            Documentation is not scored in this period: no action carries the Paperwork label, so nothing
            was judged. Its weight is shared between the blocks above rather than counted as a full mark.
          </p>
        )}

        {dropped.length > 0 && (
          <p className="mt-2 text-2xs text-amber-200 print:text-black">
            {dropped.join(" and ")} {dropped.length === 1 ? "is" : "are"} not counted in this period — there was
            nothing to measure {dropped.length === 1 ? "it" : "them"} on, so the weight is shared between the rest
            rather than scored as zero.
          </p>
        )}
      </div>

      {/* Quality. The icon was a clock — the section is not about time. */}
      <section aria-labelledby="sc-quality">
        <SectionHead id="sc-quality" icon={AlertTriangle}>Quality</SectionHead>

        {q.total === 0 ? (
          /* A period with no action used to print Total actions 0, Open 0, % closed 0%,
             Avg resolution —, and four severity badges reading 0: nine pieces of
             furniture for one fact, and the fact was the good news. Say it once. */
          <p className="text-sm text-muted-foreground">
            No quality action was raised against this leader in this period.
            {docs.pending.length > 0 && ` ${docs.pending.length} raised elsewhere is still under review.`}
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Figure label="Total actions" value={fmt(q.total)} />
              <Figure label="Open" value={fmt(q.open)} tone={q.open > 0 ? "owed" : "neutral"} />
              {/* Earned only at a hundred. It carried the earned tone unconditionally,
                  so a leader who had closed none of four was shown a green 0% standing
                  on the rule that means "earned" on every other screen here. */}
              <Figure
                label="% closed"
                value={`${q.pctClosed}%`}
                tone={q.pctClosed === 100 ? "earned" : "neutral"}
                hint={`${fmt(q.completed)} of ${fmt(q.total)} completed`}
              />
              <Figure
                label="Avg resolution"
                value={q.avgResolution == null ? "—" : `${q.avgResolution.toFixed(1)}d`}
                hint="created → complete"
              />
            </div>
            {/* Only the severities actually present. A row of four zeros is four
                claims that nothing happened, said in the colours of alarm. */}
            <div className="mt-2 flex flex-wrap gap-1.5">
              {QUALITY_SEVERITIES.slice().reverse()
                .filter((s) => (q.sev[s.value] ?? 0) > 0)
                .map((s) => (
                  <Badge key={s.value} variant="outline" className={cn("text-2xs", severityMeta(s.value)?.badge)}>
                    {s.label}: {q.sev[s.value]}
                  </Badge>
                ))}
            </div>
          </>
        )}
      </section>

      {/* Every action in the period, whatever its state. A closed action is still part
          of the leader's history — filing it away must not remove it from the record
          anyone reviews.

          A row is a link where the reader may follow it. The score says a leader lost
          points; the evidence, the history and the name of whoever validated it all
          live on the other end, and a figure nobody can audit back to its record is the
          thing this module exists to stop being. */}
      {actions.length > 0 && (
        <ActionsBlock actions={actions} charges={result.charges} actionHref={actionHref} onGrade={onGrade} />
      )}

      {/* The two quality asides, side by side where there is room. Stacked full-width
          they left a desktop reading as two half-empty bands; print stays one column,
          which is the layout the signed page has always had. */}
      {(q.trend.length > 0 || q.topLabels.length > 0) && (
        <div className="grid gap-5 lg:grid-cols-2 print:block print:space-y-4">
          {/* Hidden in print when there is a single day: a line chart with one dot says
              nothing a table above it has not already said, and it costs a third of the page. */}
          {q.trend.length > 0 && (
            <Card className={q.trend.length < 2 ? "print:hidden" : undefined}>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Actions over time</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={180}>
                  <LineChart data={q.trend} margin={{ top: 4, right: 12, left: -16, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="day" fontSize={11} tickLine={false} />
                    <YAxis allowDecimals={false} fontSize={11} tickLine={false} />
                    <Tooltip contentStyle={{ fontSize: 12 }} />
                    <Line type="monotone" dataKey="count" name="Actions" stroke="hsl(0 72% 51%)" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {q.topLabels.length > 0 && (
            <div>
              <div className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Top labels</div>
              <div className="flex flex-wrap gap-1.5">
                {q.topLabels.map((l) => <Badge key={l.label} variant="secondary" className="text-2xs">{l.label} · {l.count}</Badge>)}
              </div>
            </div>
          )}
        </div>
      )}


      {/* Health & Safety. Counted here, scored nowhere — see SafetyBand.

          Unconditional, and it was `safety.total > 0`. The band carries three empty
          states and the middle one is the whole reason it has them: "Nothing reported —
          which reads as under-reporting, not as a safe line." That sentence could only
          ever appear on a period that had reported SOMETHING, which is precisely the
          period it is not about. A leader signs this page; a page that says nothing
          about safety says the shift was safe, and a shift that reported nothing is
          the one nobody can vouch for. */}
      <SafetyBand safety={safety} />

      {/* Documentation errors — the demerit block. Answers, on its own, the question an
          audit asks: why did this leader lose points, who decided, when, and where is
          the evidence. */}
      <section aria-labelledby="sc-docs">
        <SectionHead id="sc-docs" icon={FileWarning} aside={DOCUMENTATION_LABEL}>
          Documentation errors
        </SectionHead>

        {docs.penalised.length === 0 && docs.pending.length > 0 ? (
          /* A green "100% compliant" over cases nobody has judged yet is the card
             vouching for a record it has not seen, which is why this box exists. What
             it SAID was written before either of the two changes it now has to survive.

             "No penalty yet · nothing is charged" was true when an unjudged paperwork
             error was charged nowhere. Since d107199a it is charged, in the quality
             pillar, and the panel above says so — so the card carried both sentences at
             once. And since the pillar goes unscored while nothing has a verdict, there
             is no penalty here for the reason that there is no score here.

             "A verdict would cost up to −N%" was the worse half, because the sign is
             wrong rather than the number. Measured on two low-severity paperwork actions
             priced at 2%: open scores 98, validated scores 99. Quality gives back more
             than documentation takes, so a verdict RAISES the score — and a leader read
             this box as a reason to leave the paperwork unjudged. */
          <div className="rounded-lg border border-warning/40 bg-warning/5 p-3">
            <p className="text-sm font-semibold text-warning-strong">
              Not scored · {docs.pending.length} under review
            </p>
            <p className="text-2xs text-muted-foreground">
              No {DOCUMENTATION_LABEL.toLowerCase()} action in this period has a verdict, so this block scores
              nothing and its share of the final score is spread across the pillars that could be measured.
              {" "}{docs.pending.length === 1 ? "It is" : "They are"} charged to the quality score meanwhile. A verdict
              moves that charge here at −{docs.penaltyPct}% each rather than adding to it, and quality gives
              back what it was holding — a verdict is a transfer, not a new penalty.
              {docs.rejected.length > 0 && ` ${docs.rejected.length} rejected by Quality.`}
            </p>
          </div>
        ) : docsNeverLabelled ? (
          /* Neutral, not green. Nothing here is wrong and nothing has been cleared
             either, and the colour is the part a reader takes away from a box they do
             not finish. */
          <div className="rounded-lg border bg-muted/30 p-3">
            <p className="text-sm font-semibold">Nothing scored here</p>
            <p className="text-2xs text-muted-foreground">
              This block scores one thing: an action carrying the {DOCUMENTATION_LABEL} label that
              Quality has validated. No action in this period carries that label, so there is nothing
              for it to judge — which is not the same as the paperwork having been checked and found
              right. An action that describes a paperwork failure and was never labelled is counted
              in the quality score above and cannot appear here.
            </p>
          </div>
        ) : docs.penalised.length === 0 ? (
          <div className="rounded-lg border border-success/40 bg-success/5 p-3">
            <p className="text-sm font-semibold text-success-strong">No penalty · 100% compliant</p>
            <p className="text-2xs text-muted-foreground">
              No validated {DOCUMENTATION_LABEL.toLowerCase()} action in this period.
              {docs.rejected.length > 0 && ` ${docs.rejected.length} rejected by Quality.`}
            </p>
          </div>
        ) : (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-destructive/30 p-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Total impact</p>
                <p className="text-2xl font-bold text-destructive-strong tabular-nums">
                  −{docs.impactPct}% <span className="text-sm font-medium">({docs.penalised.length} validated)</span>
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Documentation score</p>
                <p className="text-2xl font-bold tabular-nums">{docs.score}%</p>
              </div>
            </div>

            <ul className="divide-y divide-destructive/20">
              {docs.penalised.map((a) => (
                <li key={a.id} className="p-3 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    {/* The demerit names a number and a penalty; this is the only
                        route from it to the evidence that justified either. */}
                    {actionHref ? (
                      <Link
                        to={actionHref(a)}
                        aria-label={`Open ${a.action_no || "this documentation error"} in Quality`}
                        className="font-mono font-semibold underline decoration-dotted underline-offset-2 hover:decoration-solid print:no-underline"
                      >
                        {a.action_no || `#${a.id.slice(0, 8)}`}
                      </Link>
                    ) : (
                      <span className="font-mono font-semibold">{a.action_no || `#${a.id.slice(0, 8)}`}</span>
                    )}
                    <Badge variant="outline" className={cn("text-2xs", validationMeta(a.validation_status).badge)}>
                      {validationMeta(a.validation_status).label}
                    </Badge>
                    <span className="font-semibold text-destructive-strong">−{docs.penaltyPct}%</span>
                    {(a.attachments?.length ?? 0) > 0 && (
                      <Badge variant="secondary" className="text-2xs">
                        {a.attachments!.length} evidence file{a.attachments!.length === 1 ? "" : "s"}
                      </Badge>
                    )}
                  </div>
                  {a.description && <p className="mt-1">{a.description}</p>}
                  <p className="mt-1 text-2xs text-muted-foreground">
                    {[
                      a.line, a.shift,
                      `raised ${format(new Date(a.recorded_at), "dd/MM/yyyy")}`,
                      a.validated_at ? `validated ${format(new Date(a.validated_at), "dd/MM/yyyy HH:mm")} by ${nameOf(a.validated_by)}` : null,
                    ].filter(Boolean).join(" · ")}
                  </p>
                </li>
              ))}
            </ul>

            {(docs.pending.length > 0 || docs.rejected.length > 0) && (
              <p className="border-t border-destructive/30 p-2 text-2xs text-muted-foreground">
                Not counted: {docs.pending.length} still under review, {docs.rejected.length} rejected by Quality.
              </p>
            )}
          </div>
        )}
      </section>

      {/* Production */}
      <section aria-labelledby="sc-production">
        <SectionHead
          id="sc-production"
          icon={Factory}
          aside={`${fmt(p.sessions)} session${p.sessions === 1 ? "" : "s"}`}
        >
          Production
        </SectionHead>
        {p.sessions === 0 ? (
          <p className="text-xs text-muted-foreground">
            No production sessions for this leader in the period.
            {woRequests.length > 0 && ` ${woRequests.length} work order${woRequests.length === 1 ? "" : "s"} were still raised in their name — listed below.`}
          </p>
        ) : (
          <>
            {/* Three tiles, three columns. A four-column grid left a hole beside
                "Maintenance called" that read as a figure that had failed to load. */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Figure
                label="Attainment"
                value={p.attainment == null ? "n/a" : `${p.attainment}%`}
                hint={p.attainment == null ? "no RAG plan for these sessions" : `${fmt(p.actualQty)} of ${fmt(p.targetQty)} planned`}
              />
              <Figure label="Output" value={fmt(p.output)} hint="logged on My Production" />
              <Figure
                label="Maintenance called"
                value={String(woRequests.length)}
                hint={woRequests.length === 0 ? "no work order raised in this period" : `${woStopped} stopped the line`}
                tone={woStopped > 0 ? "owed" : "neutral"}
              />
            </div>
            {woRequests.length > 0 && (
              <div className="mt-2 space-y-1">
                <div className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Work orders raised by this leader ({woRequests.length})
                </div>
                {woRequests.map((w) => (
                  <div key={w.id} className="flex min-w-0 flex-wrap items-start gap-2 rounded border p-1.5 text-xs break-inside-avoid">
                    <span className="font-mono font-semibold">
                      {w.wo_number ? `WO-${new Date(w.created_at).getFullYear()}-${String(w.wo_number).padStart(6, "0")}` : "—"}
                    </span>
                    <span className="whitespace-nowrap text-muted-foreground">{format(new Date(w.created_at), "dd/MM HH:mm")}</span>
                    {w.line_at_time && <span className="text-muted-foreground">{w.line_at_time}</span>}
                    <Badge variant="outline" className="text-2xs capitalize">{(w.status ?? "—").replace(/_/g, " ")}</Badge>
                    {w.line_stopped && (
                      <Badge variant="outline" className="border-destructive/40 bg-destructive/10 text-2xs text-destructive-strong">
                        Line stopped
                      </Badge>
                    )}
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">{w.description ?? ""}</span>
                  </div>
                ))}
              </div>
            )}
            {p.sessionsWithPlan < p.plannedSessions && (
              <p className="mt-1 text-2xs text-muted-foreground">
                {p.plannedSessions - p.sessionsWithPlan} of {p.plannedSessions} line-shifts have no RAG plan, so they add
                output without adding target — attainment reads higher than it is.
              </p>
            )}
            {/* The same distortion pointing the other way, and the one that costs the
                leader rather than flattering them. Said out loud because a percentage
                nobody can explain is a percentage nobody can argue with. */}
            {p.plannedWithoutOutput > 0 && (
              <p className="mt-1 text-2xs text-warning-strong">
                {p.plannedWithoutOutput} of {p.sessionsWithPlan} planned line-shift
                {p.plannedWithoutOutput === 1 ? "" : "s"} logged no output on My Production, so
                {p.plannedWithoutOutput === 1 ? " it adds" : " they add"} target without adding
                output — attainment reads lower than it is.
              </p>
            )}
          </>
        )}
      </section>
    </div>
  );
}
