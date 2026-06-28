import { useNavigate } from "react-router-dom";
import { ArrowLeft, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import EngineerDashboard from "./EngineerDashboard";

/**
 * Admin/manager-only preview of the Engineer dashboard.
 * Renders the full engineer screen inside a read-only wrapper so admins
 * can inspect the engineer experience without triggering mutations.
 */
export default function EngineerPreviewPage() {
  const navigate = useNavigate();

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
          Engineer Preview (read-only)
        </div>
        <div className="ml-auto text-xs text-amber-200/80">
          Interações desativadas — apenas visualização.
        </div>
      </div>

      {/* Read-only overlay: blocks clicks/typing but keeps full visual fidelity */}
      <div
        className="pointer-events-none select-none"
        aria-label="Engineer dashboard preview (read-only)"
      >
        <EngineerDashboard />
      </div>
    </div>
  );
}
