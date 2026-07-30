import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/AuthContext";
import {
  ClipboardList, Cog, Users, BarChart3, Briefcase, DollarSign,
  Monitor, Shield, Package, AlertCircle, Clock, LayoutDashboard,
  Plus, Wrench, Radio, Truck, CalendarRange, Boxes, Gauge, CheckSquare,
  History, FileBarChart, Trophy, Radar, Factory,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { SectionHeading } from "@/components/ui/SectionHeading";

interface NavCard {
  title: string;
  description: string;
  url: string;
  icon: LucideIcon;
  badge?: string | number;
  accent?: string;
  comingSoon?: boolean;
  /** Section this card belongs to. When set, cards are grouped under a heading. */
  category?: string;
}

interface Props {
  cards: NavCard[];
}

/** Section order for grouped grids — operations first, admin last. */
const CATEGORY_ORDER = ["Operations", "Production", "Assets", "Reports", "Administration"];

/**
 * Visual navigation grid for dashboard home pages.
 * Each card links to a section the current role can access.
 *
 * Cards carrying a `category` are grouped under headings. Eighteen identical cards
 * in one grid gave Audit Logs the same weight as Maintenance Orders and made
 * finding anything a matter of reading every tile.
 */
export function DashboardNavCards({ cards }: Props) {
  if (!cards.length) return null;

  const grouped = cards.some((c) => c.category);
  if (!grouped) return <NavCardGrid cards={cards} />;

  const byCategory = new Map<string, NavCard[]>();
  for (const c of cards) {
    const key = c.category ?? "Other";
    byCategory.set(key, [...(byCategory.get(key) ?? []), c]);
  }
  const sections = [
    ...CATEGORY_ORDER.filter((k) => byCategory.has(k)),
    ...Array.from(byCategory.keys()).filter((k) => !CATEGORY_ORDER.includes(k)),
  ];

  return (
    <div className="space-y-6">
      {sections.map((name) => (
        <section key={name} aria-label={name} className="space-y-3">
          <SectionHeading>{name}</SectionHeading>
          <NavCardGrid cards={byCategory.get(name)!} />
        </section>
      ))}
    </div>
  );
}

function NavCardGrid({ cards }: Props) {
  const navigate = useNavigate();
  return (
    <div className="grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((c) => {
        const Icon = c.icon;
        return (
          <Card
            key={c.url}
            onClick={() => { if (!c.comingSoon) navigate(c.url); }}
            aria-disabled={c.comingSoon}
            className={
              c.comingSoon
                ? "group transition-all opacity-60 cursor-not-allowed"
                : "group cursor-pointer transition-all hover:scale-[1.02] hover:shadow-lg hover:border-primary/40"
            }
          >
            <CardContent className="p-4 space-y-3">
              <div className="flex items-start justify-between">
                <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${c.accent ?? "bg-primary/10 text-primary"} transition-colors ${c.comingSoon ? "" : "group-hover:bg-primary group-hover:text-primary-foreground"}`}>
                  <Icon className="h-5 w-5" />
                </div>
                {c.comingSoon ? (
                  <Badge variant="outline" className="text-[10px] uppercase tracking-wide">Coming soon</Badge>
                ) : c.badge !== undefined && c.badge !== 0 ? (
                  <Badge variant="secondary" className="text-xs">{c.badge}</Badge>
                ) : null}
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

// Category accents — consistent across roles.
// Operations = blue, Assets = amber, Reports = purple, Admin = red.
const ASSETS = "bg-amber-500/15 text-amber-600 dark:text-amber-400";

export function OperatorNavCards({ myOpenWOs }: { myOpenWOs?: number }) {
  const cards: NavCard[] = [
    { title: "New Maintenance Order", description: "Submit a maintenance request", url: "#wo-form-anchor", icon: Plus, accent: "bg-emerald-500/15 text-emerald-600" },
    { title: "My Maintenance Orders", description: "Track your submitted orders", url: "/dashboard/operator", icon: ClipboardList, badge: myOpenWOs },
    { title: "My Production", description: "View today's line target and enter produced quantities", url: "/dashboard/operator/my-production", icon: Factory, accent: "bg-blue-500/15 text-blue-600" },
  ];
  return <DashboardNavCards cards={cards} />;
}

export function EngineerNavCards({ assignedCount, stockLow }: { assignedCount?: number; stockLow?: number }) {
  const cards: NavCard[] = [
    { title: "My Tasks", description: "View assigned maintenance orders", url: "/dashboard/engineer", icon: Wrench, badge: assignedCount, accent: "bg-blue-500/15 text-blue-600" },
    { title: "Preventive Maintenance", description: "Recurring schedules and checklists", url: "/dashboard/preventive", icon: Wrench, accent: ASSETS, category: "Operations" },
    { title: "Stock", description: "Spare parts inventory", url: "/dashboard/stock", icon: Package, badge: stockLow, accent: "bg-amber-500/15 text-amber-600" },
  ];
  return <DashboardNavCards cards={cards} />;
}
