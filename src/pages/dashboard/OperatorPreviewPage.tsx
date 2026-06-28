import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Eye, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLines } from "@/hooks/useMachines";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import LineProductionScreen from "./LineProductionScreen";

const LS_LINE_KEY = "lps:line";
const LS_TABLET_KEY = "lps:tablet_id";

/**
 * Admin/manager-only preview of the operator Line Production screen.
 * Forces a non-editing tablet id while mounted so admins can simulate the
 * operator UI without accidentally mutating production data.
 */
export default function OperatorPreviewPage() {
  const navigate = useNavigate();
  const { data: lines, isLoading } = useLines();
  const [line, setLine] = useState<string>(() => localStorage.getItem(LS_LINE_KEY) || "");
  const [mountKey, setMountKey] = useState(0);

  // Force read-only (non-editing) tablet id while preview is open; restore on exit.
  useEffect(() => {
    const prevTablet = localStorage.getItem(LS_TABLET_KEY);
    localStorage.setItem(LS_TABLET_KEY, "0");
    return () => {
      if (prevTablet === null) localStorage.removeItem(LS_TABLET_KEY);
      else localStorage.setItem(LS_TABLET_KEY, prevTablet);
    };
  }, []);

  // Default to first line once loaded.
  useEffect(() => {
    if (!line && lines && lines.length > 0) {
      setLine(lines[0].name);
      localStorage.setItem(LS_LINE_KEY, lines[0].name);
    }
  }, [lines, line]);

  const handleChange = (name: string) => {
    setLine(name);
    localStorage.setItem(LS_LINE_KEY, name);
    setMountKey((k) => k + 1); // remount to pick up new line cleanly
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="sticky top-0 z-50 border-b border-amber-500/40 bg-amber-500/10 backdrop-blur px-3 py-2 flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => navigate(-1)}
          className="h-9 bg-slate-900/60 border-slate-700 text-white hover:bg-slate-800"
        >
          <ArrowLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        <div className="flex items-center gap-2 text-amber-300 font-semibold">
          <Eye className="h-4 w-4" />
          Operator Preview (read-only)
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-amber-200/80 hidden sm:inline">Simulating line:</span>
          <Select value={line} onValueChange={handleChange} disabled={isLoading}>
            <SelectTrigger className="h-9 w-56 bg-slate-900/60 border-slate-700 text-white">
              <SelectValue placeholder={isLoading ? "Loading lines…" : "Select a line"} />
            </SelectTrigger>
            <SelectContent>
              {(lines ?? []).map((l) => (
                <SelectItem key={l.id} value={l.name}>
                  {l.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div key={mountKey} className="pointer-events-auto">
        {line ? (
          <LineProductionScreen />
        ) : (
          <div className="p-10 text-center text-slate-400">Select a line to preview.</div>
        )}
      </div>
    </div>
  );
}
