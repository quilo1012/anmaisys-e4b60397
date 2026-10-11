import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Loader2 } from "lucide-react";
import { dashboardPathFor, type Role } from "@/lib/permissions";

/**
 * A porta da frente: manda cada pessoa para o seu quadro e desaparece.
 *
 * Isto tinha uma lista própria de papéis, escrita à mão, com um `else` final que
 * mandava para `/login` quem não estivesse nela. Três papéis não estavam — `employee`,
 * `quality_supervisor` e `production_office_admin` — e por isso entravam, chegavam
 * aqui e eram devolvidos ao ecrã de entrada. Do lado de lá parecia que a password não
 * tinha funcionado.
 *
 * O `roleDashMap` já era a fonte única, e diz isso no seu próprio comentário: o
 * `App.tsx`, o `ProtectedRoute`, o `BackButton`, o `MobileTabBar`, o
 * `DashboardLayout` e o `Login` lêem-no todos. Esta página era a única que não — uma
 * sexta cópia que ficou para trás de cada vez que um papel novo apareceu.
 *
 * `roleDashMap` é `Record<Role, string>`, por isso o compilador obriga a que um papel
 * novo tenha destino. Era essa a protecção que esta página contornava por ter lista
 * própria.
 */
const Index = () => {
  const { user, role, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (loading) return;
    navigate(user ? dashboardPathFor(role as Role | null) : "/login", { replace: true });
  }, [loading, user, role, navigate]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background">
      <img src="/favicon.png" alt="" aria-hidden="true" className="h-12 w-12 rounded-xl object-contain shadow-lg ring-1 ring-white/10" />
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );
};

export default Index;
