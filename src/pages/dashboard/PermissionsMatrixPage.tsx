import { Check, X, ShieldCheck, Info } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { Action, Role } from "@/lib/permissions";
import { can } from "@/lib/permissions";

const ROLES: Role[] = [
  "admin",
  "manager",
  "supervisor",
  "maintenance_manager",
  "planner",
  "engineer",
  "co_engineer",
  "operator",
  "viewer",
];

const ROLE_LABELS: Record<Role, string> = {
  admin: "Admin",
  manager: "Manager",
  supervisor: "Supervisor",
  maintenance_manager: "Maint. Manager",
  planner: "Planner",
  engineer: "Engineer",
  co_engineer: "Co-Engineer",
  operator: "Operator",
  viewer: "Viewer",
};

type Group = { label: string; actions: { key: Action; label: string }[] };

const GROUPS: Group[] = [
  {
    label: "Work Orders",
    actions: [
      { key: "wo.view", label: "View" },
      { key: "wo.create", label: "Create" },
      { key: "wo.update", label: "Update" },
      { key: "wo.close", label: "Close" },
      { key: "wo.delete", label: "Delete" },
      { key: "wo.force", label: "Force action" },
      { key: "wo.print", label: "Print" },
    ],
  },
  {
    label: "Downtime",
    actions: [
      { key: "downtime.view", label: "View" },
      { key: "downtime.manage", label: "Manage" },
    ],
  },
  {
    label: "Machines & Problems",
    actions: [
      { key: "machines.view", label: "View machines" },
      { key: "machines.manage", label: "Manage machines" },
      { key: "problems.view", label: "View problems" },
      { key: "problems.manage", label: "Manage problems" },
    ],
  },
  {
    label: "Stock",
    actions: [
      { key: "stock.view", label: "View" },
      { key: "stock.manage", label: "Manage" },
      { key: "stock.pricing", label: "Pricing" },
    ],
  },
  {
    label: "Users & Audit",
    actions: [
      { key: "users.view", label: "View users" },
      { key: "users.manage", label: "Manage users" },
      { key: "audit.view", label: "Audit logs" },
    ],
  },
  {
    label: "Reports",
    actions: [
      { key: "reports.analytics", label: "Analytics" },
      { key: "reports.financial", label: "Financial" },
      { key: "reports.executive", label: "Executive" },
    ],
  },
  {
    label: "System",
    actions: [
      { key: "system.clear", label: "Clear data" },
      { key: "system.settings", label: "Settings" },
    ],
  },
];

export default function PermissionsMatrixPage() {
  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex items-center gap-3">
        <ShieldCheck className="h-7 w-7 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Permissions Matrix</h1>
          <p className="text-sm text-muted-foreground">
            Read-only view of every role and the actions it can perform.
          </p>
        </div>
      </div>

      <Alert>
        <Info className="h-4 w-4" />
        <AlertTitle>How to edit</AlertTitle>
        <AlertDescription>
          Permissions are defined in code at{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">src/lib/permissions.ts</code>.
          Ask a developer (or Lovable) to add/remove a role from an action's list, then update
          the mirror test in{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">src/lib/permissions.test.ts</code>.
        </AlertDescription>
      </Alert>

      {GROUPS.map((group) => (
        <Card key={group.label}>
          <CardHeader>
            <CardTitle className="text-lg">{group.label}</CardTitle>
            <CardDescription>{group.actions.length} action(s)</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead>
                <tr className="border-b">
                  <th className="sticky left-0 z-10 bg-card p-2 text-left font-medium">Action</th>
                  {ROLES.map((r) => (
                    <th key={r} className="p-2 text-center font-medium">
                      <Badge variant="outline" className="whitespace-nowrap">
                        {ROLE_LABELS[r]}
                      </Badge>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {group.actions.map((a) => (
                  <tr key={a.key} className="border-b last:border-0 hover:bg-muted/40">
                    <td className="sticky left-0 z-10 bg-card p-2">
                      <div className="font-medium">{a.label}</div>
                      <div className="text-xs text-muted-foreground">{a.key}</div>
                    </td>
                    {ROLES.map((r) => {
                      const allowed = can(r, a.key);
                      return (
                        <td key={r} className="p-2 text-center">
                          {allowed ? (
                            <Check className="mx-auto h-5 w-5 text-emerald-500" aria-label="allowed" />
                          ) : (
                            <X className="mx-auto h-4 w-4 text-muted-foreground/40" aria-label="denied" />
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
