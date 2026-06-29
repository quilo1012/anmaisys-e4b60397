import { ReactNode, useState, useEffect } from "react";
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
import { TooltipProvider } from "@/components/ui/tooltip";
import { ClipboardList, Users, Package, LogOut, LayoutDashboard, BarChart3, Cog, AlertCircle, Shield, Monitor, DollarSign, Briefcase, Sun, Moon, Clock, PowerOff, KeyRound, Settings as SettingsIcon, Factory, Boxes, History, Gauge, FileBarChart, AlertTriangle, Trophy, TimerOff, Calculator, Brain, Radar } from "lucide-react";
import { ChangePasswordDialog } from "@/components/ChangePasswordDialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useLocation, useNavigate } from "react-router-dom";
import appliedLogo from "@/assets/appliedlogo.jpeg";
import { Button } from "@/components/ui/button";
import { OnlineEngineersPanel } from "@/components/OnlineEngineersPanel";
import { NotificationPanel } from "@/components/NotificationPanel";
import { AudioStatusButton } from "@/components/AudioStatusButton";
import { useCriticalAlert } from "@/contexts/CriticalAlertContext";
import { useHeartbeat } from "@/hooks/useHeartbeat";
import { useOfflineDetection } from "@/hooks/useOfflineQueue";
import { useStoppedLinesCount } from "@/hooks/useStoppedLinesCount";
import { useLanguage } from "@/contexts/LanguageContext";
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
  // Overview
  { title: "Dashboard", url: "/dashboard/operator", icon: LayoutDashboard, roles: ["operator"], group: "Overview" },
  { title: "Dashboard", url: "/dashboard/engineer", icon: LayoutDashboard, roles: ["engineer"], group: "Overview" },
  { title: "My Tasks", url: "/dashboard/engineer?focus=tasks", icon: Briefcase, roles: ["engineer"], group: "Overview" },
  { title: "History", url: "/dashboard/engineer?focus=history", icon: History, roles: ["engineer"], group: "Overview" },
  { title: "Dashboard", url: "/dashboard/manager", icon: LayoutDashboard, roles: ["admin", "manager", "maintenance_manager"], group: "Overview" },
  { title: "Control Center", url: "/dashboard/control-center", icon: Monitor, roles: ["admin", "manager", "maintenance_manager"], group: "Overview" },

  // Maintenance
  { title: "Work Orders", url: "/dashboard/work-orders", icon: ClipboardList, roles: ["admin", "manager", "maintenance_manager"], group: "Maintenance" },
  { title: "Downtime", url: "/dashboard/downtime", icon: Clock, roles: ["admin", "manager", "maintenance_manager"], group: "Maintenance" },
  { title: "Downtime Heatmap", url: "/dashboard/downtime-map", icon: BarChart3, roles: ["admin", "manager", "maintenance_manager"], group: "Maintenance" },
  { title: "PM Intelligence", url: "/dashboard/pm-intelligence", icon: Brain, roles: ["admin", "manager", "maintenance_manager"], group: "Maintenance" },

  // Assets
  { title: "Machines", url: "/dashboard/machines", icon: Cog, roles: ["admin", "manager", "maintenance_manager"], group: "Assets" },
  { title: "Problems", url: "/dashboard/problems", icon: AlertCircle, roles: ["admin", "manager", "maintenance_manager"], group: "Assets" },
  { title: "Stock", url: "/dashboard/stock", icon: Package, roles: ["admin", "manager", "maintenance_manager", "engineer"], group: "Assets" },

  // Production
  { title: "Planner", url: "/dashboard/planner", icon: Factory, roles: ["admin", "manager"], group: "Production" },
  { title: "Production Control", url: "/dashboard/shift-history", icon: History, roles: ["admin", "manager"], group: "Production" },
  { title: "RAG Weekly", url: "/dashboard/rag-weekly", icon: Gauge, roles: ["admin", "manager", "maintenance_manager"], group: "Production" },
  { title: "Performance", url: "/dashboard/production-performance", icon: Gauge, roles: ["admin", "manager"], group: "Production" },
  { title: "Prod. Downtime", url: "/dashboard/production-downtime", icon: TimerOff, roles: ["admin", "manager"], group: "Production" },
  { title: "Quality Actions", url: "/dashboard/quality", icon: AlertTriangle, roles: ["admin", "manager"], group: "Production" },

  // Planning & Insights
  { title: "SKU Products", url: "/dashboard/sku-products", icon: Boxes, roles: ["admin", "manager"], group: "Planning" },
  { title: "SKU Efficiency", url: "/dashboard/sku-efficiency", icon: Trophy, roles: ["admin", "manager"], group: "Planning" },
  { title: "Forecast", url: "/dashboard/forecast", icon: Calculator, roles: ["admin", "manager"], group: "Planning" },
  { title: "Smart Target", url: "/dashboard/smart-target", icon: Brain, roles: ["admin", "manager"], group: "Planning" },

  // Reports
  { title: "Analytics", url: "/dashboard/analytics", icon: BarChart3, roles: ["admin", "manager", "maintenance_manager"], group: "Reports" },
  { title: "Financial", url: "/dashboard/financial", icon: DollarSign, roles: ["admin", "manager", "maintenance_manager"], group: "Reports" },
  { title: "Executive", url: "/dashboard/executive", icon: Briefcase, roles: ["admin"], group: "Reports" },
  { title: "Weekly Report", url: "/dashboard/weekly-report", icon: FileBarChart, roles: ["admin", "manager"], group: "Reports" },

  // Admin
  { title: "Users", url: "/users/manage", icon: Users, roles: ["admin", "manager", "maintenance_manager"], group: "Admin" },
  { title: "Audit Logs", url: "/dashboard/audit-logs", icon: Shield, roles: ["admin"], group: "Admin" },
  { title: "Settings", url: "/dashboard/settings", icon: SettingsIcon, roles: ["admin"], group: "Admin" },
  { title: "iTouching Sync", url: "/dashboard/intouch-settings", icon: Radar, roles: ["admin"], group: "Admin" },
  { title: "Operator Preview", url: "/dashboard/operator-preview", icon: Gauge, roles: ["admin", "manager", "maintenance_manager"], group: "Admin" },
  { title: "Engineer Preview", url: "/dashboard/engineer-preview", icon: Gauge, roles: ["admin", "manager", "maintenance_manager"], group: "Admin" },
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
  const timeShort = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const timeLong = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const date = now.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });
  return (
    <div className="hidden xs:flex sm:flex text-xs sm:text-sm font-mono text-muted-foreground tabular-nums items-center">
      <span className="font-semibold text-foreground sm:hidden">{timeShort}</span>
      <span className="hidden sm:inline font-semibold text-foreground">{timeLong}</span>
      <span className="mx-2 hidden md:inline">—</span>
      <span className="hidden md:inline">{date}</span>
    </div>
  );
}

