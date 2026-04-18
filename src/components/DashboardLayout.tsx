import { ReactNode, useState, useEffect, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { NavLink } from "@/components/NavLink";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ClipboardList, Users, Package, LogOut, LayoutDashboard, BarChart3, Cog, AlertCircle, Shield, Monitor, DollarSign, Briefcase, Sun, Moon, Clock, Activity, PowerOff } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import appliedLogo from "@/assets/appliedlogo.jpeg";
import { Button } from "@/components/ui/button";
import { OnlineEngineersPanel } from "@/components/OnlineEngineersPanel";
import { NotificationPanel } from "@/components/NotificationPanel";
import { useHeartbeat } from "@/hooks/useHeartbeat";
import { useOfflineDetection } from "@/hooks/useOfflineQueue";
import { useStoppedLinesCount } from "@/hooks/useStoppedLinesCount";
import type { Database } from "@/integrations/supabase/types";

type AppRole = Database["public"]["Enums"]["app_role"];

interface NavItem {
  title: string;
  url: string;
  icon: React.ComponentType<{ className?: string }>;
  roles: AppRole[];
  group: string;
}

const navItems: NavItem[] = [
  // Operations
  { title: "Dashboard", url: "/dashboard/operator", icon: LayoutDashboard, roles: ["operator"], group: "Operations" },
  { title: "Dashboard", url: "/dashboard/engineer", icon: LayoutDashboard, roles: ["engineer"], group: "Operations" },
  { title: "Dashboard", url: "/dashboard/manager", icon: LayoutDashboard, roles: ["admin", "manager"], group: "Operations" },
  { title: "Work Orders", url: "/dashboard/work-orders", icon: ClipboardList, roles: ["admin", "manager"], group: "Operations" },
  { title: "Downtime", url: "/dashboard/downtime", icon: Clock, roles: ["admin", "manager"], group: "Operations" },
  { title: "Control Center", url: "/dashboard/control-center", icon: Monitor, roles: ["admin", "manager"], group: "Operations" },
  // Assets
  { title: "Machines", url: "/dashboard/machines", icon: Cog, roles: ["admin", "manager"], group: "Assets" },
  { title: "Problems", url: "/dashboard/problems", icon: AlertCircle, roles: ["admin", "manager"], group: "Assets" },
  { title: "Stock", url: "/dashboard/stock", icon: Package, roles: ["admin", "manager", "engineer"], group: "Assets" },
  // Reports
  { title: "Analytics", url: "/dashboard/analytics", icon: BarChart3, roles: ["admin", "manager"], group: "Reports" },
  { title: "Financial", url: "/dashboard/financial", icon: DollarSign, roles: ["admin", "manager"], group: "Reports" },
  { title: "Executive", url: "/dashboard/executive", icon: Briefcase, roles: ["admin", "manager"], group: "Reports" },
  // Admin
  { title: "Users", url: "/users/manage", icon: Users, roles: ["admin"], group: "Admin" },
  { title: "Audit Logs", url: "/dashboard/audit-logs", icon: Shield, roles: ["admin"], group: "Admin" },
];

function useDarkMode() {
  const [dark, setDark] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("theme") === "dark";
  });
  useEffect(() => {
    const root = document.documentElement;
    if (dark) { root.classList.add("dark"); } else { root.classList.remove("dark"); }
    localStorage.setItem("theme", dark ? "dark" : "light");
  }, [dark]);
  return { dark, toggle: () => setDark((d) => !d) };
}

function LiveClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  const time = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const date = now.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });
  return (
    <div className="text-sm font-mono text-muted-foreground tabular-nums">
      <span className="font-semibold text-foreground">{time}</span>
      <span className="mx-2">—</span>
      <span>{date}</span>
    </div>
  );
}

