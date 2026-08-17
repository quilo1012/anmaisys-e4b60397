import { useEffect, useRef } from "react";
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
 * The three fields are pre-filled once, from whatever `scorecard_derived_volume`
 * returns, and only into fields nobody has typed into yet — never overwriting a
 * value already on the draft. This component itself never computes `volume_pct`
 * or a RAG; it only records where `actual_volume` came from, via `sourceFor`, so a
 * hand correction stays visible in the audit instead of looking identical to the
 * derived number.
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
  const prefilledFor = useRef<string | null>(null);

  useEffect(() => {
    const key = `${lineId}:${weekEnding}`;
    if (prefilledFor.current === key) return;
    if (isLoading || !derived) return;
    prefilledFor.current = key;

    for (const { key: field } of FIELDS) {
      const derivedValue = derived[field];
      if (draft[field] === null && derivedValue !== null) {
        setField(field, derivedValue);
      }
    }
    if (draft.actual_volume === null && derived.actual_volume !== null) {
      setField("volume_source", sourceFor(derived.actual_volume, derived.actual_volume));
    }
  }, [derived, isLoading, lineId, weekEnding, draft, setField]);

  const handleChange = (field: NumericKey, raw: string) => {
    const value = parseNullableNumber(raw);
    setField(field, value);
    if (field === "actual_volume" && derived) {
      setField("volume_source", sourceFor(value, derived.actual_volume));
    }
  };

  const noteFor = (field: NumericKey): string | null => {
    const d = derived;
    if (!d) return null;
    const typed = draft[field];
    const derivedValue = d[field];
    if (typed === null || derivedValue === null) return null;
    return typed === derivedValue ? `From ${d.source_label ?? "production"}` : `Changed from ${derivedValue}`;
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
            {noteFor(key) && <p className="mt-1 text-2xs text-muted-foreground">{noteFor(key)}</p>}
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
