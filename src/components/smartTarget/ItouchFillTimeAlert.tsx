import { useMemo, useState } from "react";
import { AlertTriangle, ChevronDown } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useStandardCycles } from "@/hooks/useStandardCycles";
import { useSkuCatalogue } from "@/hooks/useSkuCatalogue";
import { checkItouchFillTimes } from "@/lib/itouchFillTimeCheck";

/** Warns when iTouch's standard fill time is missing, implausible or far from the approved fill time (or the matrix when none is approved). */
export function ItouchFillTimeAlert() {
  const { raw: data, approved } = useStandardCycles();
  const { catalogue } = useSkuCatalogue();
  const [open, setOpen] = useState(false);
  const issues = useMemo(
    () => (data ? checkItouchFillTimes(data.records, (sku) => catalogue.byCode.get(sku.trim().toLowerCase())?.name, approved) : []),
    [data, catalogue, approved],
  );
  if (!issues.length) return null;
  return (
    <Alert variant="destructive" role="alert">
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>iTouch fill time needs checking — {issues.length} product{issues.length === 1 ? "" : "s"}</AlertTitle>
      <AlertDescription>
        <p>Some products in iTouch have no fill time, an impossible one, or one far from the approved fill time (or the matrix when none is approved). Fix them in iTouch.</p>
        <button type="button" onClick={() => setOpen((o) => !o)} className="mt-2 inline-flex items-center gap-1 text-sm font-medium underline">
          {open ? "Hide list" : "Show list"} <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
        {open && (
          <ul className="mt-2 max-h-64 space-y-1 overflow-auto text-sm">
            {issues.map((i, n) => (
              <li key={n}><span className="font-medium">{i.line} · {i.sku}</span> — {i.reason}</li>
            ))}
          </ul>
        )}
      </AlertDescription>
    </Alert>
  );
}
