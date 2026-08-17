import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ScorecardEntryDraft } from "@/lib/scorecardEntry";
import type { SetField } from "./pillars/types";

const STATUS_OPTIONS = ["Aberta", "Em Andamento", "Concluida", "Verificada"] as const;

/**
 * The investigation, shown only when the database says the week carries a Fail
 * (`verdict.quality_fail_type === "Fail"`) — a Not Done is a discipline failure,
 * not a product deviation, and is never asked for a CAPA. This block does not
 * enforce anything: it collects four fields and a status. The enforcement is
 * `scorecard_require_capa_before_approval`, the database trigger; this UI's only
 * job is to let a person see, before they try to approve, what that trigger will
 * demand — see `approvalBlockers` in `src/lib/capaGate.ts`, rendered by the
 * drawer around this block, not duplicated here.
 */
export function CapaBlock({
  draft, setField, verdict,
}: {
  draft: ScorecardEntryDraft;
  setField: SetField;
  verdict: { quality_fail_type: string | null } | null;
}) {
  if (verdict?.quality_fail_type !== "Fail") return null;

  return (
    <section className="rounded border border-destructive/30 bg-destructive/5 p-4">
      <h3 className="text-xs uppercase tracking-wide text-destructive-strong">CAPA — Fail requires an investigation</h3>

      <div className="mt-3 flex flex-col gap-3">
        <div>
          <Label htmlFor="capa-root-cause" className="text-xs">Root cause</Label>
          <Textarea
            id="capa-root-cause"
            value={draft.root_cause ?? ""}
            onChange={(e) => setField("root_cause", e.target.value || null)}
            className="mt-1"
          />
        </div>

        <div>
          <Label htmlFor="capa-corrective-action" className="text-xs">Corrective action</Label>
          <Textarea
            id="capa-corrective-action"
            value={draft.corrective_action ?? ""}
            onChange={(e) => setField("corrective_action", e.target.value || null)}
            className="mt-1"
          />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="capa-owner" className="text-xs">CAPA owner</Label>
            <Input
              id="capa-owner"
              value={draft.capa_owner ?? ""}
              onChange={(e) => setField("capa_owner", e.target.value || null)}
              className="mt-1 h-9"
            />
          </div>
          <div>
            <Label htmlFor="capa-due-date" className="text-xs">CAPA due date</Label>
            <Input
              id="capa-due-date"
              type="date"
              value={draft.capa_due_date ?? ""}
              onChange={(e) => setField("capa_due_date", e.target.value || null)}
              className="mt-1 h-9"
            />
          </div>
        </div>

        <div>
          <Label htmlFor="capa-status" className="text-xs">CAPA status</Label>
          <select
            id="capa-status"
            value={draft.capa_status ?? ""}
            onChange={(e) => setField("capa_status", e.target.value || null)}
            className="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
          >
            <option value="">—</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
      </div>
    </section>
  );
}
