import { ReactNode, useState, useEffect } from "react";
import { awaitingResumeSummary } from "@/lib/awaitingResume";
import { useAuth } from "@/contexts/AuthContext";
import { NavLink } from "@/components/NavLink";
import { getCurrentFactoryShift, SHIFT_LABEL } from "@/lib/shifts";
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
import { ClipboardList, Users, UsersRound, Package, LogOut, LayoutDashboard, BarChart3, Cog, AlertCircle, Shield, ShieldCheck, Monitor, DollarSign, Sun, Moon, Clock, PowerOff, Settings as SettingsIcon, Factory, Boxes, History, Gauge, FileBarChart, AlertTriangle, Trophy, Calculator, Brain, Radar, Radio, MessageCircle, Menu, CalendarDays, TrendingUp } from "lucide-react";
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
import { InstallPrompt } from "@/components/InstallPrompt";
import { AudioStatusButton } from "@/components/AudioStatusButton";
import { useCriticalAlert } from "@/contexts/CriticalAlertContext";
import { useHeartbeat } from "@/hooks/useHeartbeat";
import { useOfflineDetection } from "@/hooks/useOfflineQueue";
import { useStoppedLinesCount } from "@/hooks/useStoppedLinesCount";
import { BackButton } from "@/components/BackButton";
import { useLanguage } from "@/contexts/LanguageContext";
import { useDMUnreadCount, unlockDMAudio } from "@/hooks/useDirectMessages";
import { useTelemetryCrashCount } from "@/hooks/useTelemetryBadge";
import type { Database } from "@/integrations/supabase/types";

type AppRole = Database["public"]["Enums"]["app_role"];

export interface NavItem {
  title: string;
  /**
   * What the row is called on the phone's bottom bar, where the sidebar's width is
   * not available: each label is capped at 68px and truncated, which holds about
   * eleven characters. Without it a row renders as "My Produc…" or "Control Cent…" —
   * an ellipsis where the distinguishing word was. Omit it when the title already fits.
   */
  shortTitle?: string;
  url: string;
  icon: React.ComponentType<{ className?: string }>;
  roles: AppRole[];
  group: string;
  action?: Action;
}

