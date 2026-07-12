import type { Database } from "@/integrations/supabase/types";

export type Role = Database["public"]["Enums"]["app_role"];

/**
 * All gated actions in the app. Add new keys as features grow.
 * Keep names verb-led and resource-suffixed: `verb.resource`.
 */
export type Action =
  // Work Orders
  | "wo.view"
  | "wo.create"
  | "wo.update"
  | "wo.delete"
  | "wo.close"
  | "wo.force"
  | "wo.print"
  // Downtime
  | "downtime.view"
  | "downtime.manage"
  // Machines / Problems
  | "machines.view"
  | "machines.manage"
  | "problems.view"
  | "problems.manage"
  // Stock
  | "stock.view"
  | "stock.manage"
  | "stock.pricing"
  // Users / Audit
  | "users.view"
  | "users.manage"
  | "audit.view"
  // Reports
  | "reports.analytics"
  | "reports.financial"
  | "reports.executive"
  // System
  | "system.clear"
  | "system.settings";

const ALL: Role[] = ["admin", "manager", "maintenance_manager", "engineer", "co_engineer", "operator", "viewer"];

/**
 * Permission matrix — single source of truth.
 * Roles listed for each action are the ones allowed to perform it.
 */
const MATRIX: Record<Action, Role[]> = {
  // Work Orders
  "wo.view": ["admin", "manager", "maintenance_manager", "engineer", "co_engineer", "operator", "viewer"],
  "wo.create": ["admin", "manager", "maintenance_manager", "operator"],
  "wo.update": ["admin", "manager", "maintenance_manager", "engineer", "co_engineer"],
  "wo.delete": ["admin"], // manager loses delete in Phase 5
  "wo.close": ["admin", "manager", "maintenance_manager", "engineer", "co_engineer"],
  "wo.force": ["admin"],
  "wo.print": ["admin", "manager", "maintenance_manager"],

  // Downtime
  "downtime.view": ALL,
  "downtime.manage": ["admin", "manager", "maintenance_manager", "engineer", "co_engineer"],

  // Machines
  "machines.view": ["admin", "manager", "maintenance_manager", "engineer", "co_engineer", "operator", "viewer"],
  "machines.manage": ["admin", "manager", "maintenance_manager"],

  // Problems
  "problems.view": ["admin", "manager", "maintenance_manager", "engineer", "co_engineer", "operator", "viewer"],
  "problems.manage": ["admin", "manager", "maintenance_manager"],

  // Stock
  "stock.view": ["admin", "manager", "maintenance_manager", "engineer", "co_engineer"],
  "stock.manage": ["admin", "manager", "maintenance_manager"],
  "stock.pricing": ["admin"],

  // Users / Audit
  "users.view": ["admin", "manager", "maintenance_manager"],
  "users.manage": ["admin", "manager", "maintenance_manager"],
  "audit.view": ["admin", "manager", "maintenance_manager"],

  // Reports
  "reports.analytics": ["admin", "manager", "maintenance_manager"],
  "reports.financial": ["admin"],
  "reports.executive": ["admin"],

  // System
  "system.clear": ["admin"],
  "system.settings": ["admin"],
};

/**
 * Default landing route per role. Single source of truth used by
 * SessionRedirect (App.tsx) and ProtectedRoute access-denied fallback.
 */
export const roleDashMap: Record<Role, string> = {
  admin: "/dashboard/manager",
  manager: "/dashboard/manager",
  maintenance_manager: "/dashboard/manager",
  engineer: "/dashboard/engineer",
  co_engineer: "/dashboard/engineer",
  operator: "/dashboard/operator",
  viewer: "/dashboard/manager",
};

/** Returns the dashboard path for a role, falling back to /login when unknown. */
export function dashboardPathFor(role: Role | null | undefined): string {
  if (!role) return "/login";
  return roleDashMap[role] ?? "/login";
}

/** Returns true if the given role can perform the action. Null role → false. */
export function can(role: Role | null | undefined, action: Action): boolean {
  if (!role) return false;
  return MATRIX[action]?.includes(role) ?? false;
}

/** Returns true if the role can perform ANY of the listed actions. */
export function canAny(role: Role | null | undefined, actions: Action[]): boolean {
  return actions.some((a) => can(role, a));
}

/** Returns true if the role can perform ALL of the listed actions. */
export function canAll(role: Role | null | undefined, actions: Action[]): boolean {
  return actions.every((a) => can(role, a));
}

/** Line Chat visibility — operator and admin only. */
export function canUseLineChat(role: Role | null | undefined): boolean {
  return role === "admin" || role === "operator";
}