function SidebarNav({ filteredItems }: { filteredItems: NavItem[] }) {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";

  // Group items
  const groups = ["Operations", "Assets", "Reports", "Admin"];
  const grouped = groups.map((g) => ({
    label: g,
    items: filteredItems.filter((i) => i.group === g),
  })).filter((g) => g.items.length > 0);

  return (
    <>
      {grouped.map((group) => (
        <SidebarGroup key={group.label}>
          <SidebarGroupLabel className="text-sidebar-foreground/60 group-data-[collapsible=icon]:hidden">{group.label}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {group.items.map((item) => (
                <SidebarMenuItem key={item.title + item.url}>
                  {collapsed ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <SidebarMenuButton asChild>
                          <NavLink
                            to={item.url}
                            end
                            className="flex items-center justify-center px-3 py-2 rounded-md text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
                            activeClassName="bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                          >
                            <item.icon className="h-4 w-4" />
                          </NavLink>
                        </SidebarMenuButton>
                      </TooltipTrigger>
                      <TooltipContent side="right">{item.title}</TooltipContent>
                    </Tooltip>
                  ) : (
                    <SidebarMenuButton asChild>
                      <NavLink
                        to={item.url}
                        end
                        className="flex items-center gap-3 px-3 py-2 rounded-md text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
                        activeClassName="bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                      >
                        <item.icon className="h-4 w-4" />
                        <span>{item.title}</span>
                      </NavLink>
                    </SidebarMenuButton>
                  )}
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      ))}
    </>
  );
}

const roleTitle: Record<string, string> = {
  admin: "Admin",
  manager: "Manager",
  engineer: "Engineer",
  operator: "Operator",
};

const routeTitles: Record<string, string> = {
  "/dashboard/operator": "Dashboard",
  "/dashboard/engineer": "Dashboard",
  "/dashboard/manager": "Dashboard",
  "/dashboard/work-orders": "Work Orders",
  "/dashboard/downtime": "Downtime",
  "/dashboard/control-center": "Control Center",
  "/dashboard/machines": "Machines",
  "/dashboard/problems": "Problems",
  "/dashboard/stock": "Stock",
  "/dashboard/analytics": "Analytics",
  "/dashboard/financial": "Financial",
  "/dashboard/executive": "Executive",
  "/users/manage": "Users",
  "/dashboard/audit-logs": "Audit Logs",
};

export function DashboardLayout({ children }: { children: ReactNode }) {
  const { role, profile, signOut } = useAuth();
  const { dark, toggle: toggleDark } = useDarkMode();
  const location = useLocation();
  const navigate = useNavigate();
  const { isOnline } = useOfflineDetection();
  const { data: stoppedLinesCount = 0 } = useStoppedLinesCount();

  useHeartbeat();

  // Browser tab title
  useEffect(() => {
    const pageName = routeTitles[location.pathname] || "Dashboard";
    document.title = `AN Maintenance | ${pageName}`;
  }, [location.pathname]);

  const filteredItems = navItems.filter((item) => role && item.roles.includes(role));
  const showStoppedBadge = stoppedLinesCount > 0 && (role === "engineer" || role === "manager" || role === "admin");
  const stoppedTarget = role === "engineer" ? "/dashboard/engineer" : "/dashboard/work-orders";

  return (
    <TooltipProvider delayDuration={0}>
      <SidebarProvider defaultOpen={false}>
        <SidebarShell
          role={role}
          profile={profile}
          signOut={signOut}
          dark={dark}
          toggleDark={toggleDark}
          filteredItems={filteredItems}
          isOnline={isOnline}
          showStoppedBadge={showStoppedBadge}
          stoppedLinesCount={stoppedLinesCount}
          stoppedTarget={stoppedTarget}
          navigate={navigate}
          location={location}
        >
          {children}
        </SidebarShell>
      </SidebarProvider>
    </TooltipProvider>
  );
}

interface SidebarShellProps {
  role: AppRole | null;
  profile: ReturnType<typeof useAuth>["profile"];
  signOut: () => Promise<void>;
  dark: boolean;
  toggleDark: () => void;
  filteredItems: NavItem[];
  isOnline: boolean;
  showStoppedBadge: boolean;
  stoppedLinesCount: number;
  stoppedTarget: string;
  navigate: ReturnType<typeof useNavigate>;
  location: ReturnType<typeof useLocation>;
  children: ReactNode;
}

function SidebarShell({
  role, profile, signOut, dark, toggleDark, filteredItems,
  isOnline, showStoppedBadge, stoppedLinesCount, stoppedTarget,
  navigate, location, children,
}: SidebarShellProps) {
  const { open, setOpen, isMobile, setOpenMobile } = useSidebar();

  // Auto-close sidebar when route changes
  const lastPathRef = useRef(location.pathname);
  useEffect(() => {
    if (lastPathRef.current !== location.pathname) {
      lastPathRef.current = location.pathname;
      if (isMobile) setOpenMobile(false);
      else setOpen(false);
    }
  }, [location.pathname, isMobile, setOpen, setOpenMobile]);

  // ESC closes sidebar
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (isMobile) setOpenMobile(false);
        else setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isMobile, setOpen, setOpenMobile]);

  const desktopOverlayOpen = !isMobile && open;

  return (
    <div className="flex h-screen w-full overflow-hidden">
      <Sidebar collapsible="offcanvas" className="border-r-0 print:hidden z-50">
        <div className="flex items-center gap-2 px-4 py-4">
          <img src={appliedLogo} alt="Applied Nutrition" className="h-8 w-8 rounded object-contain" />
          <span className="text-lg font-bold text-sidebar-foreground">AN Maintenance</span>
        </div>
        <SidebarContent>
          <SidebarNav filteredItems={filteredItems} />
        </SidebarContent>
        <div className="mt-auto p-4 border-t border-sidebar-border">
          <div className="text-sm text-sidebar-foreground/70 mb-2 truncate">
            {profile?.name}
          </div>
          <div className="text-xs text-sidebar-foreground/50 mb-3 capitalize">
            {role ? roleTitle[role] : ""}
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent"
            onClick={async () => {
              await signOut();
              window.location.href = "/login";
            }}
          >
            <LogOut className="h-4 w-4 mr-2" />
            <span>Sign Out</span>
          </Button>
        </div>
      </Sidebar>

      {/* Desktop backdrop when sidebar is open as overlay */}
      {desktopOverlayOpen && (
        <div
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-40 bg-black/30 animate-in fade-in duration-200 print:hidden"
          aria-hidden="true"
        />
      )}

      <main className="flex-1 flex flex-col overflow-hidden">
        <header className="h-14 border-b bg-card flex items-center px-4 gap-3 print:hidden">
          <SidebarTrigger aria-label="Toggle menu" />
          <img src={appliedLogo} alt="Applied Nutrition" className="h-8 w-8 rounded object-contain" />
          <h1 className="text-lg font-semibold text-foreground">
            {role ? roleTitle[role] : ""} Dashboard
          </h1>
          {(role === "admin" || role === "manager") && (
            <div className="ml-4">
              <OnlineEngineersPanel />
            </div>
          )}
          <div className="ml-auto flex items-center gap-2">
            {showStoppedBadge && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate(stoppedTarget)}
                className="bg-destructive hover:bg-destructive/90 text-destructive-foreground animate-pulse gap-1.5 h-9"
                aria-label={`${stoppedLinesCount} production lines currently stopped`}
              >
                <PowerOff className="h-4 w-4" />
                <span className="font-bold">{stoppedLinesCount}</span>
                <span className="hidden sm:inline text-xs">line{stoppedLinesCount > 1 ? "s" : ""} stopped</span>
              </Button>
            )}
            <NotificationPanel />
            <Button variant="ghost" size="icon" onClick={toggleDark} title={dark ? "Light mode" : "Dark mode"}>
              {dark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
            </Button>
            <LiveClock />
          </div>
        </header>
        {!isOnline && (
          <div className="bg-destructive text-destructive-foreground text-center text-sm py-1 px-4 font-medium">
            ⚠️ You are offline — changes will sync when connection is restored
          </div>
        )}
        <div className="flex-1 overflow-y-auto p-4 md:p-6">
          {children}
        </div>
      </main>
    </div>
  );
}