export const navItems: NavItem[] = [
  // Overview
  { title: "Operator Panel", shortTitle: "Panel", url: "/dashboard/operator", icon: LayoutDashboard, roles: ["operator"], group: "Overview", action: "dashboard.operator" },
  { title: "My Production", shortTitle: "Production", url: "/dashboard/operator/my-production", icon: Factory, roles: ["operator"], group: "Overview", action: "production.target.view" },
  // "My Scorecard" used to sit here, third so it landed in the phone's bottom bar.
  // The operator's screen no longer offers it at all — neither here nor as a tile on
  // the line hub. /dashboard/leader/scorecard still exists and still asks for the PIN;
  // it just has no link pointing at it from the tablet.
  { title: "Dashboard", url: "/dashboard/engineer", icon: LayoutDashboard, roles: ["engineer", "co_engineer"], group: "Overview", action: "dashboard.engineer" },
  // "My Tasks" and "History" used to sit here as separate entries. Both opened the
  // same page as Dashboard and only scrolled to a section of it, so the menu offered
  // three doors into one room — and clicking Dashboard from either of them appeared to
  // do nothing, because the page was already open.
  { title: "Dashboard", url: "/dashboard/manager", icon: LayoutDashboard, roles: ["admin", "manager", "supervisor", "maintenance_manager", "planner"], group: "Overview", action: "dashboard.manager" },
  { title: "Dashboard", url: "/dashboard/warehouse", icon: LayoutDashboard, roles: ["warehouse"], group: "Overview" },
  { title: "Control Center", shortTitle: "Control", url: "/dashboard/control-center", icon: Monitor, roles: ["admin", "manager", "maintenance_manager", "supervisor", "production_office_admin"], group: "Overview", action: "controlcenter.view" },


  // Maintenance
  { title: "Maintenance Orders", shortTitle: "Orders", url: "/dashboard/work-orders", icon: ClipboardList, roles: ["admin", "manager", "supervisor", "maintenance_manager", "planner", "production_office_admin"], group: "Maintenance", action: "wo.view" },
  { title: "Service Requests", shortTitle: "Requests", url: "/dashboard/warehouse", icon: ClipboardList, roles: ["warehouse"], group: "Maintenance", action: "wo.view" },
  { title: "Downtime & Reliability", shortTitle: "Downtime", url: "/dashboard/downtime", icon: Clock, roles: ["admin", "manager", "supervisor", "maintenance_manager", "planner", "production_office_admin"], group: "Maintenance", action: "downtime.view" },
  { title: "PM Intelligence", url: "/dashboard/pm-intelligence", icon: Brain, roles: ["admin", "manager", "supervisor", "maintenance_manager", "planner", "production_office_admin"], group: "Maintenance", action: "pm.view" },

  // Assets
  { title: "Machines", url: "/dashboard/machines", icon: Cog, roles: ["admin", "manager", "supervisor", "maintenance_manager", "planner", "warehouse", "production_office_admin"], group: "Maintenance", action: "machines.view" },
  { title: "Problems", url: "/dashboard/problems", icon: AlertCircle, roles: ["admin", "manager", "supervisor", "maintenance_manager", "planner", "production_office_admin"], group: "Maintenance", action: "problems.view" },
  { title: "Stock", url: "/dashboard/stock", icon: Package, roles: ["admin", "manager", "supervisor", "maintenance_manager", "planner", "engineer", "co_engineer", "production_office_admin"], group: "Maintenance", action: "stock.view" },

  // Production. The order is the group's argument, and the sidebar renders these in
  // array order, so it is written here rather than left to whoever appends next:
  // the reviews first (RAG Weekly, Performance — how the week and the lines went),
  // then what the lines run (SKU Products), then the shift's own record (Production
  // Control), then the exception it raised (Quality), and last the people behind it
  // (Headcount, the only admin-only row here). Reading down goes from the week to
  // the shift to what went wrong, which is the order the questions are asked in.
  // It was previously Production Control, RAG Weekly, Performance, SKU Products,
  // Quality — with Headcount declared sixty lines below among the admin screens, so
  // it landed last with nothing near it to say why.
  { title: "RAG Weekly", url: "/dashboard/rag-weekly", icon: Gauge, roles: ["admin", "manager", "supervisor", "maintenance_manager", "planner", "production_office_admin"], group: "Production", action: "rag.view" },
  // The leader scorecard has no row of its own: it is opened from Performance, on
  // the leader the page is already filtered to, so the week and the shift travel
  // with the link. A menu row would have opened it on nobody in particular.
  // Performance carried Gauge as well, so two adjacent rows opened with the same
  // icon and the icon column stopped telling the two apart. RAG Weekly keeps the
  // dial — it IS a red/amber/green reading; Performance is a trend against target.
  { title: "Performance", url: "/dashboard/production-performance", icon: TrendingUp, roles: ["admin", "manager", "supervisor", "production_office_admin"], group: "Production", action: "production.performance.view" },
  { title: "SKU Products", url: "/dashboard/sku-products", icon: Boxes, roles: ["admin", "manager", "supervisor", "production_office_admin"], group: "Production", action: "sku.manage" },
  { title: "Production Control", url: "/dashboard/shift-history", icon: History, roles: ["admin", "manager", "supervisor", "production_office_admin"], group: "Production", action: "production.manage" },
  { title: "Quality", url: "/dashboard/quality", icon: AlertTriangle, roles: ["admin", "manager", "supervisor", "quality_supervisor", "production_office_admin"], group: "Production", action: "quality.view" },
  // Headcount is the way in to all four workforce screens. Leave, Attendance and
  // Finance Close are reached from the tab bar on the board rather than from here:
  // they are one job seen from four angles, and four menu rows said they were four
  // jobs.
  //
  // The older Workforce board stays OFF the menu: seventeen people have no shift
  // pattern and fourteen no department, so it would be read as the rota when it is
  // still an import. The route, the screen, the hooks and the data all remain —
  // /dashboard/workforce still opens for an admin who types it.
  { title: "Headcount", url: "/dashboard/headcount", icon: UsersRound, roles: ["admin"], group: "Production", action: "headcount.view" },

  // Analytics and Messages sit in Overview rather than each holding a group of its
  // own. The argument that dissolved Assets applies harder to a group of one: a
  // heading over a single row costs a line of sidebar and a beat of reading, and
  // returns nothing. For an admin that is two fewer headings over the same 17 links.
  // Reports first: it is the one screen that answers "how did the day/week/month go"
  // without opening four others, and it links through to each of them on the same
  // period. Analytics stays for the question it actually answers — digging, not
  // reporting.
  { title: "Reports", url: "/dashboard/reports", icon: FileBarChart, roles: ["admin", "manager", "supervisor", "production_office_admin"], group: "Overview", action: "reports.analytics" },
  { title: "Analytics", url: "/dashboard/analytics", icon: BarChart3, roles: ["admin", "manager", "supervisor", "production_office_admin"], group: "Overview", action: "reports.analytics" },

  { title: "Messages", url: "/dashboard/messages", icon: MessageCircle, roles: ["admin", "manager", "supervisor", "operator"], group: "Overview", action: "chat.dm" },

  // Administration — who can do what. Everything that configures the system itself
  // (the audit trail, the iTouching integration) lives under System.
  //
  // Setup, integrations and the audit trail, behind one door.
  //
  // These eight were eight sidebar rows — a third of the menu — for screens somebody
  // opens when something needs configuring, not screens they work in. They pushed the
  // daily work down past the fold, which is backwards: a menu should be shortest for
  // what is used most.
  //
  // The hub also does what the sidebar could not, which is say what each one is for.
  // "iTouching Stop Codes" gives away nothing about deciding which alarms call out an
  // engineer, and that decision is exactly why WO-639 and WO-640 were ever raised.
  //
  // Every route still exists and is still reachable directly; only the way in moved.
  { title: "System", url: "/dashboard/system", icon: SettingsIcon, roles: ["admin"], group: "System" },

  // Users stays in the sidebar for managers, who can reach it but have no business
  // in the rest of the hub. Folding it in would have cost them the link or given
  // them the audit trail and the integration settings to go with it.
  { title: "Users", url: "/users/manage", icon: Users, roles: ["manager"], group: "Administration", action: "users.manage" },
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
    <div className="hidden xs:flex sm:flex text-xs sm:text-sm font-figure text-muted-foreground items-center">
      <span className="font-semibold text-foreground sm:hidden">{timeShort}</span>
      <span className="hidden sm:inline font-semibold text-foreground">{timeLong}</span>
      <span className="mx-2 hidden md:inline">—</span>
      <span className="hidden md:inline">{date}</span>
      {/* The shift used to live in the greeting banner on every landing screen. The
          banner is gone; this is the one fact in it that was not already here, and
          on a system where a night starting Monday is filed under Monday, knowing
          which shift you are looking at is not decoration. */}
      <span className="ml-2 hidden rounded bg-muted px-1.5 py-0.5 text-2xs font-semibold uppercase tracking-wider lg:inline">
        {SHIFT_LABEL[getCurrentFactoryShift().shiftCode]}
      </span>
    </div>
  );
}

