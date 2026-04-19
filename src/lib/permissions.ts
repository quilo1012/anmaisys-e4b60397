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

const ALL: Role[] = ["admin", "manager", "engineer", "operator", "viewer"];

/**
 * Permission matrix — single source of truth.
 * Roles listed for each action are the ones allowed to perform it.
 */
const MATRIX: Record<Action, Role[]> = {
  // Work Orders
  "wo.view": ["admin", "manager", "engineer", "operator", "viewer"],
  "wo.create": ["admin", "manager", "operator"],
  "wo.update": ["admin", "manager", "engineer"],
  "wo.delete": ["admin"], // manager loses delete in Phase 5
  "wo.close": ["admin", "manager", "engineer"],
  "wo.force": ["admin"],
  "wo.print": ["admin", "manager"],

  // Downtime
  "downtime.view": ALL,
  "downtime.manage": ["admin", "manager", "engineer"],

  // Machines
  "machines.view": ["admin", "manager", "engineer", "operator", "viewer"],
  "machines.manage": ["admin", "manager"],

  // Problems
  "problems.view": ["admin", "manager", "engineer", "operator", "viewer"],
  "problems.manage": ["admin", "manager"],

  // Stock
  "stock.view": ["admin", "manager", "engineer"],
  "stock.manage": ["admin", "manager"],
  "stock.pricing": ["admin"],

  // Users / Audit
  "users.view": ["admin"],
  "users.manage": ["admin"],
  "audit.view": ["admin", "manager"],

  // Reports
  "reports.analytics": ["admin", "manager"],
  "reports.financial": ["admin"],
  "reports.executive": ["admin", "manager"],

  // System
  "system.clear": ["admin"],
  "system.settings": ["admin"],
};

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
