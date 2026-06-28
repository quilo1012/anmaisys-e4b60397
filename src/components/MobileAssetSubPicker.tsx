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

  const renderButtons = (
    list: typeof sealers,
    selectedId: string,
    onPick: (id: string) => void,
    emptyLabel: string,
  ) => (
    <div className="flex flex-wrap gap-2">
      {list.length === 0 && (
        <span className="text-sm text-muted-foreground py-2">{emptyLabel}</span>
      )}
      {list.map((a) => {
        const active = a.id === selectedId;
        return (
          <Button
            key={a.id}
            type="button"
            variant={active ? "default" : "outline"}
            className={cn("h-12 px-4 font-semibold", active && "ring-2 ring-primary")}
            onClick={() => onPick(a.id)}
          >
            {formatMobileAsset(a)}
          </Button>
        );
      })}
    </div>
  );

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="space-y-2">
        <Label>Bag Sealer *</Label>
        {renderButtons(
          sealers,
          sealerId,
          (id) => onChange({ sealerId: id, printerId }),
          "No bag sealers registered.",
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-9"
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
        {renderButtons(
          printers,
          printerId,
          (id) => onChange({ sealerId, printerId: id }),
          "No printers registered.",
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-9"
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

