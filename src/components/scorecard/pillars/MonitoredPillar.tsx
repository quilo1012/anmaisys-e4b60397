/**
 * Assiduidade e atrasos: recolhidos, exibidos, agregados — e sem peso nenhum. Se um dia
 * voltarem a pontuar, tem de ser como pilar proprio, com peso explicito. Nao os diluir
 * dentro de Health & Safety: um atraso nao e um acidente.
 */
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { parseNullableNumber } from "@/lib/scorecardNumberInput";
import type { ScorecardEntryDraft } from "@/lib/scorecardEntry";
import type { SetField } from "./types";

type Key = "leader_attendance_pct" | "team_attendance_pct" | "leader_lateness_incidents" | "team_lateness_incidents";

const FIELDS: { key: Key; label: string }[] = [
  { key: "leader_attendance_pct", label: "Leader attendance %" },
  { key: "team_attendance_pct", label: "Team attendance %" },
  { key: "leader_lateness_incidents", label: "Leader lateness incidents" },
  { key: "team_lateness_incidents", label: "Team lateness incidents" },
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
        {FIELDS.map(({ key, label }) => (
          <div key={key}>
            <Label htmlFor={`monitored-${key}`} className="text-xs">{label}</Label>
            <Input
              id={`monitored-${key}`}
              type="number"
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
