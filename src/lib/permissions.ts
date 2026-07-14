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
  | "system.settings"
  // Production
  | "production.view"
  | "production.manage"
  | "production.target.view"
  | "production.target.manage"
  | "production.performance.view"
  // Planner / Scheduling
  | "planner.view"
  | "planner.manage"
  | "sku.view"
  | "sku.manage"
  // RAG Weekly
  | "rag.view"
  | "rag.manage"
  | "rag.comment"
  // Smart Target
  | "smarttarget.view"
  // Quality
  | "quality.view"
  | "quality.manage"
  // Preventive Maintenance
  | "pm.view"
  | "pm.manage"
  // Engineers / Leaders
  | "engineers.view"
  | "engineers.manage"
  | "leaders.view"
  | "leaders.manage"
  // Chat / DM
  | "chat.line"
  | "chat.dm"
  // Notifications
  | "notifications.view"
  | "notifications.manage"
  // iTouching Sync
  | "intouch.view"
  | "intouch.manage"
  // Control Center / Assets
  | "controlcenter.view"
  | "assets.manage"
  // Dashboards
  | "dashboard.executive"
  | "dashboard.manager"
  | "dashboard.engineer"
  | "dashboard.operator"
  // Permissions matrix
  | "permissions.manage";

const ALL: Role[] = ["admin", "manager", "supervisor", "maintenance_manager", "planner", "engineer", "co_engineer", "operator", "viewer"];

const MATRIX: Record<Action, Role[]> = {
  "wo.view": ALL,
  "wo.create": ["admin", "manager", "supervisor", "maintenance_manager", "planner", "operator"],
  "wo.update": ["admin", "manager", "supervisor", "maintenance_manager", "planner", "engineer", "co_engineer"],
  "wo.delete": ["admin"],
  "wo.close": ["admin", "manager", "supervisor", "engineer", "co_engineer"],
  "wo.force": ["admin"],
  "wo.print": ["admin", "manager", "supervisor", "maintenance_manager", "planner"],

  "downtime.view": ALL,
  "downtime.manage": ["admin", "manager", "supervisor", "engineer", "co_engineer"],

  "machines.view": ALL,
  "machines.manage": ["admin", "manager", "supervisor"],

  "problems.view": ALL,
  "problems.manage": ["admin", "manager", "supervisor"],

  "stock.view": ["admin", "manager", "supervisor", "maintenance_manager", "planner", "engineer", "co_engineer"],
  "stock.manage": ["admin", "manager", "supervisor"],
  "stock.pricing": ["admin"],

  "users.view": ["admin", "manager"],
  "users.manage": ["admin", "manager"],
  "audit.view": ["admin", "manager", "supervisor"],

  "reports.analytics": ["admin", "manager", "supervisor"],
  "reports.financial": ["admin"],
  "reports.executive": ["admin"],

  "system.clear": ["admin"],
  "system.settings": ["admin"],

  "production.view": ALL,
  "production.manage": ["admin", "manager", "supervisor", "maintenance_manager", "planner", "operator"],
  "production.target.view": ["admin", "manager", "supervisor", "maintenance_manager", "planner", "operator"],
  "production.target.manage": ["admin", "manager", "supervisor", "planner"],
  "production.performance.view": ["admin", "manager", "supervisor", "maintenance_manager", "planner"],

  "planner.view": ["admin", "manager", "supervisor", "maintenance_manager", "planner"],
  "planner.manage": ["admin", "manager", "planner"],
  "sku.view": ["admin", "manager", "supervisor", "maintenance_manager", "planner", "operator"],
  "sku.manage": ["admin", "manager", "planner"],

  "rag.view": ["admin", "manager", "supervisor", "maintenance_manager", "planner"],
  "rag.manage": ["admin", "manager", "planner"],
  "rag.comment": ["admin", "manager", "supervisor", "planner"],

  "smarttarget.view": ["admin", "manager", "supervisor", "maintenance_manager", "planner"],

  "quality.view": ["admin", "manager", "supervisor", "engineer", "co_engineer"],
  "quality.manage": ["admin", "manager", "supervisor"],

  "pm.view": ["admin", "manager", "supervisor", "maintenance_manager", "engineer", "co_engineer"],
  "pm.manage": ["admin", "manager", "maintenance_manager"],

  "engineers.view": ["admin", "manager", "supervisor", "maintenance_manager"],
  "engineers.manage": ["admin", "manager", "maintenance_manager"],
  "leaders.view": ["admin", "manager", "supervisor"],
  "leaders.manage": ["admin", "manager"],

  "chat.line": ["admin", "operator"],
  "chat.dm": ["admin", "manager", "supervisor", "operator"],

  "notifications.view": ALL,
  "notifications.manage": ["admin", "manager"],

  "intouch.view": ["admin", "manager", "maintenance_manager", "planner"],
  "intouch.manage": ["admin", "maintenance_manager"],

  "controlcenter.view": ["admin", "manager", "supervisor", "maintenance_manager"],
  "assets.manage": ["admin", "manager", "maintenance_manager"],

  "dashboard.executive": ["admin", "manager"],
  "dashboard.manager": ["admin", "manager", "supervisor", "maintenance_manager", "planner", "viewer"],
  "dashboard.engineer": ["admin", "engineer", "co_engineer"],
  "dashboard.operator": ["admin", "operator"],

  "permissions.manage": ["admin"],
};

