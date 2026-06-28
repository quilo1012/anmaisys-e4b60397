import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  useMobileAssets,
  useUpsertMobileAsset,
  type MobileAssetType,
} from "@/hooks/useMobileAssets";
import { Plus, Loader2, Printer, Package, X } from "lucide-react";
import { toast } from "sonner";


interface Props {
  lineId: string;
  /** Sealer asset id (optional — operator may pick only a printer or only a sealer). */
  sealerId: string;
  /** Printer asset id (optional — operator may pick only a printer or only a sealer). */
  printerId: string;
  onChange: (next: { sealerId: string; printerId: string }) => void;
}

/**
 * Sealer + Printer sub-picker. Each asset is independent — the operator
 * picks a Printer number AND/OR a Bag Sealer number (they are different
 * physical machines and can have different numbers).
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

  const renderSection = (
    type: MobileAssetType,
    list: typeof printers,
    selectedId: string,
  ) => {
    const isPrinter = type === "printer";
    const Icon = isPrinter ? Printer : Package;
    const label = isPrinter ? "Printer" : "Bag Sealer";
    const pick = (id: string) => {
      if (isPrinter) onChange({ sealerId, printerId: id });
      else onChange({ sealerId: id, printerId });
    };
    const clear = () => {
      if (isPrinter) onChange({ sealerId, printerId: "" });
      else onChange({ sealerId: "", printerId });
    };

    return (
      <div className="space-y-2 rounded-md border bg-card/40 p-3">
        <div className="flex items-center justify-between">
          <Label className="inline-flex items-center gap-2 text-sm font-semibold">
            <Icon className="h-4 w-4" />
            {label} number
          </Label>
          {selectedId && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={clear}
            >
              <X className="h-3 w-3 mr-1" /> Clear
            </Button>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {list.length === 0 && (
            <span className="text-sm text-muted-foreground py-2">
              No {isPrinter ? "printers" : "bag sealers"} registered.
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
            onClick={() => handleAdd(type)}
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
    );
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Pick the Printer number, the Bag Sealer number, or both — each machine is independent.
      </p>
      {renderSection("printer", printers, printerId)}
      {renderSection("bag_sealer", sealers, sealerId)}
    </div>
  );
}
