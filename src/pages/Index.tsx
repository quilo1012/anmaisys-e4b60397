import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Loader2 } from "lucide-react";

const Index = () => {
  const { user, role, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      navigate("/login", { replace: true });
      return;
    }
    if (role === "admin" || role === "manager" || role === "maintenance_manager" || role === "viewer" || role === "supervisor" || role === "planner") navigate("/dashboard/manager", { replace: true });
    else if (role === "engineer" || role === "co_engineer") navigate("/dashboard/engineer", { replace: true });
    else if (role === "operator") navigate("/dashboard/operator", { replace: true });
    else navigate("/login", { replace: true });
  }, [loading, user, role, navigate]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background">
      <img src="/favicon.png" alt="" aria-hidden="true" className="h-12 w-12 rounded-xl object-contain shadow-lg ring-1 ring-white/10" />
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );
};

export default Index;
