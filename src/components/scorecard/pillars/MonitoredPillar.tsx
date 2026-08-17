/**
 * Assiduidade e atrasos: recolhidos, exibidos, agregados — e sem peso nenhum. Se um dia
 * voltarem a pontuar, tem de ser como pilar proprio, com peso explicito. Nao os diluir
 * dentro de Health & Safety: um atraso nao e um acidente.
 */
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { COUNT_INPUT, FRACTION_INPUT, fractionLabel, parseNullableNumber } from "@/lib/scorecardNumberInput";
import type { ScorecardEntryDraft } from "@/lib/scorecardEntry";
import type { SetField } from "./types";

type Key = "leader_attendance_pct" | "team_attendance_pct" | "leader_lateness_incidents" | "team_lateness_incidents";

// The two attendance columns are numeric(5,4) CHECK BETWEEN 0 AND 1 — fractions,
// like the two in Health & Safety, and bounded by the same shared definition
// rather than by a second copy of the rule written here. The two lateness columns
// are counts, CHECK (... >= 0).
const FIELDS: { key: Key; label: string; bounds: { min: number; max?: number; step: number } }[] = [
  { key: "leader_attendance_pct", label: fractionLabel("Leader attendance"), bounds: FRACTION_INPUT },
  { key: "team_attendance_pct", label: fractionLabel("Team attendance"), bounds: FRACTION_INPUT },
  { key: "leader_lateness_incidents", label: "Leader lateness incidents", bounds: COUNT_INPUT },
  { key: "team_lateness_incidents", label: "Team lateness incidents", bounds: COUNT_INPUT },
];

export function MonitoredPillar({
  draft, setField,
}: {
  draft: ScorecardEntryDraft;
  setField: SetField;
}) {
  return (
    <section className="rounded border bg-muted/40 p-4">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Monitored — does not score
      </h3>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {FIELDS.map(({ key, label, bounds }) => (
          <div key={key}>
            <Label htmlFor={`monitored-${key}`} className="text-xs">{label}</Label>
            <Input
              id={`monitored-${key}`}
              type="number"
              min={bounds.min}
              max={bounds.max}
              step={bounds.step}
              value={draft[key] ?? ""}
              onChange={(e) => setField(key, parseNullableNumber(e.target.value))}
              className="mt-1 h-9"
            />
          </div>
        ))}
      </div>
    </section>
  );
}
