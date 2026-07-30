import { DashboardLayout, navItems } from "@/components/DashboardLayout";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { canForDevice } from "@/lib/permissions";
import { useDeviceType } from "@/hooks/use-device-type";
import { useSiteBanner, bannerUrlsForDevice } from "@/hooks/useSiteBanner";
import { SiteBannerImages } from "@/components/SiteBannerImages";
import { AnimatedWelcomeHeader } from "@/components/AnimatedWelcomeHeader";
import { useWorkOrders } from "@/hooks/useWorkOrders";
import { useStoppedLinesCount } from "@/hooks/useStoppedLinesCount";
import { usePmSchedules, pmStatus } from "@/hooks/usePreventiveMaintenance";
import { getCurrentFactoryShift, SHIFT_LABEL } from "@/lib/shifts";
import { PowerOff, ClipboardList, PenTool, CalendarClock, ChevronRight } from "lucide-react";
import { useMemo } from "react";
import { cn } from "@/lib/utils";
import type { Database } from "@/integrations/supabase/types";

type AppRole = Database["public"]["Enums"]["app_role"];

/** Sidebar order, so the landing page and the menu agree on where things live. */
const GROUP_ORDER = [
  "Overview", "Maintenance", "Assets", "Production",
  "Reports", "Communication", "Administration", "System",
];

/** Roles that run the factory and get the live status row. */
const STATUS_ROLES: AppRole[] = ["admin", "manager", "maintenance_manager", "supervisor", "planner"];