/**
 * Default landing route per role. Single source of truth used by
 * SessionRedirect (App.tsx) and ProtectedRoute access-denied fallback.
 */
export const roleDashMap: Record<Role, string> = {
  admin: "/dashboard/manager",
  manager: "/dashboard/manager",
  supervisor: "/dashboard/manager",
  maintenance_manager: "/dashboard/manager",
  planner: "/dashboard/manager",
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

/**
 * Runtime overrides loaded from `public.role_permission_overrides`.
 * Key format: `${role}:${action}` → boolean (true=allow, false=deny).
 */
let OVERRIDES: Record<string, boolean> = {};
const overrideListeners = new Set<() => void>();

export function setPermissionOverrides(map: Record<string, boolean>) {
  OVERRIDES = map ?? {};
  overrideListeners.forEach((l) => l());
}
export function subscribePermissionOverrides(fn: () => void) {
  overrideListeners.add(fn);
  return () => {
    overrideListeners.delete(fn);
  };
}
export function isPermissionOverridden(role: Role, action: Action): boolean {
  return `${role}:${action}` in OVERRIDES;
}
export function defaultCan(role: Role, action: Action): boolean {
  return MATRIX[action]?.includes(role) ?? false;
}

/** Returns true if the given role can perform the action. Null role → false. */
export function can(role: Role | null | undefined, action: Action): boolean {
  if (!role) return false;
  const key = `${role}:${action}`;
  if (key in OVERRIDES) return OVERRIDES[key];
  return MATRIX[action]?.includes(role) ?? false;
}

/** All known actions (for admin UIs). */
export const ALL_ACTIONS: Action[] = Object.keys(MATRIX) as Action[];
export const ALL_ROLES: Role[] = ALL;

/** Returns true if the role can perform ANY of the listed actions. */
export function canAny(role: Role | null | undefined, actions: Action[]): boolean {
  return actions.some((a) => can(role, a));
}

/** Returns true if the role can perform ALL of the listed actions. */
export function canAll(role: Role | null | undefined, actions: Action[]): boolean {
  return actions.every((a) => can(role, a));
}

/** Line chat visibility (floating line-level chat). */
export function canUseLineChat(role: Role | null | undefined): boolean {
  return can(role, "chat.line");
}

/** Direct Messages visibility (Contact supervisor/manager). */
export function canUseDirectMessages(role: Role | null | undefined): boolean {
  return can(role, "chat.dm");
}
