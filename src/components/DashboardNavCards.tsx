import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/AuthContext";
import {
  ClipboardList, Cog, Users, BarChart3, Briefcase, DollarSign,
  Monitor, Shield, Package, AlertCircle, Clock, LayoutDashboard,
  Plus, Wrench,
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
    { title: "Machines", description: "View and manage equipment", url: "/dashboard/machines", icon: Cog, badge: machinesCount, accent: ASSETS },
    { title: "Downtime", description: "Track production line stoppages", url: "/dashboard/downtime", icon: Clock, accent: OPS },
    { title: "Control Center", description: "Live operations display", url: "/dashboard/control-center", icon: Monitor, accent: OPS },
    { title: "Analytics", description: "Performance metrics and trends", url: "/dashboard/analytics", icon: BarChart3, accent: REPORTS },
    { title: "Stock", description: "Spare parts inventory", url: "/dashboard/stock", icon: Package, accent: ASSETS },
    { title: "Problems", description: "Catalog of standard issues", url: "/dashboard/problems", icon: AlertCircle, accent: ASSETS },
  ];
  if (role === "admin") {
    cards.push(
      { title: "Executive", description: "Executive KPI dashboard", url: "/dashboard/executive", icon: Briefcase, accent: REPORTS },
      { title: "Financial", description: "Cost and financial overview", url: "/dashboard/financial", icon: DollarSign, accent: REPORTS },
      { title: "Users", description: "Manage team accounts and roles", url: "/users/manage", icon: Users, badge: usersCount, accent: ADMIN },
      { title: "Audit Logs", description: "System activity and changes", url: "/dashboard/audit-logs", icon: Shield, accent: ADMIN },
    );
  } else if (role === "manager") {
    cards.push(
      { title: "Users", description: "Manage team accounts and roles", url: "/users/manage", icon: Users, badge: usersCount, accent: ADMIN },
    );
  }
  return <DashboardNavCards cards={cards} />;
}

export function OperatorNavCards({ myOpenWOs }: { myOpenWOs?: number }) {
  const cards: NavCard[] = [
    { title: "New Work Order", description: "Submit a maintenance request", url: "#wo-form-anchor", icon: Plus, accent: "bg-emerald-500/15 text-emerald-600" },
    { title: "My Work Orders", description: "Track your submitted orders", url: "/dashboard/operator", icon: ClipboardList, badge: myOpenWOs },
  ];
  return <DashboardNavCards cards={cards} />;
}

export function EngineerNavCards({ assignedCount, stockLow }: { assignedCount?: number; stockLow?: number }) {
  const cards: NavCard[] = [
    { title: "My Tasks", description: "View assigned work orders", url: "/dashboard/engineer", icon: Wrench, badge: assignedCount, accent: "bg-blue-500/15 text-blue-600" },
    { title: "Stock", description: "Spare parts inventory", url: "/dashboard/stock", icon: Package, badge: stockLow, accent: "bg-amber-500/15 text-amber-600" },
  ];
  return <DashboardNavCards cards={cards} />;
}