function SidebarNav({ filteredItems }: { filteredItems: NavItem[] }) {
  const location = useLocation();
  const { state } = useSidebar();
  const iconCollapsed = state === "collapsed";
  const groups = ["Overview", "Maintenance", "Assets", "Production", "Planning", "Reports", "Admin"];
  const grouped = groups.map((g) => ({
    label: g,
    items: filteredItems.filter((i) => i.group === g),
  })).filter((g) => g.items.length > 0);

  const isItemActive = (url: string) => {
    const [path, query = ""] = url.split("?");
    if (location.pathname !== path) return false;
    const itemSearch = query ? `?${query}` : "";
    return (location.search || "") === itemSearch;
  };

  const groupHasActive = (items: NavItem[]) => items.some((i) => isItemActive(i.url));

  // Only one group is open at a time. Default to the group containing the active route,
  // or the first group if none. Operator/engineer with very few items: keep all open.
  const compact = filteredItems.length > 4;
  const activeGroup = grouped.find((g) => groupHasActive(g.items))?.label ?? grouped[0]?.label ?? null;
  const [openGroup, setOpenGroup] = useState<string | null>(activeGroup);

  useEffect(() => {
    const next = grouped.find((g) => groupHasActive(g.items))?.label;
    if (next) setOpenGroup(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, location.search]);

  return (
    <>
      {grouped.map((group) => {
        const isOpen = !compact || iconCollapsed || openGroup === group.label;
        return (
          <SidebarGroup key={group.label} className="px-2">
            {compact && !iconCollapsed && (
              <button
                type="button"
                onClick={() => setOpenGroup((prev) => (prev === group.label ? null : group.label))}
                className="flex w-full items-center justify-between px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/50 hover:text-sidebar-foreground transition-colors"
                aria-expanded={isOpen}
              >
                <span>{group.label}</span>
                <span className={`transition-transform ${isOpen ? "rotate-90" : ""}`}>›</span>
              </button>
            )}
            {isOpen && (
              <SidebarGroupContent>
                <SidebarMenu className="gap-0.5">
                  {group.items.map((item) => {
                    const active = isItemActive(item.url);
                    return (
                      <SidebarMenuItem key={item.title + item.url}>
                        <SidebarMenuButton asChild tooltip={item.title} className="h-9 rounded-md">
                          <NavLink
                            to={item.url}
                            end
                            className={`transition-colors ${active ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium" : "text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"}`}
                          >
                            <item.icon className="h-4 w-4 shrink-0" />
                            <span className="text-sm">{item.title}</span>
                          </NavLink>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            )}
          </SidebarGroup>
        );
      })}
    </>
  );
}




const roleTitle: Record<string, string> = {
  admin: "Admin",
  manager: "Manager",
  engineer: "Engineer",
  operator: "Operator",
  viewer: "Viewer",
};

const roleBadgeClass: Record<string, string> = {
  admin: "bg-red-500/15 text-red-600 border-red-500/30",
  manager: "bg-purple-500/15 text-purple-600 border-purple-500/30",
  engineer: "bg-blue-500/15 text-blue-600 border-blue-500/30",
  operator: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30",
  viewer: "bg-muted text-muted-foreground border-border",
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
  const { language, toggle: toggleLanguage } = useLanguage();
  const [changePwdOpen, setChangePwdOpen] = useState(false);
  const [signOutConfirmOpen, setSignOutConfirmOpen] = useState(false);

  const performSignOut = async () => {
    try {
      await signOut();
    } catch {
      // ignore — proceed to clear session client-side
    } finally {
      window.location.replace("/login");
    }
  };

  useHeartbeat();

  // Engineer/Admin: auto-prompt the "Enable Alerts" gesture on any dashboard
  // route, not only the engineer dashboard. Without this, an engineer who
  // navigates straight to /dashboard/work-orders never unlocks audio and
  // misses the critical-WO siren.
  const { audioEnabled, promptEnableAudio } = useCriticalAlert();
  useEffect(() => {
    if ((role !== "engineer" && role !== "admin") || audioEnabled) return;
    // Once per browser session — sessionStorage clears on tab/window close, so
    // a fresh login still gets prompted, but mid-session route changes don't
    // re-open the modal after the user dismissed it.
    try {
      if (sessionStorage.getItem("an_audio_prompted") === "1") return;
      sessionStorage.setItem("an_audio_prompted", "1");
    } catch { /* sessionStorage unavailable — fall through and prompt */ }
    promptEnableAudio();
  }, [role, audioEnabled, promptEnableAudio]);

  // Browser tab title
  useEffect(() => {
    const pageName = routeTitles[location.pathname] || "Dashboard";
    document.title = `AN Maintenance | ${pageName}`;
  }, [location.pathname]);

  const filteredItems = navItems.filter((item) => role && item.roles.includes(role));
  const showStoppedBadge = stoppedLinesCount > 0 && (role === "engineer" || (role === "manager" || role === "maintenance_manager") || role === "admin");
  const stoppedTarget = role === "engineer" ? "/dashboard/engineer" : "/dashboard/work-orders";

  // Sidebar opens by default on desktop/tablet (≥ md breakpoint). On phones
  // it stays closed and the user opens it via the trigger.
  const defaultSidebarOpen = typeof window !== "undefined" && window.innerWidth >= 1024;
  const currentPageTitle = routeTitles[location.pathname] ?? "";

  return (
    <TooltipProvider delayDuration={0}>
      <SidebarProvider defaultOpen={defaultSidebarOpen} style={{ "--sidebar-width": "13rem", "--sidebar-width-icon": "3rem" } as React.CSSProperties}>
        <div className="flex h-screen w-full overflow-hidden">
          <Sidebar collapsible="icon" className="border-r border-sidebar-border print:hidden">

            <div className="border-b border-sidebar-border p-2 group-data-[collapsible=icon]:p-1">
              <img
                src={appliedLogo}
                alt="Applied Nutrition"
                className="block w-full h-auto rounded-md object-cover group-data-[collapsible=icon]:hidden"
              />
              <img
                src={appliedLogo}
                alt="AN"
                className="hidden group-data-[collapsible=icon]:block h-8 w-8 mx-auto rounded-md object-cover"
              />
            </div>
            <SidebarContent>
              <SidebarNav filteredItems={filteredItems} />
            </SidebarContent>
            <div className="mt-auto border-t border-sidebar-border p-4 group-data-[collapsible=icon]:p-2">
              <div className="mb-3 flex items-center gap-3 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:mb-2">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sidebar-accent text-sm font-semibold text-sidebar-foreground">
                  {profile?.name?.charAt(0).toUpperCase() || "?"}
                </div>
                <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
                  <div className="truncate text-sm font-medium text-sidebar-foreground">
                    {profile?.name}
                  </div>
                  <div className="truncate text-[11px] uppercase tracking-wider text-sidebar-foreground/50">
                    {role ? roleTitle[role] : ""}
                  </div>
                </div>
              </div>
              {role !== "operator" && role !== "viewer" && (
                <Button
                  variant="ghost"
                  size="sm"
                  title="Change Password"
                  className="w-full justify-start text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0 mb-1"
                  onClick={() => setChangePwdOpen(true)}
                >
                  <KeyRound className="h-4 w-4 group-data-[collapsible=icon]:mr-0 mr-2" />
                  <span className="group-data-[collapsible=icon]:hidden">Change Password</span>
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                title="Sign Out"
                className="w-full justify-start text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
                onClick={() => {
                  if (role === "operator") {
                    setSignOutConfirmOpen(true);
                  } else {
                    void performSignOut();
                  }
                }}
              >
                <LogOut className="h-4 w-4 group-data-[collapsible=icon]:mr-0 mr-2" />
                <span className="group-data-[collapsible=icon]:hidden">Sign Out</span>
              </Button>
            </div>
          </Sidebar>

          <main className="flex-1 flex flex-col overflow-hidden min-w-0">
            <header className="h-14 border-b bg-card flex items-center px-2 sm:px-4 gap-2 sm:gap-3 print:hidden">
              <SidebarTrigger aria-label="Toggle menu" className="shrink-0" />
              {currentPageTitle && (
                <h1 className="hidden sm:block text-sm font-semibold text-foreground truncate" aria-live="polite">
                  {currentPageTitle}
                </h1>
              )}
              {(role === "admin" || (role === "manager" || role === "maintenance_manager")) && (
                <div className="ml-1 sm:ml-2 hidden md:block">
                  <OnlineEngineersPanel />
                </div>
              )}
              <div className="ml-auto flex items-center gap-1 sm:gap-2 min-w-0">
                {showStoppedBadge && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => navigate(stoppedTarget)}
                    className="bg-destructive hover:bg-destructive/90 text-destructive-foreground animate-pulse gap-1.5 h-9 px-2 sm:px-3"
                    aria-label={`${stoppedLinesCount} production lines currently stopped`}
                  >
                    <PowerOff className="h-4 w-4" />
                    <span className="font-bold">{stoppedLinesCount}</span>
                    <span className="hidden sm:inline text-xs">line{stoppedLinesCount > 1 ? "s" : ""} stopped</span>
                  </Button>
                )}
                {(role === "engineer" || role === "admin") && <AudioStatusButton />}
                <NotificationPanel />
                {/* Language toggle removed by request — app stays in English. */}
                <Button variant="ghost" size="icon" onClick={toggleDark} title={dark ? "Light mode" : "Dark mode"} className="shrink-0">
                  {dark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
                </Button>
                {role && (
                  <span
                    className={`hidden sm:inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${roleBadgeClass[role] ?? "bg-muted text-muted-foreground"}`}
                    aria-label={`Current role: ${roleTitle[role]}`}
                  >
                    {roleTitle[role]}
                  </span>
                )}
                <LiveClock />
              </div>
            </header>
            {!isOnline && (
              <div className="bg-destructive text-destructive-foreground text-center text-sm py-1 px-4 font-medium">
                ⚠️ You are offline — changes will sync when connection is restored
              </div>
            )}
            <div className="flex-1 overflow-y-auto overflow-x-hidden p-3 sm:p-4 md:p-6 min-w-0">
              <div className="min-w-0 w-full">{children}</div>
            </div>

          </main>
        </div>
        <ChangePasswordDialog open={changePwdOpen} onOpenChange={setChangePwdOpen} />
        <AlertDialog open={signOutConfirmOpen} onOpenChange={setSignOutConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Sign out?</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to sign out? You will need to ask your supervisor for the password to log in again.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => void performSignOut()}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Yes, sign out
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SidebarProvider>
    </TooltipProvider>
  );
}
