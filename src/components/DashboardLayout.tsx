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
import { ClipboardList, Users, Package, LogOut, LayoutDashboard, BarChart3, Cog, AlertCircle, Shield, ShieldCheck, Monitor, DollarSign, Briefcase, Sun, Moon, Clock, PowerOff, KeyRound, Settings as SettingsIcon, Factory, Boxes, History, Gauge, FileBarChart, AlertTriangle, Trophy, Calculator, Brain, Radar, MessageCircle, PanelLeftClose, PanelLeftOpen } from "lucide-react";
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
import { can, canForDevice, subscribePermissionOverrides, subscribeMobileHidden, ALL_ROLES, ALL_ACTIONS, isPermissionOverridden, type Action } from "@/lib/permissions";
import { useIsMobile } from "@/hooks/use-mobile";
import { useDeviceType } from "@/hooks/use-device-type";
import { MobileTabBar } from "@/components/MobileTabBar";
import { cn } from "@/lib/utils";
import { PushOnboarding } from "@/components/PushOnboarding";
import { AudioStatusButton } from "@/components/AudioStatusButton";
import { useCriticalAlert } from "@/contexts/CriticalAlertContext";
import { useHeartbeat } from "@/hooks/useHeartbeat";
import { useOfflineDetection } from "@/hooks/useOfflineQueue";
import { useStoppedLinesCount } from "@/hooks/useStoppedLinesCount";
import { useLanguage } from "@/contexts/LanguageContext";
import { useDMUnreadCount, unlockDMAudio } from "@/hooks/useDirectMessages";
import type { Database } from "@/integrations/supabase/types";

type AppRole = Database["public"]["Enums"]["app_role"];

export interface NavItem {
  title: string;
  url: string;
  icon: React.ComponentType<{ className?: string }>;
  roles: AppRole[];
  group: string;
  action?: Action;
}

