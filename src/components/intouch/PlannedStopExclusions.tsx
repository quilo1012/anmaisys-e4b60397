import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Timer } from "lucide-react";
import { activityLabel } from "@/lib/downtimeExclusions";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- newer than the generated types
const db = supabase as any;

interface PlannedCode {
  code_id: number;
  name: string;
  planned: boolean;
  active: boolean;
}

interface MapRow {
  stop_code_name: string;
  activity: string;
  active: boolean;
}

/**
 * Which planned stop codes pause a maintenance order's clock.
 *
 * The list itself comes from iTouching: a code is planned because somebody ticked
 * Planned in their Admin Centre, and this screen does not second-guess that. What it
 * decides is narrower — of the planned stops, which ones stop counting against an
 * order while the line is down for a repair.
 *
 * Breaks, filling the blender and brushing & cleaning are on by default: the line
 * team was going to do them whatever the machine did. The rest are off and stay off
 * until somebody here decides otherwise, because some of them are large. "No Planned
 * Shift" runs for hours, and writing hours off a repair is a judgement about how the
 * factory measures itself, not a default.
 */
export function PlannedStopExclusions() {
  const qc = useQueryClient();

  const { data: codes, isLoading } = useQuery({
    queryKey: ["intouch_planned_codes"],
    queryFn: async (): Promise<PlannedCode[]> => {
      const { data, error } = await db
        .from("intouch_stop_code_catalog")
        .select("code_id, name, planned, active")
        .eq("planned", true)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: mapped } = useQuery({
    queryKey: ["intouch_exclusion_map"],
    queryFn: async (): Promise<MapRow[]> => {
      const { data, error } = await db.from("intouch_exclusion_map").select("*");
      if (error) throw error;
      return data ?? [];
    },
  });

  const byName = useMemo(
    () => new Map((mapped ?? []).map((m) => [m.stop_code_name.trim().toLowerCase(), m])),
    [mapped],
  );

  const toggle = useMutation({
    mutationFn: async ({ name, on }: { name: string; on: boolean }) => {
      const existing = byName.get(name.trim().toLowerCase());
      if (existing) {
        const { error } = await db
          .from("intouch_exclusion_map")
          .update({ active: on })
          .eq("stop_code_name", existing.stop_code_name);
        if (error) throw error;
        return;
      }
      // A code nobody has classified yet is recorded as a generic planned stop
      // rather than being squeezed into "break" — the order should say what it was.
      const { error } = await db
        .from("intouch_exclusion_map")
        .insert({ stop_code_name: name, activity: "planned_stop", active: on });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["intouch_exclusion_map"] }),
    onError: (e) => toast.error((e as Error).message || "Could not save"),
  });

  const onCount = (mapped ?? []).filter((m) => m.active).length;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Timer className="h-4 w-4" /> Planned stops that pause an order's clock
        </CardTitle>
        <CardDescription>
          While a maintenance order holds the line, time on these codes does not count against it —
          the team was going to spend it anyway. {onCount} of {codes?.length ?? 0} planned codes are on.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-40" />
        ) : (codes ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No planned codes have arrived from iTouching yet. They come in with the stop-code sync.
          </p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {(codes ?? []).map((c) => {
              const m = byName.get(c.name.trim().toLowerCase());
              const on = !!m?.active;
              return (
                <div key={c.code_id} className="flex items-center justify-between gap-3 rounded-lg border p-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{c.name}</div>
                    <div className="flex items-center gap-1 text-2xs text-muted-foreground">
                      <span>#{c.code_id}</span>
                      {m && <Badge variant="outline" className="text-[9px] leading-4">{activityLabel(m.activity)}</Badge>}
                      {!c.active && <Badge variant="outline" className="text-[9px] leading-4">inactive in iTouching</Badge>}
                    </div>
                  </div>
                  <Switch
                    checked={on}
                    onCheckedChange={(v) => toggle.mutate({ name: c.name, on: v })}
                    aria-label={`${c.name} pauses the order clock`}
                  />
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default PlannedStopExclusions;
