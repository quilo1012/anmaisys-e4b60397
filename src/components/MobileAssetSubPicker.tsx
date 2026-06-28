import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  useMobileAssets,
  useUpsertMobileAsset,
  formatMobileAsset,
  type MobileAssetType,
} from "@/hooks/useMobileAssets";
import { Plus, Loader2, Printer, Package } from "lucide-react";
import { toast } from "sonner";


interface Props {
  lineId: string;
  /** Sealer asset id. */
  sealerId: string;
  /** Printer asset id. */
  printerId: string;
  onChange: (next: { sealerId: string; printerId: string }) => void;
}

/**
 * Sealer + Printer sub-picker for the Sealer/Printer line. The line itself is
 * already locked by the device token — this component only chooses *which*
 * mobile asset(s) on that line are involved in the WO.
 */
export function MobileAssetSubPicker({ lineId, sealerId, printerId, onChange }: Props) {
  const { data: mobileAssets } = useMobileAssets();
  const upsertAsset = useUpsertMobileAsset();

  const printers = (mobileAssets || []).filter((a) => a.asset_type === "printer");
  const sealers = (mobileAssets || []).filter((a) => a.asset_type === "bag_sealer");

  const handleAdd = async (type: MobileAssetType) => {
    const list = type === "printer" ? printers : sealers;
    const nextNumber = (list.reduce((m, a) => Math.max(m, a.asset_number), 0) || 0) + 1;
    try {
      const created = await upsertAsset.mutateAsync({
        asset_type: type,
        asset_number: nextNumber,
        current_line_id: lineId || null,
        active: true,
      });
      const newId = (created as any).id;
      if (type === "bag_sealer") onChange({ sealerId: newId, printerId });
      else onChange({ sealerId, printerId: newId });
      toast.success(`${type === "printer" ? "Printer" : "Bag Sealer"} ${nextNumber} added`);
    } catch (err: any) {
      toast.error(err.message || "Failed to add asset");
    }
  };

  const [activeType, setActiveType] = useState<MobileAssetType>("printer");
  const list = activeType === "printer" ? printers : sealers;
  const selectedId = activeType === "printer" ? printerId : sealerId;
  const pick = (id: string) => {
    if (activeType === "printer") onChange({ sealerId, printerId: id });
    else onChange({ sealerId: id, printerId });
  };

  const printerSel = printers.find((p) => p.id === printerId);
  const sealerSel = sealers.find((s) => s.id === sealerId);

  return (
    <div className="space-y-3">
      {/* Step 1 — choose asset type */}
      <div className="inline-flex rounded-md border bg-card p-1 w-full sm:w-auto">
        <button
          type="button"
          onClick={() => setActiveType("printer")}
          className={cn(
            "flex-1 sm:flex-none px-4 h-10 rounded-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors",
            activeType === "printer" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent",
          )}
        >
          <Printer className="h-4 w-4" />
          Printer {printerSel ? `· ${printerSel.asset_number}` : ""}
        </button>
        <button
          type="button"
          onClick={() => setActiveType("bag_sealer")}
          className={cn(
            "flex-1 sm:flex-none px-4 h-10 rounded-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors",
            activeType === "bag_sealer" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent",
          )}
        >
          <Package className="h-4 w-4" />
          Bag Sealer {sealerSel ? `· ${sealerSel.asset_number}` : ""}
        </button>
      </div>

      {/* Step 2 — pick the number for the chosen type */}
      <div className="space-y-2">
        <Label>
          Select {activeType === "printer" ? "Printer" : "Bag Sealer"} number *
        </Label>
        <div className="flex flex-wrap gap-2">
          {list.length === 0 && (
            <span className="text-sm text-muted-foreground py-2">
              No {activeType === "printer" ? "printers" : "bag sealers"} registered.
            </span>
          )}
          {list.map((a) => {
            const active = a.id === selectedId;
            return (
              <Button
                key={a.id}
                type="button"
                variant={active ? "default" : "outline"}
                className={cn("h-14 min-w-14 px-4 text-lg font-bold", active && "ring-2 ring-primary")}
                onClick={() => pick(a.id)}
              >
                {a.asset_number}
              </Button>
            );
          })}
          <Button
            type="button"
            variant="ghost"
            className="h-14"
            disabled={upsertAsset.isPending}
            onClick={() => handleAdd(activeType)}
          >
            {upsertAsset.isPending ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Plus className="h-4 w-4 mr-1" />
            )}
            Add
          </Button>
        </div>
      </div>
    </div>
  );
}


