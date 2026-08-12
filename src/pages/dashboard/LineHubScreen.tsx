import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Target, Wrench, LogOut, Award } from "lucide-react";
import { getShift, SHIFT_LABEL } from "@/lib/shifts";

export default function LineHubScreen() {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const shift = getShift(new Date());

  const { data: profile } = useQuery({
    queryKey: ["profile-hub", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("name, production_line")
        .eq("id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  return (
    <div className="min-h-screen bg-wall text-wall-ink flex flex-col p-8">
      <header className="flex items-center justify-between mb-12">
        <div>
          <h1 className="text-5xl font-black tracking-tight">
            {profile?.production_line ?? "Line"}
          </h1>
          <p className="text-wall-ink-muted text-xl mt-2">
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
          className="group bg-gradient-to-br from-primary to-primary hover:from-primary hover:to-primary rounded-3xl p-12 flex flex-col items-center justify-center gap-6 transition-all active:scale-95 shadow-2xl"
        >
          <Target className="h-32 w-32 text-wall-ink group-hover:scale-110 transition-transform" strokeWidth={1.5} />
          <div className="text-center">
            <div className="text-5xl font-black mb-2">TARGET</div>
            <div className="text-primary text-xl">View shift target & progress</div>
          </div>
        </button>

        <button
          onClick={() => navigate("/dashboard/operator")}
          className="group bg-gradient-to-br from-warning to-destructive hover:from-warning hover:to-destructive rounded-3xl p-12 flex flex-col items-center justify-center gap-6 transition-all active:scale-95 shadow-2xl"
        >
          <Wrench className="h-32 w-32 text-wall-ink group-hover:scale-110 transition-transform" strokeWidth={1.5} />
          <div className="text-center">
            <div className="text-5xl font-black mb-2">REQUEST</div>
            <div className="text-warning-strong text-xl">Open a maintenance order</div>
          </div>
        </button>

        {/* The leader's own door, not the line's.
            A wide bar under the two working tiles rather than a third one beside
            them: TARGET and REQUEST are what the line does all shift, and this is
            what one person checks at the end of it. It asks for a PIN before it
            shows anything. */}
        <button
          onClick={() => navigate("/dashboard/leader/scorecard")}
          className="group md:col-span-2 bg-card border-2 border-border hover:border-primary rounded-3xl p-8 flex items-center justify-center gap-6 transition-all active:scale-95 shadow-xl"
        >
          <Award className="h-16 w-16 text-primary group-hover:scale-110 transition-transform" strokeWidth={1.5} />
          <div className="text-left">
            <div className="text-3xl font-black mb-1">MY SCORECARD</div>
            <div className="text-wall-ink-muted text-lg">Line leaders — enter your PIN</div>
          </div>
        </button>
      </div>
    </div>
  );
}