export default function MobileHome() {
  const { profile, role } = useAuth();
  const navigate = useNavigate();
  const device = useDeviceType();
  const { data: banner } = useSiteBanner();
  const heroUrls = bannerUrlsForDevice(banner, device);
  const effectiveRole = (role === "co_engineer" ? "engineer" : role) as AppRole | null;

  // Quick links respect what this role is allowed to see on THIS device.
  const items = navItems.filter(
    (i) => effectiveRole && i.roles.includes(effectiveRole) && (!i.action || canForDevice(effectiveRole, i.action, device)),
  );

  // Grouped the way the sidebar groups them. The flat grid put Root Diagnostics
  // beside Maintenance Orders in identical cards, so nothing on the page said what
  // mattered or where anything belonged.
  const groups = useMemo(() => {
    const map = new Map<string, typeof items>();
    for (const it of items) {
      const arr = map.get(it.group) ?? [];
      arr.push(it);
      map.set(it.group, arr);
    }
    return GROUP_ORDER.filter((g) => map.has(g)).map((g) => ({ group: g, items: map.get(g)! }));
  }, [items]);

  const showStatus = !!effectiveRole && STATUS_ROLES.includes(effectiveRole);
  const { data: openWOs } = useWorkOrders({ statusIn: showStatus ? ["open"] : undefined });
  const { data: finishedWOs } = useWorkOrders({ statusIn: showStatus ? ["finished"] : undefined });
  const { data: stoppedLines } = useStoppedLinesCount();
  const { data: pmSchedules } = usePmSchedules();

  const pmOverdue = useMemo(
    () => (pmSchedules ?? []).filter((s) => pmStatus(s) === "overdue").length,
    [pmSchedules],
  );
  const notAccepted = useMemo(
    () => (openWOs ?? []).filter((w) => !w.received_at).length,
    [openWOs],
  );

  const today = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const { shiftCode } = getCurrentFactoryShift();

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-6xl space-y-8 py-6">
        <AnimatedWelcomeHeader name={profile?.name || "there"} dateLabel={`${today} · ${SHIFT_LABEL[shiftCode]}`} />

        {/* Banner stays at the top, under the welcome — this is the first screen after
            signing in and it is where the brand belongs. */}
        {heroUrls.length > 0 && (
          <a
            href={banner?.url ?? "https://appliednutrition.uk/"}
            target="_blank"
            rel="noopener noreferrer"
            className="group relative block aspect-[16/6] overflow-hidden rounded-2xl border shadow-sm transition-shadow hover:shadow-md sm:aspect-[16/5]"
            aria-label="Applied Nutrition"
          >
            <SiteBannerImages urls={heroUrls} />
          </a>
        )}

        {/* What the factory is doing right now, before the shortcuts. A landing page
            that only lists screens makes everyone open three of them to find out
            whether anything needs them. */}
        {showStatus && (
          <section aria-label="Live status" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatusTile
              label="Lines stopped"
              value={stoppedLines ?? 0}
              hint={stoppedLines ? "Production is down" : "All lines running"}
              icon={<PowerOff className="h-4 w-4" />}
              tone={stoppedLines ? "danger" : "ok"}
              onClick={() => navigate("/dashboard/work-orders?status=open")}
            />
            <StatusTile
              label="Not accepted"
              value={notAccepted}
              hint={notAccepted ? "No engineer has taken these" : "Every order has an owner"}
              icon={<ClipboardList className="h-4 w-4" />}
              tone={notAccepted ? "warning" : "ok"}
              onClick={() => navigate("/dashboard/work-orders?status=open")}
            />
            <StatusTile
              label="Awaiting sign-off"
              value={finishedWOs?.length ?? 0}
              hint="Finished, waiting for the maintenance manager"
              icon={<PenTool className="h-4 w-4" />}
              tone={(finishedWOs?.length ?? 0) > 0 ? "info" : "ok"}
              onClick={() => navigate("/dashboard/work-orders?status=finished")}
            />
            <StatusTile
              label="PM overdue"
              value={pmOverdue}
              hint={pmOverdue ? "Past the scheduled date" : "Preventive plan on track"}
              icon={<CalendarClock className="h-4 w-4" />}
              tone={pmOverdue ? "warning" : "ok"}
              onClick={() => navigate("/dashboard/preventive")}
            />
          </section>
        )}

        {groups.map(({ group, items: groupItems }) => (
          <section key={group} aria-label={group} className="space-y-3">
            <div className="flex items-center gap-3">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{group}</h2>
              <div className="h-px flex-1 bg-border" />
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {groupItems.map((it) => {
                const Icon = it.icon;
                return (
                  <Card
                    key={`${it.url}-${it.title}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => navigate(it.url)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(it.url); } }}
                    className="group cursor-pointer transition-colors hover:border-primary/40 hover:bg-accent/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99]"
                  >
                    <CardContent className="flex items-center gap-3 p-4">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <Icon className="h-5 w-5" />
                      </div>
                      <span className="min-w-0 flex-1 text-sm font-medium leading-tight">{it.title}</span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </section>
        ))}

      </div>
    </DashboardLayout>
  );
}

function StatusTile({
  label, value, hint, icon, tone, onClick,
}: {
  label: string; value: number; hint: string;
  icon: React.ReactNode;
  tone: "ok" | "info" | "warning" | "danger";
  onClick: () => void;
}) {
  // Left-border accent + muted label + large number: the KpiCard shape used across
  // the reports, so the landing page belongs to the same system.
  const accent: Record<string, string> = {
    ok: "border-l-emerald-500",
    info: "border-l-blue-500",
    warning: "border-l-amber-500",
    danger: "border-l-destructive",
  };
  const valueTone: Record<string, string> = {
    ok: "",
    info: "",
    warning: "text-amber-600 dark:text-amber-400",
    danger: "text-destructive",
  };
  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } }}
      className={cn(
        "cursor-pointer border-l-4 transition-colors hover:bg-muted/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        accent[tone],
      )}
    >
      <CardContent className="pt-4 pb-3">
        <div className="mb-1 flex items-center gap-2 text-muted-foreground">
          {icon}
          <span className="text-xs font-medium">{label}</span>
        </div>
        <p className={cn("text-3xl font-bold leading-tight tabular-nums", value > 0 ? valueTone[tone] : "")}>{value}</p>
        <p className="mt-1 text-[10px] leading-snug text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  );
}
