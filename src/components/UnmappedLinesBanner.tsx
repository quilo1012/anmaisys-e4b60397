import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

/**
 * Persistent top banner for admins/managers when one or more production
 * lines have NO entry in intouch_machine_map. Auto-WO from iTouching and
 * SKU sync skip these lines until they are mapped. Audit item #8.
 */
export function UnmappedLinesBanner() {
  const navigate = useNavigate();
  const { data } = useQuery({
    queryKey: ["unmapped_intouch_lines_banner"],
    refetchInterval: 5 * 60_000,
    staleTime: 60_000,
    queryFn: async () => {
      const [{ data: lines }, { data: maps }] = await Promise.all([
        (supabase as any).from("lines").select("id, name").order("name"),
        (supabase as any)
          .from("intouch_machine_map")
          .select("line_id")
          .not("line_id", "is", null),
      ]);
      const mapped = new Set((maps ?? []).map((r: any) => r.line_id));
      return (lines ?? []).filter((l: any) => !mapped.has(l.id)) as { id: string; name: string }[];
    },
  });

  if (!data || data.length === 0) return null;

  const names = data.map((l) => l.name).join(", ");

  return (
    <div className="w-full flex items-center justify-between gap-2 bg-amber-500/15 text-amber-800 dark:text-amber-200 border-b border-amber-500/30 text-xs py-1 px-3">
      <div className="flex items-center gap-1.5 min-w-0">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">
          {data.length} line{data.length === 1 ? "" : "s"} not mapped to iTouching ({names}) — Auto-WO and sync are skipped for them.
        </span>
      </div>
      <button
        type="button"
        onClick={() => navigate("/dashboard/intouch-settings")}
        className="shrink-0 rounded border border-amber-600/40 bg-amber-500/20 hover:bg-amber-500/30 px-2 py-0.5 text-xs font-semibold"
      >
        Fix
      </button>
    </div>
  );
}
