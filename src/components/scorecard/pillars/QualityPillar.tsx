import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import type { CheckStatus, ScorecardEntryDraft } from "@/lib/scorecardEntry";
import type { SetField } from "./types";

const CHECKS: { key: "ccp_check_status" | "starter_check_status" | "volume_weight_check_status"; label: string }[] = [
  { key: "ccp_check_status", label: "CCP check" },
  { key: "starter_check_status", label: "Starter check" },
  { key: "volume_weight_check_status", label: "Volume/weight check" },
];

const OPTIONS: CheckStatus[] = ["Pass", "Fail", "Not Done"];

/**
 * Three checks, each with three real states — Pass, Fail, Not Done — plus blank.
 * A checkbox can only say yes/no, and this has to say three different things: a
 * check that was skipped is not the same fact as one that was done and failed,
 * and neither is the same as one nobody has touched yet. None start selected —
 * an unrecorded check is not a passed one.
 *
 * The sentence below is read straight off `verdict.quality_fail_type`, which the
 * database arrives at (it is DATA, not a threshold this component reapplies) —
 * this component only decides which of the two sentences that value maps to,
 * never which value it is.
 */
export function QualityPillar({
  draft, setField, verdict,
}: {
  draft: ScorecardEntryDraft;
  setField: SetField;
  verdict: { quality_fail_type: string | null } | null;
}) {
  return (
    <section className="rounded border p-4">
      <h3 className="text-xs uppercase tracking-wide text-muted-foreground">Quality</h3>

      <div className="mt-3 flex flex-col gap-4">
        {CHECKS.map(({ key, label }) => (
          <div key={key}>
            {/*
              The group's accessible name. Without the id/aria-labelledby pair a
              screen reader meets three anonymous groups of "Pass / Fail / Not
              Done" and cannot tell the CCP check from the Starter one — on a
              form that records food-safety checks, that is not a nicety.
            */}
            <Label id={`${key}-label`} className="text-xs">{label}</Label>
            <RadioGroup
              aria-labelledby={`${key}-label`}
              className="mt-1 flex flex-row gap-4"
              value={draft[key] ?? ""}
              onValueChange={(v) => setField(key, v as CheckStatus)}
            >
              {OPTIONS.map((opt) => (
                <div key={opt} className="flex items-center gap-1.5">
                  <RadioGroupItem id={`${key}-${opt}`} value={opt} />
                  <Label htmlFor={`${key}-${opt}`} className="text-xs font-normal">{opt}</Label>
                </div>
              ))}
            </RadioGroup>
          </div>
        ))}
      </div>

      {verdict?.quality_fail_type === "Fail" && (
        <p className="mt-3 text-xs text-destructive-strong">Fail — a CAPA is required</p>
      )}
      {verdict?.quality_fail_type === "Not Done" && (
        <p className="mt-3 text-xs text-muted-foreground">Not Done — no product deviation to investigate</p>
      )}
    </section>
  );
}
