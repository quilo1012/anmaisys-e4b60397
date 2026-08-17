import { AlertTriangle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useDerivedVolume } from "@/hooks/useDerivedVolume";
import { sourceFor } from "@/lib/derivedVolume";
import { parseNullableNumber } from "@/lib/scorecardNumberInput";
import type { ScorecardEntryDraft } from "@/lib/scorecardEntry";
import type { SetField } from "./types";

// The same downtime vocabulary RecordMissedDowntime.tsx already offers for a line
// stop, reused rather than invented a second time for the same fact.
const DOWNTIME_REASONS = [
  "Mechanical stop", "Electrical stop", "Leak", "Blender fault", "Filler fault",
  "Capper fault", "Labeller issue", "Metal detector", "Waiting for parts",
];

type NumericKey = "planned_volume" | "actual_volume" | "unplanned_downtime_minutes";

const FIELDS: { key: NumericKey; label: string }[] = [
  { key: "planned_volume", label: "Planned volume" },
  { key: "actual_volume", label: "Actual volume" },
  { key: "unplanned_downtime_minutes", label: "Unplanned downtime (minutes)" },
];

/**
 * Volume, offered from what production already recorded for this line and week —
 * never fabricated. `scorecard_derived_volume` can answer three different ways,
 * kept visibly distinct here: a row with real numbers; a row that resolves but
 * has nothing for this line/week (`data === null`, no error); or the lookup
 * itself failing (today's reality — the function does not exist in the database
 * yet). "The lookup failed" and "production has nothing" must never look alike,
 * and neither may ever present as a typed zero.
 *
 * Production's numbers are an offer, not a write: this is a weekly food-safety
 * record under BRC audit, and a row that exists only because somebody opened this
 * drawer is a fact the system manufactured, not one a person confirmed. So a
 * blank field never calls `setField` on its own just because the RPC resolved —
 * it only enters the draft (and therefore, 400ms later, the database) when a
 * person acts: either they type over it themselves, or they press "Use this
 * number" on the offer shown below the field. "The drawer was opened" and "the
 * volume was confirmed" have to stay different facts in the audit trail.
 */
export function VolumePillar({
  lineId, weekEnding, draft, setField,
}: {
  lineId: string;
  weekEnding: string;
  draft: ScorecardEntryDraft;
  setField: SetField;
}) {
  const { data: derived, isLoading, isError, error } = useDerivedVolume(lineId, weekEnding);

  const applyValue = (field: NumericKey, value: number | null) => {
    setField(field, value);
    // volume_source only ever tracks actual_volume: it is the one figure
    // volume_pct is built from downstream. planned_volume and
    // unplanned_downtime_minutes are context for the RAG, not its input, so a
    // hand-typed plan or downtime figure never touches this column.
    if (field === "actual_volume" && derived) {
      setField("volume_source", sourceFor(value, derived.actual_volume));
    }
  };

  const handleChange = (field: NumericKey, raw: string) => {
    applyValue(field, parseNullableNumber(raw));
  };

  const acceptDerived = (field: NumericKey, value: number) => {
    applyValue(field, value);
  };

  const noteFor = (field: NumericKey) => {
    const d = derived;
    if (!d) return null;
    const typed = draft[field];
    const derivedValue = d[field];
    if (derivedValue === null) return null;

    if (typed === null) {
      return (
        <p className="mt-1 flex items-center gap-1.5 text-2xs text-muted-foreground">
          <span>Production recorded {derivedValue}.</span>
          <button
            type="button"
            onClick={() => acceptDerived(field, derivedValue)}
            className="underline underline-offset-2 hover:text-foreground"
          >
            Use this number
          </button>
        </p>
      );
    }

    return (
      <p className="mt-1 text-2xs text-muted-foreground">
        {typed === derivedValue ? `From ${d.source_label ?? "production"}` : `Changed from ${derivedValue}`}
      </p>
    );
  };

  return (
    <section className="rounded border p-4">
      <h3 className="text-xs uppercase tracking-wide text-muted-foreground">Volume</h3>

      {isError ? (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-destructive-strong">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>
            Could not check what production recorded for this line
            ({error instanceof Error ? error.message : "the lookup failed"}). Enter the numbers by hand.
          </span>
        </p>
      ) : !isLoading && !derived ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Production has nothing recorded for this line this week. Enter the numbers by hand.
        </p>
      ) : null}

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {FIELDS.map(({ key, label }) => (
          <div key={key}>
            <Label htmlFor={`volume-${key}`} className="text-xs">{label}</Label>
            <Input
              id={`volume-${key}`}
              type="number"
              value={draft[key] ?? ""}
              onChange={(e) => handleChange(key, e.target.value)}
              className="mt-1 h-9"
            />
            {noteFor(key)}
          </div>
        ))}
      </div>

      <div className="mt-3">
        <Label htmlFor="volume-downtime-reason" className="text-xs">Downtime reason</Label>
        <Select value={draft.downtime_reason ?? undefined} onValueChange={(v) => setField("downtime_reason", v)}>
          <SelectTrigger id="volume-downtime-reason" className="mt-1 h-9">
            <SelectValue placeholder="Select a reason" />
          </SelectTrigger>
          <SelectContent>
            {DOWNTIME_REASONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
    </section>
  );
}
