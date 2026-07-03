import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

interface Props {
  itemId: string;
  value: number;
  disabled?: boolean;
  align?: "left" | "right";
  invalidateKeys?: unknown[][];
}

/**
 * Inline editable Actual quantity for production_items. Auto-saves on Enter or
 * blur, shows a ✓ for 2 seconds after a successful save.
 */
export function InlineActualInput({ itemId, value, disabled, align = "right", invalidateKeys }: Props) {
  const qc = useQueryClient();
  const [val, setVal] = useState<string>(String(value ?? 0));
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!editing) setVal(String(value ?? 0));
  }, [value, editing]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const commit = async () => {
    const n = Number(val);
    if (!Number.isFinite(n) || n < 0) {
      setVal(String(value ?? 0));
      setEditing(false);
      return;
    }
    if (n === Number(value ?? 0)) {
      setEditing(false);
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from("production_items")
      .update({ actual_qty: n })
      .eq("id", itemId);
    setSaving(false);
    setEditing(false);
    if (error) {
      toast.error(error.message);
      setVal(String(value ?? 0));
      return;
    }
    setSaved(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setSaved(false), 2000);
    (invalidateKeys || []).forEach((k) => qc.invalidateQueries({ queryKey: k }));
  };

  return (
    <div className={cn("flex items-center gap-1", align === "right" ? "justify-end" : "justify-start")}>
      <Input
        type="number"
        inputMode="numeric"
        disabled={disabled || saving}
        value={val}
        onFocus={() => setEditing(true)}
        onChange={(e) => setVal(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); }
          if (e.key === "Escape") { setVal(String(value ?? 0)); setEditing(false); (e.target as HTMLInputElement).blur(); }
        }}
        className={cn(
          "h-8 w-24 tabular-nums text-right px-2",
          editing && "border-primary ring-2 ring-primary/30",
        )}
      />
      {saved && <Check className="h-4 w-4 text-emerald-500" />}
    </div>
  );
}