const SIDEBAR_STORAGE_KEY = "an_sidebar_open";
const SIDEBAR_STATE_KEY = "an_sidebar_state";

/** Expanded (full menu) -> Rail (icons only) -> Hidden (off-canvas). */
type SidebarUiState = "expanded" | "rail" | "hidden";

function readSavedSidebarState(): SidebarUiState | null {
  if (typeof window === "undefined") return null;
  try {
    const v = window.localStorage.getItem(SIDEBAR_STATE_KEY);
    if (v === "expanded" || v === "rail" || v === "hidden") return v;
  } catch { /* ignore */ }
  return null;
}

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

// SidebarFooterToggle lived here. The sidebar still collapses — the rail on its edge
// and the panel button in the header both do it — so a third control spending a row
// of the menu to say so was one too many.

function SidebarNav({ filteredItems, permissionOverrideCount, dmUnread, crashCount }: { filteredItems: NavItem[]; permissionOverrideCount: number; dmUnread: number; crashCount: number }) {
  const location = useLocation();
  const { state } = useSidebar();
  const iconCollapsed = state === "collapsed";
  // Assets folded into Maintenance. Machines, Problems and Stock are what maintenance
  // works on — three items in a group of their own bought a heading and a click for
  // nothing, and on a laptop the sidebar ran past the fold.
  // Reports and Communication held one item each and are gone with them. The names
  // stay in the list so an item still carrying the old group is rendered rather than
  // silently dropped from the menu.
  const groups = ["Overview", "Maintenance", "Production", "Planning", "Reports", "Communication", "Administration", "System"];
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
                className="flex w-full items-center justify-between px-2 py-1.5 text-2xs font-semibold uppercase tracking-wider text-sidebar-foreground/50 hover:text-sidebar-foreground transition-colors"
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
                              <span className="ml-auto rounded-full bg-primary/10 px-1.5 py-0 text-2xs font-medium text-primary group-data-[collapsible=icon]:hidden">
                                {permissionOverrideCount} custom
                              </span>
                            )}
                            {item.title === "Messages" && dmUnread > 0 && (
                              <>
                                <span className="ml-auto rounded-full bg-destructive px-1.5 py-0 text-2xs font-semibold text-destructive-foreground min-w-[18px] text-center group-data-[collapsible=icon]:hidden">
                                  {dmUnread > 9 ? "9+" : dmUnread}
                                </span>
                                <span
                                  className="hidden group-data-[collapsible=icon]:block absolute top-1 right-1 h-2 w-2 rounded-full bg-destructive ring-2 ring-sidebar"
                                  aria-hidden="true"
                                />
                              </>
                            )}
                            {item.title === "Root Diagnostics" && crashCount > 0 && (
                              <>
                                <span className="ml-auto rounded-full bg-destructive px-1.5 py-0 text-2xs font-semibold text-destructive-foreground min-w-[18px] text-center group-data-[collapsible=icon]:hidden">
                                  {crashCount > 9 ? "9+" : crashCount}
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
  // These two were missing, so `roleTitle[role]` came back undefined and the badge
  // rendered empty — with `aria-label="Current role: undefined"` read out to anybody
  // using a screen reader. Two of the twelve roles had no name anywhere on screen.
  quality_supervisor: "Quality Supervisor",
  production_office_admin: "Production Office",
};

const roleBadgeClass: Record<string, string> = {
  admin: "bg-destructive/15 text-destructive-strong border-destructive/30",
  manager: "bg-purple-500/15 text-purple-600 border-purple-500/30",
  supervisor: "bg-warning/15 text-warning-strong border-warning/30",
  maintenance_manager: "bg-purple-500/15 text-purple-600 border-purple-500/30",
  planner: "bg-success/15 text-success-strong border-success/30",
  engineer: "bg-primary/15 text-primary border-primary/30",
  co_engineer: "bg-primary/15 text-primary border-primary/30",
  operator: "bg-success/15 text-success-strong border-success/30",
  viewer: "bg-muted text-muted-foreground border-border",
  warehouse: "bg-primary/15 text-primary border-primary/30",
  quality_supervisor: "bg-primary/15 text-primary border-primary/30",
  production_office_admin: "bg-primary/15 text-primary border-primary/30",
};

const routeTitles: Record<string, string> = {
  "/dashboard/operator": "Operator Panel",
  "/dashboard/operator/my-production": "My Production",
  "/dashboard/leader/scorecard": "My Scorecard",
  "/dashboard/engineer": "Dashboard",
  "/dashboard/manager": "Dashboard",
  "/dashboard/work-orders": "Maintenance Orders",
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
  
  "/dashboard/quality": "Quality",
  "/dashboard/sku-products": "SKU Products",
  "/dashboard/analytics": "Analytics",
  "/dashboard/reliability": "Reliability Dashboard",
  "/dashboard/suppliers": "Suppliers & Purchasing",
  "/dashboard/messages": "Messages",
  "/users/manage": "Users",
  "/dashboard/permissions": "Permissions",
  "/dashboard/people": "Employee",
  "/dashboard/headcount": "Production Headcount",
  "/dashboard/audit-logs": "Audit Logs",
  "/dashboard/settings": "Settings",
  "/dashboard/intouch-settings": "iTouching Sync",
  "/dashboard/intouch-machines": "iTouching Machines",
  "/dashboard/intouch-stop-codes": "iTouching Stop Codes",
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
  const { data: crashCount = 0 } = useTelemetryCrashCount(role === "admin");
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
    const unlock = () => {
      unlockDMAudio();
      // Ask for OS notification permission once, on a real user gesture, so DM
      // alerts reach the tablet even when the app is backgrounded/unfocused.
      // Nothing requested this before, so permission stayed "default" and native
      // notifications never fired. Never re-prompts once answered.
      try {
        if (typeof Notification !== "undefined" && Notification.permission === "default") {
          const p = Notification.requestPermission();
          if (p && typeof (p as Promise<unknown>).then === "function") (p as Promise<unknown>).catch(() => {});
        }
      } catch { /* ignore */ }
    };
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
  const [sidebarUiState, setSidebarUiState] = useState<SidebarUiState>(
    () => readSavedSidebarState() ?? (defaultSidebarOpen ? "expanded" : "rail"),
  );
  const currentPageTitle = routeTitles[location.pathname] ?? "";

  // Every toggle request (header button, rail, Ctrl/Cmd+B) advances the cycle
  // Expanded -> Rail -> Hidden -> Expanded, so there is a single source of truth.
  const applySidebarState = (next: SidebarUiState) => {
    setSidebarUiState(next);
    const open = next === "expanded";
    setSidebarOpen(open);
    try {
      window.localStorage.setItem(SIDEBAR_STATE_KEY, next);
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(open));
    } catch { /* ignore */ }
  };

  const handleSidebarOpenChange = () => {
    const order: SidebarUiState[] = ["expanded", "rail", "hidden"];
    const next = order[(order.indexOf(sidebarUiState) + 1) % order.length];
    applySidebarState(next);
  };

  return (
    <TooltipProvider delayDuration={0}>
      <SidebarProvider
        open={sidebarOpen}
        onOpenChange={handleSidebarOpenChange}
        style={{ "--sidebar-width": "13rem", "--sidebar-width-icon": "3rem" } as React.CSSProperties}
      >
        <div className="flex h-screen w-full overflow-hidden">
          {sidebarUiState === "hidden" && !isMobile && (
            <Button
              size="icon"
              variant="secondary"
              aria-label="Show menu"
              title="Show menu (Ctrl/Cmd + B)"
              className="fixed left-3 top-3 z-50 h-10 w-10 shadow-lg print:hidden"
              onClick={() => applySidebarState("expanded")}
            >
              <Menu className="h-5 w-5" />
            </Button>
          )}
          <Sidebar collapsible={sidebarUiState === "hidden" ? "offcanvas" : "icon"} className="border-r border-sidebar-border print:hidden">

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
              <SidebarNav filteredItems={filteredItems} permissionOverrideCount={permissionOverrideCount} dmUnread={dmUnread} crashCount={crashCount} />
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
                  <div className="truncate text-2xs uppercase tracking-wider text-sidebar-foreground/50">
                    {role ? roleTitle[role] : ""}
                  </div>
                </div>
              </div>
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
              <SidebarTrigger aria-label="Toggle menu" className="shrink-0 h-11 w-11" />
              {/* Back lives in the shell so every screen has it in the same place —
                  most screens had none at all, and a kiosk tablet has no browser
                  button to fall back on. */}
              <BackButton />
              {isMobile && (
                <div className="flex items-center gap-1.5">
                  <img src={appliedLogo} alt="AN" className="h-7 w-7 rounded-md object-cover" />
                  <span className="hidden sm:inline text-sm font-bold text-foreground">AN System</span>
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
                    aria-label={awaitingResumeSummary(stoppedLinesCount).ariaLabel}
                  >
                    <PowerOff className="h-4 w-4" />
                    <span className="font-bold">{stoppedLinesCount}</span>
                    <span className="hidden sm:inline text-xs">awaiting resume</span>
                  </Button>
                )}
                {(effectiveRole === "engineer" || effectiveRole === "admin") && <AudioStatusButton />}
                
                <NotificationPanel />
                <PushOnboarding />
                <InstallPrompt />
                {/* Language toggle removed by request — app stays in English. */}
                <Button variant="ghost" size="icon" onClick={toggleDark} title={dark ? "Light mode" : "Dark mode"} className="shrink-0">
                  {dark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
                </Button>
                {role && (
                  <span
                    className={`hidden sm:inline-flex items-center rounded-full border px-2 py-0.5 text-2xs font-semibold uppercase tracking-wide ${roleBadgeClass[role] ?? "bg-muted text-muted-foreground"}`}
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
                ⚠️ You are offline — changes won't save until you're back online
              </div>
            )}
            <div className={cn("flex-1 overflow-y-auto overflow-x-hidden p-3 sm:p-4 md:p-6 min-w-0", isMobile && "pb-24")}>
              <div className="min-w-0 w-full">{children}</div>
            </div>

            {isMobile && <MobileTabBar tabs={filteredItems.slice(0, 3)} />}
          </main>
        </div>
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