export const navItems: NavItem[] = [
  // Overview
  { title: "Dashboard", url: "/dashboard/operator", icon: LayoutDashboard, roles: ["operator"], group: "Overview", action: "dashboard.operator" },
  { title: "My Production", url: "/dashboard/operator/my-production", icon: Factory, roles: ["operator"], group: "Overview", action: "production.target.view" },
  { title: "Dashboard", url: "/dashboard/engineer", icon: LayoutDashboard, roles: ["engineer", "co_engineer"], group: "Overview", action: "dashboard.engineer" },
  { title: "My Tasks", url: "/dashboard/engineer?focus=tasks", icon: Briefcase, roles: ["engineer", "co_engineer"], group: "Overview", action: "dashboard.engineer" },
  { title: "History", url: "/dashboard/engineer?focus=history", icon: History, roles: ["engineer", "co_engineer"], group: "Overview", action: "dashboard.engineer" },
  { title: "Dashboard", url: "/dashboard/manager", icon: LayoutDashboard, roles: ["admin", "manager", "supervisor", "maintenance_manager", "planner"], group: "Overview", action: "dashboard.manager" },
  { title: "Dashboard", url: "/dashboard/warehouse", icon: LayoutDashboard, roles: ["warehouse"], group: "Overview" },
  { title: "Control Center", url: "/dashboard/control-center", icon: Monitor, roles: ["admin", "manager", "maintenance_manager", "supervisor"], group: "Overview", action: "controlcenter.view" },


  // Maintenance
  { title: "Work Orders", url: "/dashboard/work-orders", icon: ClipboardList, roles: ["admin", "manager", "supervisor", "maintenance_manager", "planner"], group: "Maintenance", action: "wo.view" },
  { title: "Service Requests", url: "/dashboard/warehouse", icon: ClipboardList, roles: ["warehouse"], group: "Maintenance", action: "wo.view" },
  { title: "Downtime & Reliability", url: "/dashboard/downtime", icon: Clock, roles: ["admin", "manager", "supervisor", "maintenance_manager", "planner"], group: "Maintenance", action: "downtime.view" },
  { title: "PM Intelligence", url: "/dashboard/pm-intelligence", icon: Brain, roles: ["admin", "manager", "supervisor", "maintenance_manager", "planner"], group: "Maintenance", action: "pm.view" },

  // Assets
  { title: "Machines", url: "/dashboard/machines", icon: Cog, roles: ["admin", "manager", "supervisor", "maintenance_manager", "planner", "warehouse"], group: "Assets", action: "machines.view" },
  { title: "Problems", url: "/dashboard/problems", icon: AlertCircle, roles: ["admin", "manager", "supervisor", "maintenance_manager", "planner"], group: "Assets", action: "problems.view" },
  { title: "Stock", url: "/dashboard/stock", icon: Package, roles: ["admin", "manager", "supervisor", "maintenance_manager", "planner", "engineer", "co_engineer"], group: "Assets", action: "stock.view" },

  // Production
  { title: "Production Control", url: "/dashboard/shift-history", icon: History, roles: ["admin", "manager", "supervisor"], group: "Production", action: "production.manage" },
  { title: "RAG Weekly", url: "/dashboard/rag-weekly", icon: Gauge, roles: ["admin", "manager", "supervisor", "maintenance_manager", "planner"], group: "Production", action: "rag.view" },
  { title: "Performance", url: "/dashboard/production-performance", icon: Gauge, roles: ["admin", "manager", "supervisor"], group: "Production", action: "production.performance.view" },
  { title: "SKU Performance", url: "/dashboard/sku-performance", icon: Gauge, roles: ["admin", "manager", "supervisor"], group: "Production", action: "production.sku_performance.view" },

  { title: "SKU Products", url: "/dashboard/sku-products", icon: Boxes, roles: ["admin", "manager"], group: "Production", action: "sku.manage" },
  { title: "Quality", url: "/dashboard/quality", icon: AlertTriangle, roles: ["admin", "manager", "supervisor", "quality_supervisor"], group: "Production", action: "quality.view" },
  { title: "Packaging", url: "/dashboard/packaging", icon: Boxes, roles: ["admin", "manager", "supervisor", "quality_supervisor", "planner", "warehouse"], group: "Production", action: "production.view" },

  // Reports
  { title: "Analytics", url: "/dashboard/analytics", icon: BarChart3, roles: ["admin", "manager", "supervisor"], group: "Reports", action: "reports.analytics" },

  // Communication
  { title: "Messages", url: "/dashboard/messages", icon: MessageCircle, roles: ["admin", "manager", "supervisor", "maintenance_manager", "planner", "operator", "warehouse"], group: "Communication", action: "chat.dm" },

  // Administration
  { title: "Users", url: "/users/manage", icon: Users, roles: ["admin", "manager"], group: "Administration", action: "users.manage" },
  { title: "Audit Logs", url: "/dashboard/audit-logs", icon: Shield, roles: ["admin"], group: "Administration", action: "audit.view" },

  // System — Permissions is reached from inside Settings (avoids the duplicate entry).
  { title: "Settings", url: "/dashboard/settings", icon: SettingsIcon, roles: ["admin"], group: "System", action: "system.settings" },
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

const SIDEBAR_STORAGE_KEY = "an_sidebar_open";

function readSavedSidebarPreference(): boolean | null {
  if (typeof document === "undefined") return null;
  try {
    const ls = window.localStorage.getItem(SIDEBAR_STORAGE_KEY);
    if (ls === "true") return true;
    if (ls === "false") return false;
  } catch { /* ignore */ }
  const m = document.cookie.match(/(?:^|;\s*)sidebar:state=(true|false)/);
  if (m) return m[1] === "true";
  return null;
}

function SidebarFooterToggle() {
  const { state, toggleSidebar, isMobile } = useSidebar();
  if (isMobile) return null;
  const collapsed = state === "collapsed";
  return (
    <Button
      variant="ghost"
      size="sm"
      title={collapsed ? "Expand menu" : "Collapse menu"}
      aria-label={collapsed ? "Expand menu" : "Collapse menu"}
      className="w-full justify-start text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0 mb-1"
      onClick={toggleSidebar}
    >
      {collapsed ? (
        <PanelLeftOpen className="h-4 w-4 group-data-[collapsible=icon]:mr-0 mr-2" />
      ) : (
        <PanelLeftClose className="h-4 w-4 group-data-[collapsible=icon]:mr-0 mr-2" />
      )}
      <span className="group-data-[collapsible=icon]:hidden">
        {collapsed ? "Expand menu" : "Collapse menu"}
      </span>
    </Button>
  );
}

function SidebarNav({ filteredItems, permissionOverrideCount, dmUnread }: { filteredItems: NavItem[]; permissionOverrideCount: number; dmUnread: number }) {
  const location = useLocation();
  const { state } = useSidebar();
  const iconCollapsed = state === "collapsed";
  const groups = ["Overview", "Maintenance", "Assets", "Production", "Planning", "Reports", "Communication", "Administration", "System"];
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
                        <SidebarMenuButton
                          asChild
                          tooltip={item.title}
                          className={cn(
                            "h-9 rounded-md transition-colors",
                            "group-data-[collapsible=icon]:h-10 group-data-[collapsible=icon]:w-10",
                            "group-data-[collapsible=icon]:mx-auto group-data-[collapsible=icon]:!p-0",
                            "group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:rounded-lg",
                          )}
                        >
                          <NavLink
                            to={item.url}
                            end
                            className={cn(
                              "transition-colors",
                              active
                                ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium ring-1 ring-sidebar-border/60 shadow-sm"
                                : "text-sidebar-foreground/75 hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground",
                            )}
                          >
                            <item.icon className="h-4 w-4 shrink-0 group-data-[collapsible=icon]:h-[18px] group-data-[collapsible=icon]:w-[18px]" />
                            <span className="text-sm group-data-[collapsible=icon]:hidden">{item.title}</span>
                            {item.title === "Permissions" && permissionOverrideCount > 0 && (
                              <span className="ml-auto rounded-full bg-primary/10 px-1.5 py-0 text-[10px] font-medium text-primary group-data-[collapsible=icon]:hidden">
                                {permissionOverrideCount} custom
                              </span>
                            )}
                            {item.title === "Messages" && dmUnread > 0 && (
                              <>
                                <span className="ml-auto rounded-full bg-destructive px-1.5 py-0 text-[10px] font-semibold text-white min-w-[18px] text-center group-data-[collapsible=icon]:hidden">
                                  {dmUnread > 9 ? "9+" : dmUnread}
                                </span>
                                <span
                                  className="hidden group-data-[collapsible=icon]:block absolute top-1 right-1 h-2 w-2 rounded-full bg-destructive ring-2 ring-sidebar"
                                  aria-hidden="true"
                                />
                              </>
                            )}
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
  supervisor: "Supervisor",
  maintenance_manager: "Maintenance Manager",
  planner: "Planner",
  engineer: "Engineer",
  co_engineer: "Co-Engineer",
  operator: "Operator",
  viewer: "Viewer",
  warehouse: "Warehouse Admin",
};

const roleBadgeClass: Record<string, string> = {
  admin: "bg-red-500/15 text-red-600 border-red-500/30",
  manager: "bg-purple-500/15 text-purple-600 border-purple-500/30",
  supervisor: "bg-amber-500/15 text-amber-600 border-amber-500/30",
  maintenance_manager: "bg-purple-500/15 text-purple-600 border-purple-500/30",
  planner: "bg-teal-500/15 text-teal-600 border-teal-500/30",
  engineer: "bg-blue-500/15 text-blue-600 border-blue-500/30",
  co_engineer: "bg-blue-500/15 text-blue-600 border-blue-500/30",
  operator: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30",
  viewer: "bg-muted text-muted-foreground border-border",
  warehouse: "bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30",
};

const routeTitles: Record<string, string> = {
  "/dashboard/operator": "Dashboard",
  "/dashboard/operator/my-production": "My Production",
  "/dashboard/engineer": "Dashboard",
  "/dashboard/manager": "Dashboard",
  "/dashboard/work-orders": "Work Orders",
  "/dashboard/downtime": "Downtime",
  "/dashboard/downtime-map": "Downtime Heatmap",
  "/dashboard/pm-intelligence": "PM Intelligence",
  "/dashboard/control-center": "Control Center",
  "/dashboard/preventive": "Preventive Maintenance",
  "/dashboard/warehouse": "Warehouse",
  "/dashboard/machines": "Machines",
  "/dashboard/problems": "Problems",
  "/dashboard/stock": "Stock",
  "/dashboard/shift-history": "Production Control",
  "/dashboard/rag-weekly": "RAG Weekly",
  "/dashboard/production-performance": "Performance",
  "/dashboard/sku-performance": "SKU Performance",
  
  "/dashboard/quality": "Quality",
  "/dashboard/packaging": "Packaging",
  "/dashboard/sku-products": "SKU Products",
  "/dashboard/analytics": "Analytics",
  "/dashboard/reliability": "Reliability Dashboard",
  "/dashboard/suppliers": "Suppliers & Purchasing",
  "/dashboard/messages": "Messages",
  "/users/manage": "Users",
  "/dashboard/permissions": "Permissions",
  "/dashboard/audit-logs": "Audit Logs",
  "/dashboard/settings": "Settings",
  "/dashboard/intouch-settings": "iTouching Sync",
};

export function DashboardLayout({ children }: { children: ReactNode }) {
  const { role, profile, signOut } = useAuth();
  const { dark, toggle: toggleDark } = useDarkMode();
  const location = useLocation();
  const navigate = useNavigate();
  const { isOnline } = useOfflineDetection();
  const { data: stoppedLinesCount = 0 } = useStoppedLinesCount();
  const { language, toggle: toggleLanguage } = useLanguage();
  const { data: dmUnread = 0 } = useDMUnreadCount();
  const [changePwdOpen, setChangePwdOpen] = useState(false);
  const [signOutConfirmOpen, setSignOutConfirmOpen] = useState(false);
  const [permissionVersion, setPermissionVersion] = useState(0);

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

  useEffect(() => {
    const a = subscribePermissionOverrides(() => setPermissionVersion((v) => v + 1));
    const b = subscribeMobileHidden(() => setPermissionVersion((v) => v + 1));
    return () => { a(); b(); };
  }, []);

  useEffect(() => {
    const unlock = () => unlockDMAudio();
    const opts = { once: true } as AddEventListenerOptions;
    window.addEventListener("pointerdown", unlock, opts);
    window.addEventListener("touchstart", unlock, opts);
    window.addEventListener("keydown", unlock, opts);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("touchstart", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  // Engineer/Admin: auto-prompt the "Enable Alerts" gesture on any dashboard
  // route, not only the engineer dashboard. Without this, an engineer who
  // navigates straight to /dashboard/work-orders never unlocks audio and
  // misses the critical-WO siren.
  const { audioEnabled, promptEnableAudio } = useCriticalAlert();
  // co_engineer inherits engineer's UI (nav items, audio unlock prompt, etc.)
  const effectiveRole = role === "co_engineer" ? "engineer" : role;
  useEffect(() => {
    if ((effectiveRole !== "engineer" && effectiveRole !== "admin") || audioEnabled) return;
    try {
      if (sessionStorage.getItem("an_audio_prompted") === "1") return;
      sessionStorage.setItem("an_audio_prompted", "1");
    } catch { /* sessionStorage unavailable — fall through and prompt */ }
    promptEnableAudio();
  }, [effectiveRole, audioEnabled, promptEnableAudio]);

  // Browser tab title
  useEffect(() => {
    const pageName = routeTitles[location.pathname] || "Dashboard";
    document.title = `AN Maintenance | ${pageName}`;
  }, [location.pathname]);

  const isMobile = useIsMobile();
  const device = useDeviceType();
  const filteredItems = navItems.filter(
    (item) =>
      effectiveRole &&
      item.roles.includes(effectiveRole as AppRole) &&
      // Respect per-role, per-device visibility (Desktop / Tablet / Mobile).
      (!item.action || canForDevice(effectiveRole as AppRole, item.action, device)),
  );
  const permissionOverrideCount = ALL_ROLES.reduce(
    (sum, role) => sum + ALL_ACTIONS.filter((action) => isPermissionOverridden(role, action)).length,
    0,
  );
  const showStoppedBadge = stoppedLinesCount > 0 && (effectiveRole === "engineer" || effectiveRole === "manager" || effectiveRole === "maintenance_manager" || effectiveRole === "admin");
  const stoppedTarget = effectiveRole === "engineer" ? "/dashboard/engineer" : "/dashboard/work-orders";

  // Sidebar honours the user's saved preference (cookie / localStorage) first,
  // then falls back to desktop width (≥1024). Tablet & phones stay collapsed
  // by default so content isn't clipped in narrow viewports.
  const savedSidebarPref = readSavedSidebarPreference();
  const defaultSidebarOpen =
    savedSidebarPref !== null
      ? savedSidebarPref
      : typeof window !== "undefined" && window.innerWidth >= 1024;
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(defaultSidebarOpen);
  const currentPageTitle = routeTitles[location.pathname] ?? "";

  const handleSidebarOpenChange = (open: boolean) => {
    setSidebarOpen(open);
    try { window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(open)); } catch { /* ignore */ }
  };

  return (
    <TooltipProvider delayDuration={0}>
      <SidebarProvider
        open={sidebarOpen}
        onOpenChange={handleSidebarOpenChange}
        style={{ "--sidebar-width": "13rem", "--sidebar-width-icon": "3rem" } as React.CSSProperties}
      >
        <div className="flex h-screen w-full overflow-hidden">
          <Sidebar collapsible="icon" className="border-r border-sidebar-border print:hidden">

            <div className="border-b border-sidebar-border p-2 group-data-[collapsible=icon]:p-2 group-data-[collapsible=icon]:flex group-data-[collapsible=icon]:justify-center">
              <img
                src={appliedLogo}
                alt="Applied Nutrition"
                className="block w-full h-auto rounded-md object-cover group-data-[collapsible=icon]:hidden"
              />
              <div className="hidden group-data-[collapsible=icon]:flex h-9 w-9 items-center justify-center rounded-lg bg-sidebar-accent/40 ring-1 ring-sidebar-border/60 overflow-hidden">
                <img src={appliedLogo} alt="AN" className="h-full w-full object-cover" />
              </div>
            </div>

            <SidebarContent>
              <SidebarNav filteredItems={filteredItems} permissionOverrideCount={permissionOverrideCount} dmUnread={dmUnread} />
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
              <SidebarFooterToggle />
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
            <header className="min-h-14 border-b bg-card flex flex-wrap items-center px-2 sm:px-4 py-1.5 gap-2 sm:gap-3 print:hidden">
              <SidebarTrigger aria-label="Toggle menu" className="shrink-0" />
              {isMobile && (
                <div className="flex items-center gap-1.5">
                  <img src={appliedLogo} alt="AN" className="h-7 w-7 rounded-md object-cover" />
                  <span className="text-sm font-bold text-foreground">AN System</span>
                </div>
              )}
              {currentPageTitle && (
                <nav aria-label="Breadcrumb" className="hidden sm:flex items-center gap-1.5 text-sm min-w-0">
                  <span className="text-muted-foreground">Home</span>
                  <span className="text-muted-foreground/60">/</span>
                  <span className="font-semibold text-foreground truncate" aria-current="page" aria-live="polite">
                    {currentPageTitle}
                  </span>
                </nav>
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
                {(effectiveRole === "engineer" || effectiveRole === "admin") && <AudioStatusButton />}
                
                <NotificationPanel />
                <PushOnboarding />
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
            <div className={cn("flex-1 overflow-y-auto overflow-x-hidden p-3 sm:p-4 md:p-6 min-w-0", isMobile && "pb-24")}>
              <div className="min-w-0 w-full">{children}</div>
            </div>

            {isMobile && <MobileTabBar tabs={filteredItems.slice(0, 3)} />}
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
