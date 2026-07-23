import { useNavigate, useLocation } from "react-router-dom";
import { useSidebar } from "@/components/ui/sidebar";
import { Home, Menu } from "lucide-react";
import { cn } from "@/lib/utils";
import type { NavItem } from "@/components/DashboardLayout";

/** Bottom tab bar for mobile: Home + the role's top screens + a Menu that opens the full drawer. */
export function MobileTabBar({ tabs }: { tabs: NavItem[] }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { setOpenMobile } = useSidebar();

  const Tab = ({ active, icon: Icon, label, onClick }: {
    active: boolean; icon: React.ComponentType<{ className?: string }>; label: string; onClick: () => void;
  }) => (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[10px] transition-colors",
        active ? "text-primary" : "text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon className="h-5 w-5 shrink-0" />
      <span className="max-w-[68px] truncate leading-tight">{label}</span>
    </button>
  );

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 flex border-t bg-card shadow-[0_-1px_8px_rgba(0,0,0,0.06)] md:hidden print:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      aria-label="Primary"
    >
      <Tab active={pathname === "/dashboard/home"} icon={Home} label="Home" onClick={() => navigate("/dashboard/home")} />
      {tabs.map((t) => (
        <Tab key={t.url} active={pathname === t.url.split("?")[0]} icon={t.icon} label={t.title} onClick={() => navigate(t.url)} />
      ))}
      <Tab active={false} icon={Menu} label="Menu" onClick={() => setOpenMobile(true)} />
    </nav>
  );
}
