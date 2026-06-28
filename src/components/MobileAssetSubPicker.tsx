import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  useMobileAssets,
  useUpsertMobileAsset,
  formatMobileAsset,
  type MobileAssetType,
} from "@/hooks/useMobileAssets";
import { Plus, Loader2 } from "lucide-react";
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

  return (
    <div className="grid gap-3 md:grid-cols-2">
      <div className="space-y-2">
        <Label>Bag Sealer *</Label>
        <Select
          value={sealerId || undefined}
          onValueChange={(v) => onChange({ sealerId: v, printerId })}
        >
          <SelectTrigger className="h-12">
            <SelectValue placeholder="Select sealer..." />
          </SelectTrigger>
          <SelectContent>
            {sealers.length === 0 && (
              <div className="px-2 py-3 text-sm text-muted-foreground">
                No bag sealers registered.
              </div>
            )}
            {sealers.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {formatMobileAsset(a)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-9 w-full"
          disabled={upsertAsset.isPending}
          onClick={() => handleAdd("bag_sealer")}
        >
          {upsertAsset.isPending ? (
            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
          ) : (
            <Plus className="h-3 w-3 mr-1" />
          )}
          Add Bag Sealer
        </Button>
      </div>

      <div className="space-y-2">
        <Label>Printer *</Label>
        <Select
          value={printerId || undefined}
          onValueChange={(v) => onChange({ sealerId, printerId: v })}
        >
          <SelectTrigger className="h-12">
            <SelectValue placeholder="Select printer..." />
          </SelectTrigger>
          <SelectContent>
            {printers.length === 0 && (
              <div className="px-2 py-3 text-sm text-muted-foreground">
                No printers registered.
              </div>
            )}
            {printers.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {formatMobileAsset(a)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-9 w-full"
          disabled={upsertAsset.isPending}
          onClick={() => handleAdd("printer")}
        >
          {upsertAsset.isPending ? (
            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
          ) : (
            <Plus className="h-3 w-3 mr-1" />
          )}
          Add Printer
        </Button>
      </div>
    </div>
  );
}
