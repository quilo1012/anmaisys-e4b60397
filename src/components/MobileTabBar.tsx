import { useNavigate, useLocation } from "react-router-dom";
import { useSidebar } from "@/components/ui/sidebar";
import { Home, Menu } from "lucide-react";
import { cn } from "@/lib/utils";
import type { NavItem } from "@/components/DashboardLayout";
import { useAuth } from "@/contexts/AuthContext";
import { dashboardPathFor, type Role } from "@/lib/permissions";

/**
 * The word under a tab. The short title, unless another tab in the bar has the same one:
 * the Maintenance and the Production dashboards are both "Overview" in their sidebar
 * group, and side by side in the bar they read "Overview · Overview" with the same icon
 * (seen 29/10 on a manager's phone). Then the group names them: "Maintenance", "Production".
 */
export function tabLabel(t: Pick<NavItem, "title" | "shortTitle" | "group">, tabs: ReadonlyArray<Pick<NavItem, "title" | "shortTitle">>): string {
  const label = t.shortTitle ?? t.title;
  const clash = tabs.filter((o) => (o.shortTitle ?? o.title) === label).length > 1;
  return clash && t.group ? t.group : label;
}

/** Bottom tab bar for mobile: Home + the role's top screens + a Menu that opens the full drawer. */
export function MobileTabBar({ tabs }: { tabs: NavItem[] }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  // The bar shows from 768px up, but the sidebar only has a drawer below 768px.
  // On a tablet, "Menu" must therefore re-open the sidebar itself, otherwise the
  // button does nothing at all once the menu is hidden.
  const { setOpenMobile, setOpen, isMobile: sidebarHasDrawer } = useSidebar();
  const openMenu = () => (sidebarHasDrawer ? setOpenMobile(true) : setOpen(true));
  const { role } = useAuth();
  const home = dashboardPathFor(role as Role | null);

  /**
   * One tab: a 64px-wide pill behind the icon marks where you are — colour alone
   * did it before, and a blue icon among grey ones is easy to miss in a bright
   * factory. The whole column is the target (≥56px tall), not just the glyph.
   */
  const Tab = ({ active, icon: Icon, label, onClick, badge }: {
    active: boolean; icon: React.ComponentType<{ className?: string }>; label: string; onClick: () => void; badge?: boolean;
  }) => (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-1 pb-1 pt-1.5 text-[11px] font-medium leading-none transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        active ? "text-primary" : "text-muted-foreground hover:text-foreground",
      )}
    >
      <span
        className={cn(
          "relative flex h-8 w-14 items-center justify-center rounded-full transition-colors",
          active ? "bg-primary/10" : "group-active:bg-muted",
        )}
      >
        <Icon className="h-5 w-5 shrink-0" />
        {badge && <span className="absolute right-3 top-1 h-2 w-2 rounded-full bg-destructive ring-2 ring-card" aria-hidden />}
      </span>
      <span className={cn("max-w-[72px] truncate", active && "font-semibold")}>{label}</span>
    </button>
  );

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 flex border-t bg-card/95 px-[max(0.25rem,env(safe-area-inset-left))] shadow-[0_-1px_8px_rgba(0,0,0,0.06)] backdrop-blur supports-[backdrop-filter]:bg-card/90 lg:hidden print:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      aria-label="Primary"
    >
      {/* Straight to the role's dashboard — /dashboard/home only redirects there now. */}
      <Tab active={pathname === home} icon={Home} label="Home" onClick={() => navigate(home)} />
      {tabs.map((t) => (
        <Tab key={t.url} active={pathname === t.url.split("?")[0]} icon={t.icon} label={tabLabel(t, tabs)} onClick={() => navigate(t.url)} />
      ))}
      <Tab active={false} icon={Menu} label="Menu" onClick={openMenu} />
    </nav>
  );
}
