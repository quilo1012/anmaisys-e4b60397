import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Mail, Lock } from "lucide-react";
import appliedLogo from "@/assets/appliedlogo.jpeg";
import { logAuditEvent } from "@/hooks/useAuditLogs";
import { useAuth } from "@/contexts/AuthContext";

const dashMap: Record<string, string> = {
  admin: "/dashboard/manager",
  manager: "/dashboard/manager",
  engineer: "/dashboard/engineer",
  operator: "/dashboard/operator",
};

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();
  const { session, role, loading: authLoading } = useAuth();

  useEffect(() => {
    if (!authLoading && session && role) {
      navigate(dashMap[role] || "/dashboard/manager", { replace: true });
    }
  }, [authLoading, navigate, role, session]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const normalizedEmail = email.trim().toLowerCase();

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password,
      });
      if (error) throw error;

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user) {
        const { data: role } = await supabase.rpc("get_user_role", { _user_id: user.id });
        logAuditEvent("login", "user", user.id, { email: user.email, role: role || "unknown" });
        navigate(dashMap[role as string] || "/dashboard/manager", { replace: true });
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="flex min-h-screen items-center justify-center p-4"
      style={{ background: "linear-gradient(135deg, hsl(222 47% 11%) 0%, hsl(217 33% 17%) 50%, hsl(222 47% 11%) 100%)" }}
    >
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/5 p-8 backdrop-blur-xl shadow-2xl">
        <div className="mb-8 flex flex-col items-center space-y-4">
          <img
            src={appliedLogo}
            alt="Applied Nutrition Logo"
            className="h-[120px] w-auto rounded-lg object-contain"
          />

          <div className="text-center">
            <h1 className="text-2xl font-bold tracking-wide text-white">MAINTENANCE PORTAL</h1>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5" autoComplete="off">
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              required
              autoComplete="new-password"
              className="h-11 w-full rounded-lg border border-white/15 bg-white/10 pl-10 pr-4 text-sm text-white transition-colors placeholder:text-white/40 focus:border-amber-500/50 focus:outline-none focus:ring-2 focus:ring-amber-500/50"
            />
          </div>

          <div className="relative">
            <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              minLength={6}
              required
              autoComplete="new-password"
              className="h-11 w-full rounded-lg border border-white/15 bg-white/10 pl-10 pr-4 text-sm text-white transition-colors placeholder:text-white/40 focus:border-amber-500/50 focus:outline-none focus:ring-2 focus:ring-amber-500/50"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="h-11 w-full rounded-lg bg-blue-700 text-sm font-semibold text-white transition-colors disabled:pointer-events-none disabled:opacity-50 hover:bg-blue-600"
          >
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </form>
      </div>
    </div>
  );
}
