import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { COUNT_INPUT, FRACTION_INPUT, fractionLabel, parseNullableNumber } from "@/lib/scorecardNumberInput";
import type { ScorecardEntryDraft } from "@/lib/scorecardEntry";
import type { SetField } from "./types";

type NumKey =
  | "lost_time_injuries" | "reportable_accidents" | "first_aid_cases"
  | "near_misses_reported" | "safety_observations_done" | "toolbox_talks_done"
  | "ppe_compliance_pct" | "hs_training_compliance_pct" | "overdue_hs_actions";

function NumField({
  id, label, value, onChange, caption, bounds = COUNT_INPUT,
}: {
  id: string;
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  caption?: string;
  /** The database's own domain, restated on the box. Counters by default. */
  bounds?: { min: number; max?: number; step: number };
}) {
  return (
    <div>
      <Label htmlFor={id} className="text-xs">{label}</Label>
      <Input
        id={id}
        type="number"
        min={bounds.min}
        max={bounds.max}
        step={bounds.step}
        value={value ?? ""}
        onChange={(e) => onChange(parseNullableNumber(e.target.value))}
        className="mt-1 h-9"
      />
      {caption && <p className="mt-1 text-2xs text-muted-foreground">{caption}</p>}
    </div>
  );
}

/**
 * Nine fields, all starting empty. `verdict.hs_rag` — the database's — is shown by
 * `ScorecardVerdict`, not here; this band never colours itself.
 *
 * `first_aid_cases` (a consequence — someone was hurt) and `near_misses_reported`
 * (an antecedent signal — someone caught a hazard before it hurt anyone) sit in
 * different groups on purpose, not next to each other: summing them is the
 * classic mistake this band exists to prevent. The caption on near misses is not
 * decoration — without it, whoever fills this in will try to make the number go
 * down, which is exactly backwards.
 */
export function HealthSafetyPillar({
  draft, setField, verdict,
}: {
  draft: ScorecardEntryDraft;
  setField: SetField;
  verdict: { hs_driver: string[] | null } | null;
}) {
  const set = (key: NumKey) => (v: number | null) => setField(key, v);

  return (
    <section className="rounded border p-4">
      <h3 className="text-xs uppercase tracking-wide text-muted-foreground">Health &amp; Safety</h3>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <NumField id="hs-lti" label="Lost time injuries" value={draft.lost_time_injuries} onChange={set("lost_time_injuries")} />
        <NumField id="hs-accidents" label="Reportable accidents" value={draft.reportable_accidents} onChange={set("reportable_accidents")} />
        <NumField id="hs-first-aid" label="First aid cases" value={draft.first_aid_cases} onChange={set("first_aid_cases")} />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <NumField
          id="hs-near-misses"
          label="Near misses reported"
          value={draft.near_misses_reported}
          onChange={set("near_misses_reported")}
          caption="Reporting a near miss is the good outcome. Zero reported reads as under-reporting."
        />
        <NumField id="hs-observations" label="Safety observations done" value={draft.safety_observations_done} onChange={set("safety_observations_done")} />
        <NumField id="hs-toolbox" label="Toolbox talks done" value={draft.toolbox_talks_done} onChange={set("toolbox_talks_done")} />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {/*
          Fractions, not percentages: numeric(5,4) CHECK BETWEEN 0 AND 1, judged
          against thresholds that are themselves fractions. Labelled (0-1) with
          min/max/step from the one shared definition — a box that said "%" and
          took 95 produced a row the database refused.
        */}
        <NumField
          id="hs-ppe"
          label={fractionLabel("PPE compliance")}
          value={draft.ppe_compliance_pct}
          onChange={set("ppe_compliance_pct")}
          bounds={FRACTION_INPUT}
        />
        <NumField
          id="hs-training"
          label={fractionLabel("H&S training compliance")}
          value={draft.hs_training_compliance_pct}
          onChange={set("hs_training_compliance_pct")}
          bounds={FRACTION_INPUT}
        />
        <NumField id="hs-overdue" label="Overdue H&S actions" value={draft.overdue_hs_actions} onChange={set("overdue_hs_actions")} />
      </div>

      {verdict?.hs_driver && verdict.hs_driver.length > 0 && (
        <ul className="mt-3 list-disc pl-5 text-xs text-muted-foreground">
          {verdict.hs_driver.map((d) => <li key={d}>{d}</li>)}
        </ul>
      )}
    </section>
  );
}
