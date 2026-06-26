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
    if (role === "admin" || (role === "manager" || role === "maintenance_manager")) navigate("/dashboard/manager", { replace: true });
    else if (role === "engineer") navigate("/dashboard/engineer", { replace: true });
    else if (role === "operator") navigate("/dashboard/line-display", { replace: true });
    else navigate("/login", { replace: true });
  }, [loading, user, role, navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );
};

export default Index;
