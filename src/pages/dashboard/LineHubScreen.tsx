import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Target, Wrench, LogOut } from "lucide-react";
import { getShift, SHIFT_LABEL } from "@/lib/shifts";

export default function LineHubScreen() {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const shift = getShift(new Date());

  const { data: profile } = useQuery({
    queryKey: ["profile-hub", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("name, production_line")
        .eq("id", user!.id)
        .maybeSingle();
      return data;
    },
  });

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col p-8">
      <header className="flex items-center justify-between mb-12">
        <div>
          <h1 className="text-5xl font-black tracking-tight">
            {profile?.production_line ?? "Line"}
          </h1>
          <p className="text-slate-400 text-xl mt-2">
            {profile?.name ? `${profile.name} · ` : ""}
            {SHIFT_LABEL[shift]}
          </p>
        </div>
        <Button
          variant="outline"
          size="lg"
          onClick={async () => {
            await signOut();
            navigate("/login", { replace: true });
          }}
          className="h-14 px-6 text-lg"
        >
          <LogOut className="h-5 w-5 mr-2" />
          Sign out
        </Button>
      </header>

      <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-8 max-w-6xl w-full mx-auto">
        <button
          onClick={() => navigate("/dashboard/line-display")}
          className="group bg-gradient-to-br from-sky-600 to-sky-800 hover:from-sky-500 hover:to-sky-700 rounded-3xl p-12 flex flex-col items-center justify-center gap-6 transition-all active:scale-95 shadow-2xl"
        >
          <Target className="h-32 w-32 text-white group-hover:scale-110 transition-transform" strokeWidth={1.5} />
          <div className="text-center">
            <div className="text-5xl font-black mb-2">TARGET</div>
            <div className="text-sky-100 text-xl">View shift target & progress</div>
          </div>
        </button>

        <button
          onClick={() => navigate("/dashboard/operator")}
          className="group bg-gradient-to-br from-amber-600 to-red-700 hover:from-amber-500 hover:to-red-600 rounded-3xl p-12 flex flex-col items-center justify-center gap-6 transition-all active:scale-95 shadow-2xl"
        >
          <Wrench className="h-32 w-32 text-white group-hover:scale-110 transition-transform" strokeWidth={1.5} />
          <div className="text-center">
            <div className="text-5xl font-black mb-2">REQUEST</div>
            <div className="text-amber-100 text-xl">Open maintenance work order</div>
          </div>
        </button>
      </div>
    </div>
  );
}
