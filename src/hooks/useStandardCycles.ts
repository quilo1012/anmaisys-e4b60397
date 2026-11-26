import { useMemo } from "react";
import { useItouchCycles } from "@/hooks/useItouchCycles";
import { useSkuFillTimes } from "@/hooks/useSkuFillTimes";
import { approvedLookup, withApprovedFillTimes } from "@/lib/approvedFillTimes";

/** iTouch's real seconds with each approved per-SKU fill time in its place (when the SKU register is active). */
export function useStandardCycles() {
  const itouch = useItouchCycles();
  const sku = useSkuFillTimes();
  const approved = useMemo(() => approvedLookup(sku.data), [sku.data]);
  const data = useMemo(
    () => (itouch.data ? { ...itouch.data, records: withApprovedFillTimes(itouch.data.records, approved, sku.data) } : undefined),
    [itouch.data, approved, sku.data],
  );
  return { ...itouch, data, raw: itouch.data, approved, registerActive: sku.data != null };
}
