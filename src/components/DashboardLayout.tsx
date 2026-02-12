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
} from "@/components/ui/sidebar";
import { ClipboardList, Users, Package, LogOut, LayoutDashboard, BarChart3, Cog, AlertCircle } from "lucide-react";
import appliedLogo from "@/assets/appliedlogo.jpeg";
import { Button } from "@/components/ui/button";
import { OnlineEngineersPanel } from "@/components/OnlineEngineersPanel";
import { useHeartbeat } from "@/hooks/useHeartbeat";
import type { Database } from "@/integrations/supabase/types";

type AppRole = Database["public"]["Enums"]["app_role"];

interface NavItem {
  title: string;
  url: string;
  icon: React.ComponentType<{ className?: string }>;
  roles: AppRole[];
}

const navItems: NavItem[] = [
  { title: "Dashboard", url: "/dashboard/operator", icon: LayoutDashboard, roles: ["operator"] },
  { title: "Dashboard", url: "/dashboard/engineer", icon: LayoutDashboard, roles: ["engineer"] },
  { title: "Dashboard", url: "/dashboard/manager", icon: LayoutDashboard, roles: ["admin"] },
  { title: "Analytics", url: "/dashboard/analytics", icon: BarChart3, roles: ["admin"] },
  { title: "Work Orders", url: "/dashboard/work-orders", icon: ClipboardList, roles: ["admin"] },
  { title: "Machines", url: "/dashboard/machines", icon: Cog, roles: ["admin"] },
  { title: "Problems", url: "/dashboard/problems", icon: AlertCircle, roles: ["admin"] },
  { title: "Stock", url: "/dashboard/stock", icon: Package, roles: ["admin", "engineer"] },
  { title: "Users", url: "/users/manage", icon: Users, roles: ["admin"] },
];

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

export function DashboardLayout({ children }: { children: ReactNode }) {
  const { role, profile, signOut } = useAuth();

  // Engineer heartbeat for online tracking
  useHeartbeat();

  const filteredItems = navItems.filter((item) => role && item.roles.includes(role));

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full">
        <Sidebar className="border-r-0">
          <div className="flex items-center gap-2 px-4 py-4">
            <img src={appliedLogo} alt="Applied Nutrition" className="h-8 w-8 rounded object-contain" />
            <span className="text-lg font-bold text-sidebar-foreground">AN Maintenance</span>
          </div>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel className="text-sidebar-foreground/60">Navigation</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {filteredItems.map((item) => (
                    <SidebarMenuItem key={item.title + item.url}>
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
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
          <div className="mt-auto p-4 border-t border-sidebar-border">
            <div className="text-sm text-sidebar-foreground/70 mb-2 truncate">
              {profile?.name}
            </div>
            <div className="text-xs text-sidebar-foreground/50 mb-3 capitalize">
              {role === "admin" ? "Manager" : role}
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent"
              onClick={signOut}
            >
              <LogOut className="h-4 w-4 mr-2" />
              Sign Out
            </Button>
          </div>
        </Sidebar>

        <main className="flex-1 flex flex-col">
          <header className="h-14 border-b bg-card flex items-center px-4 gap-3">
            <SidebarTrigger />
            <h1 className="text-lg font-semibold text-foreground">
              {role === "admin" ? "Manager" : role === "engineer" ? "Engineer" : "Operator"} Dashboard
            </h1>
            {role === "admin" && (
              <div className="ml-4">
                <OnlineEngineersPanel />
              </div>
            )}
            <div className="ml-auto">
              <LiveClock />
            </div>
          </header>
          <div className="flex-1 p-6">
            {children}
          </div>
        </main>
      </div>
    </SidebarProvider>
  );
}
