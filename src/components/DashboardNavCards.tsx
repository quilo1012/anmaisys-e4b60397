import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/AuthContext";
import {
  ClipboardList, Cog, Users, BarChart3, Briefcase, DollarSign,
  Monitor, Shield, Package, AlertCircle, Clock, LayoutDashboard,
  Plus, Wrench, Radio, Truck, CalendarRange, Boxes, Gauge, CheckSquare,
  History, FileBarChart, Trophy, Radar,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface NavCard {
  title: string;
  description: string;
  url: string;
  icon: LucideIcon;
  badge?: string | number;
  accent?: string;
}

interface Props {
  cards: NavCard[];
}

/**
 * Visual navigation grid for dashboard home pages.
 * Each card links to a section the current role can access.
 */
export function DashboardNavCards({ cards }: Props) {
  const navigate = useNavigate();
  if (!cards.length) return null;

  return (
    <div className="grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((c) => {
        const Icon = c.icon;
        return (
          <Card
            key={c.url}
            onClick={() => navigate(c.url)}
            className="group cursor-pointer transition-all hover:scale-[1.02] hover:shadow-lg hover:border-primary/40"
          >
            <CardContent className="p-4 space-y-3">
              <div className="flex items-start justify-between">
                <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${c.accent ?? "bg-primary/10 text-primary"} transition-colors group-hover:bg-primary group-hover:text-primary-foreground`}>
                  <Icon className="h-5 w-5" />
                </div>
                {c.badge !== undefined && c.badge !== 0 && (
                  <Badge variant="secondary" className="text-xs">{c.badge}</Badge>
                )}
              </div>
              <div>
                <div className="font-semibold text-sm">{c.title}</div>
                <div className="text-xs text-muted-foreground line-clamp-2">{c.description}</div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

interface AdminCardsProps {
  openWOs?: number;
  machinesCount?: number;
  usersCount?: number;
}

// Category accents — consistent across roles.
// Operations = blue, Assets = amber, Reports = purple, Admin = red.
const OPS = "bg-blue-500/15 text-blue-600 dark:text-blue-400";
const ASSETS = "bg-amber-500/15 text-amber-600 dark:text-amber-400";
const REPORTS = "bg-purple-500/15 text-purple-600 dark:text-purple-400";
const ADMIN = "bg-red-500/15 text-red-600 dark:text-red-400";

export function ManagerNavCards({ openWOs, machinesCount, usersCount }: AdminCardsProps) {
  const { role } = useAuth();
  const cards: NavCard[] = [
    { title: "Work Orders", description: "Manage all maintenance work orders", url: "/dashboard/work-orders", icon: ClipboardList, badge: openWOs, accent: OPS },
    { title: "Production Planner", description: "Daily shift planning by line", url: "/dashboard/planner", icon: CalendarRange, accent: OPS },
    { title: "Production OEE", description: "Performance, RAG and leaderboard", url: "/dashboard/production-performance", icon: Gauge, accent: REPORTS },
    { title: "Quality Actions", description: "Log and track quality issues", url: "/dashboard/quality", icon: CheckSquare, accent: OPS },
    
    { title: "Production Control", description: "Browse production by date, line and SKU", url: "/dashboard/shift-history", icon: History, accent: REPORTS },
    
    { title: "SKU Products", description: "Catalog and CSV import", url: "/dashboard/sku-products", icon: Boxes, accent: ASSETS },
    { title: "Machines", description: "View and manage equipment", url: "/dashboard/machines", icon: Cog, badge: machinesCount, accent: ASSETS },
    { title: "Downtime", description: "Track production line stoppages", url: "/dashboard/downtime", icon: Clock, accent: OPS },
    { title: "Production Downtime", description: "Production-side stoppages (changeover, material…)", url: "/dashboard/production-downtime", icon: Clock, accent: OPS },
    { title: "Preventive Maintenance", description: "Recurring schedules and checklists", url: "/dashboard/preventive", icon: Wrench, accent: ASSETS },
    { title: "Control Center", description: "Live operations display", url: "/dashboard/control-center", icon: Monitor, accent: OPS },
    { title: "Analytics", description: "Performance metrics and trends", url: "/dashboard/analytics", icon: BarChart3, accent: REPORTS },
    { title: "Stock", description: "Spare parts inventory", url: "/dashboard/stock", icon: Package, accent: ASSETS },
    { title: "Suppliers", description: "Vendors and purchase orders", url: "/dashboard/suppliers", icon: Truck, accent: ASSETS },
    { title: "Problems", description: "Catalog of standard issues", url: "/dashboard/problems", icon: AlertCircle, accent: ASSETS },
  ];

  // Maintenance Manager: no access to production/quality modules
  const productionOnlyUrls = new Set([
    "/dashboard/planner",
    "/dashboard/production-performance",
    "/dashboard/quality",
    
    "/dashboard/shift-history",
    
    "/dashboard/sku-products",
  ]);
  let visible = role === "maintenance_manager"
    ? cards.filter((c) => !productionOnlyUrls.has(c.url))
    : cards;

  if (role === "admin") {
    visible = visible.concat([
      { title: "Executive", description: "Executive KPI dashboard", url: "/dashboard/executive", icon: Briefcase, accent: REPORTS },
      { title: "Financial", description: "Cost and financial overview", url: "/dashboard/financial", icon: DollarSign, accent: REPORTS },
      
      { title: "Users", description: "Manage team accounts and roles", url: "/users/manage", icon: Users, badge: usersCount, accent: ADMIN },
      { title: "Audit Logs", description: "System activity and changes", url: "/dashboard/audit-logs", icon: Shield, accent: ADMIN },
      { title: "iTouching Settings", description: "Integration and Sync now", url: "/dashboard/intouch-settings", icon: Radar, accent: ADMIN },
      { title: "iTouching Machines", description: "Map iTouching machines to lines", url: "/dashboard/intouch-machines", icon: Radio, accent: ADMIN },
      { title: "iTouching Stop Codes", description: "Map stop codes to WO type, priority, line", url: "/dashboard/intouch-stop-codes", icon: Radar, accent: ADMIN },
    ]);
  } else if (role === "manager" || role === "maintenance_manager") {
    visible = visible.concat([
      { title: "Users", description: "Manage team accounts and roles", url: "/users/manage", icon: Users, badge: usersCount, accent: ADMIN },
    ]);
  }
  return <DashboardNavCards cards={visible} />;
}

export function OperatorNavCards({ myOpenWOs }: { myOpenWOs?: number }) {
  const cards: NavCard[] = [
    { title: "New Work Order", description: "Submit a maintenance request", url: "#wo-form-anchor", icon: Plus, accent: "bg-emerald-500/15 text-emerald-600" },
    { title: "My Work Orders", description: "Track your submitted orders", url: "/dashboard/operator", icon: ClipboardList, badge: myOpenWOs },
    { title: "My Production", description: "Enter today's produced quantities", url: "/dashboard/operator/my-production", icon: Factory, accent: "bg-blue-500/15 text-blue-600" },
  ];
  return <DashboardNavCards cards={cards} />;
}

export function EngineerNavCards({ assignedCount, stockLow }: { assignedCount?: number; stockLow?: number }) {
  const cards: NavCard[] = [
    { title: "My Tasks", description: "View assigned work orders", url: "/dashboard/engineer", icon: Wrench, badge: assignedCount, accent: "bg-blue-500/15 text-blue-600" },
    { title: "Preventive Maintenance", description: "Recurring schedules and checklists", url: "/dashboard/preventive", icon: Wrench, accent: ASSETS },
    { title: "Stock", description: "Spare parts inventory", url: "/dashboard/stock", icon: Package, badge: stockLow, accent: "bg-amber-500/15 text-amber-600" },
  ];
  return <DashboardNavCards cards={cards} />;
}
