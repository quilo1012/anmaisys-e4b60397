import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLines } from "@/hooks/useMachines";
import { useMobileAssets, formatMobileAsset } from "@/hooks/useMobileAssets";
import { Printer, X } from "lucide-react";

interface Props {
  lineId: string;
  mobileAssetId: string;
  onChange: (next: { lineId: string; mobileAssetId: string }) => void;
}

/**
 * Line-centric picker for new Work Orders.
 *  Step 1 (required): pick a production line.
 *  Step 2 (optional): mark that the problem is on a mobile asset (Printer / Bag Sealer).
 *
 * No more "machine" dropdown — fixed machines are implicit to the line.
 */
export function LinePicker({ lineId, mobileAssetId, onChange }: Props) {
  const { data: lines } = useLines();
  const { data: mobileAssets } = useMobileAssets();
  const [showMobile, setShowMobile] = useState(!!mobileAssetId);

  return (
    <div className="space-y-4">
      {/* Step 1 — Line */}
      <div className="space-y-2">
        <Label>Line *</Label>
        <Select value={lineId} onValueChange={(v) => onChange({ lineId: v, mobileAssetId })}>
          <SelectTrigger className="h-12">
            <SelectValue placeholder="Select production line..." />
          </SelectTrigger>
          <SelectContent>
            {(lines || []).map((l) => (
              <SelectItem key={l.id} value={l.id}>
                {l.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Step 2 — Mobile asset toggle */}
      {!showMobile && (
        <Button
          type="button"
          variant="outline"
          className="w-full h-12 justify-start gap-2"
          onClick={() => setShowMobile(true)}
        >
          <Printer className="h-4 w-4" />
          Problem with a Printer or Bag Sealer?
        </Button>
      )}

      {showMobile && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Mobile asset (optional)</Label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => {
                setShowMobile(false);
                onChange({ lineId, mobileAssetId: "" });
              }}
            >
              <X className="h-3 w-3 mr-1" /> Clear
            </Button>
          </div>
          <Select
            value={mobileAssetId || undefined}
            onValueChange={(v) => onChange({ lineId, mobileAssetId: v })}
          >
            <SelectTrigger className="h-12">
              <SelectValue placeholder="Select printer or bag sealer..." />
            </SelectTrigger>
            <SelectContent>
              {(mobileAssets || []).length === 0 && (
                <div className="px-2 py-3 text-sm text-muted-foreground">
                  No mobile assets registered.
                </div>
              )}
              {(mobileAssets || []).map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {formatMobileAsset(a)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
}
