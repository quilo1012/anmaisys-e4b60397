import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Loader2 } from "lucide-react";

const Index = () => {
  const { user, role, isReady } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isReady) return;
    if (!user) {
      navigate("/login", { replace: true });
      return;
    }
    if (role === "admin" || role === "manager") navigate("/dashboard/manager", { replace: true });
    else if (role === "engineer") navigate("/dashboard/engineer", { replace: true });
    else if (role === "operator") navigate("/dashboard/operator", { replace: true });
    else navigate("/login", { replace: true });
  }, [isReady, user, role, navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );
};

export default Index;
