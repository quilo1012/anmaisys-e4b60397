import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { useRole } from "@/hooks/useRole";
import {
  Shield, Radar, Radio, Settings as SettingsIcon, Users, UsersRound, Activity, ChevronRight,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Action } from "@/lib/permissions";
import { BackButton } from "@/components/BackButton";

export interface Tool {
  title: string;
  description: string;
  url: string;
  icon: LucideIcon;
  action?: Action;
  category: "People" | "iTouching" | "System";
}

/**
 * Everything that configures the system, on one page instead of eight sidebar rows.
 *
 * These are the screens somebody opens when something needs setting up or explaining
 * — not the ones they work in. They were taking a third of the sidebar and pushing
 * the daily work down past the fold, which is the wrong way round: a menu should be
 * shortest for the things used most.
 *
 * Each card says what the screen is for. That is the part the sidebar could never
 * do — "iTouching Stop Codes" tells you nothing about it deciding which alarms call
 * out an engineer, and that decision is why WO-639 and WO-640 existed at all.
 */
export const SYSTEM_TOOLS: Tool[] = [
  {
    title: "Users",
    description: "Who has an account, what role they hold, and what that role can reach.",
    url: "/users/manage", icon: Users, action: "users.manage", category: "People",
  },
  {
    title: "People",
    description: "The employee records — departments, rotas, leavers — that the board, Leave and Finance Close all read.",
    url: "/dashboard/people", icon: UsersRound, action: "workforce.view", category: "People",
  },
  {
    title: "iTouching Sync",
    description: "The connection to the line monitors: whether it is polling and what it last saw.",
    url: "/dashboard/intouch-settings", icon: Radar, action: "intouch.manage", category: "iTouching",
  },
  {
    title: "iTouching Machines",
    description: "Which monitored machine belongs to which line, and which are ignored.",
    url: "/dashboard/intouch-machines", icon: Radio, action: "intouch.manage", category: "iTouching",
  },
  {
    title: "iTouching Stop Codes",
    description: "Which stops open a maintenance order and which are production downtime only. A code marked otherwise here will not call out an engineer.",
    url: "/dashboard/intouch-stop-codes", icon: Radar, action: "intouch.manage", category: "iTouching",
  },
  {
    title: "Settings",
    description: "System-wide configuration, including the permission matrix for every role.",
    url: "/dashboard/settings", icon: SettingsIcon, action: "system.settings", category: "System",
  },
  {
    title: "Audit Logs",
    description: "Who changed what, and when. The record that survives an argument.",
    url: "/dashboard/audit-logs", icon: Shield, action: "audit.view", category: "System",
  },
  {
    title: "Root Diagnostics",
    description: "Health checks and raw system state, for when something is wrong and nobody knows why yet.",
    url: "/dashboard/root-diagnostics", icon: Activity, category: "System",
  },
];

const ORDER: Tool["category"][] = ["People", "iTouching", "System"];

export default function SystemHubPage() {
  const navigate = useNavigate();
  const { can } = useRole();

  // A card nobody can open is worse than no card: it advertises a screen and then
  // refuses it. Anything without an action is admin-only by its route already.
  const visible = SYSTEM_TOOLS.filter((t) => !t.action || can(t.action));

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <BackButton />

      <div className="flex items-center gap-3">
        <SettingsIcon className="h-6 w-6 text-muted-foreground" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">System</h1>
          <p className="text-sm text-muted-foreground">Setup, integrations and the audit trail</p>
        </div>
      </div>

      {ORDER.map((cat) => {
        const group = visible.filter((t) => t.category === cat);
        if (group.length === 0) return null;
        return (
          <div key={cat} className="space-y-2">
            <SectionHeading>{cat}</SectionHeading>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {group.map((t) => (
                <Card
                  key={t.url}
                  onClick={() => navigate(t.url)}
                  className="group cursor-pointer transition-colors hover:border-primary/50 hover:bg-muted/40"
                >
                  <CardContent className="flex gap-3 p-4">
                    <t.icon className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground group-hover:text-primary" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1 font-semibold">
                        {t.title}
                        <ChevronRight className="h-4 w-4 opacity-0 transition-opacity group-hover:opacity-60" />
                      </div>
                      <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{t.description}</p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
