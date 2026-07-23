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
  | "production.sku_performance.view"
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
  // Reliability / Suppliers (dedicated view actions)
  | "reliability.view"
  | "suppliers.view"
  // Permissions matrix
  | "permissions.manage";

const ALL: Role[] = ["admin", "manager", "supervisor", "maintenance_manager", "planner", "engineer", "co_engineer", "operator", "viewer"];

const MATRIX: Record<Action, Role[]> = {
  "wo.view": [...ALL, "warehouse"],
  "wo.create": ["admin", "manager", "supervisor", "maintenance_manager", "planner", "operator", "warehouse"],
  "wo.update": ["admin", "manager", "supervisor", "maintenance_manager", "planner", "engineer", "co_engineer"],
  "wo.delete": ["admin"],
  "wo.close": ["admin", "manager", "supervisor", "engineer", "co_engineer"],
  "wo.force": ["admin"],
  "wo.print": ["admin", "manager", "supervisor", "maintenance_manager", "planner"],

  "downtime.view": ALL,
  "downtime.manage": ["admin", "manager", "supervisor", "engineer", "co_engineer"],

  "machines.view": [...ALL, "warehouse"],
  "machines.manage": ["admin", "manager", "supervisor"],

  "problems.view": ALL,
  "problems.manage": ["admin", "manager", "supervisor"],

  "stock.view": ["admin", "manager", "supervisor", "maintenance_manager", "planner", "engineer", "co_engineer", "warehouse"],
  "stock.manage": ["admin", "manager", "supervisor"],
  "stock.pricing": ["admin"],

  "users.view": ["admin", "manager"],
  "users.manage": ["admin", "manager"],
  "audit.view": ["admin", "manager", "supervisor"],

  "reports.analytics": ["admin", "manager", "supervisor"],
  "reports.financial": [],
  "reports.executive": [],

  "system.clear": ["admin"],
  "system.settings": ["admin"],

  "production.view": ALL,
  "production.manage": ["admin", "manager", "supervisor", "maintenance_manager", "planner", "operator", "engineer", "co_engineer"],
  "production.target.view": ["admin", "manager", "supervisor", "maintenance_manager", "planner", "operator"],
  "production.target.manage": ["admin", "manager", "supervisor", "planner"],
  "production.performance.view": ["admin", "manager", "supervisor", "maintenance_manager", "planner", "operator"],
  "production.sku_performance.view": ["admin", "manager", "supervisor"],

  "planner.view": ["admin", "manager", "supervisor", "maintenance_manager", "planner"],
  "planner.manage": [],
  "sku.view": [],
  "sku.manage": ["admin", "manager", "planner"],

  "rag.view": ["admin", "manager", "supervisor", "maintenance_manager", "planner"],
  "rag.manage": ["admin", "manager", "supervisor", "maintenance_manager", "planner"],
  "rag.comment": ["admin", "manager", "supervisor", "planner"],

  "smarttarget.view": [],

  "quality.view": ["admin", "manager", "supervisor", "quality_supervisor", "engineer", "co_engineer"],
  "quality.manage": ["admin", "manager", "supervisor", "quality_supervisor"],

  "pm.view": ["admin", "manager", "supervisor", "maintenance_manager", "planner", "engineer", "co_engineer"],
  "pm.manage": ["admin", "manager", "maintenance_manager"],

  "engineers.view": ["admin", "manager", "supervisor", "maintenance_manager"],
  "engineers.manage": ["admin", "manager", "maintenance_manager"],
  "leaders.view": ["admin", "manager", "supervisor"],
  "leaders.manage": ["admin", "manager"],

  "chat.line": [],
  "chat.dm": ["admin", "manager", "supervisor", "operator"],

  "notifications.view": [...ALL, "quality_supervisor"],
  "notifications.manage": ["admin", "manager"],

  "intouch.view": ["admin", "manager", "maintenance_manager", "planner"],
  "intouch.manage": ["admin", "maintenance_manager"],

  "controlcenter.view": ["admin", "manager", "supervisor", "maintenance_manager", "planner"],
  "assets.manage": ["admin", "manager", "maintenance_manager"],

  "dashboard.executive": ["admin", "manager"],
  "dashboard.manager": ["admin", "manager", "supervisor", "maintenance_manager", "planner", "viewer"],
  "dashboard.engineer": ["admin", "manager", "supervisor", "maintenance_manager", "planner", "engineer", "co_engineer"],
  "dashboard.operator": ["admin", "manager", "maintenance_manager", "engineer", "co_engineer", "operator"],

  "reliability.view": ["admin", "manager", "supervisor", "maintenance_manager", "planner"],
  "suppliers.view": ["admin", "manager", "supervisor", "maintenance_manager", "planner"],

  "permissions.manage": ["admin"],
};

/**
 * Default landing route per role. Single source of truth used by
 * SessionRedirect (App.tsx) and ProtectedRoute access-denied fallback.
 */
export const roleDashMap: Record<Role, string> = {
  // Management lands on the live Control Center after login.
  admin: "/dashboard/control-center",
  manager: "/dashboard/control-center",
  maintenance_manager: "/dashboard/control-center",
  planner: "/dashboard/control-center",
  supervisor: "/dashboard/production-performance",
  engineer: "/dashboard/engineer",
  co_engineer: "/dashboard/engineer",
  operator: "/dashboard/operator/my-production",
  viewer: "/dashboard/manager",
  warehouse: "/dashboard/warehouse",
  quality_supervisor: "/dashboard/quality-report",
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

/**
 * Mobile visibility. Keys `${role}:${action}` present in this set are HIDDEN on
 * mobile for that role (loaded from `public.role_mobile_hidden`). Default = shown.
 */
let MOBILE_HIDDEN: Set<string> = new Set();
const mobileListeners = new Set<() => void>();

export function setMobileHidden(keys: string[]) {
  MOBILE_HIDDEN = new Set(keys ?? []);
  mobileListeners.forEach((l) => l());
}
export function subscribeMobileHidden(fn: () => void) {
  mobileListeners.add(fn);
  return () => { mobileListeners.delete(fn); };
}
export function isMobileHidden(role: Role, action: Action): boolean {
  return MOBILE_HIDDEN.has(`${role}:${action}`);
}
/** Can the role perform/see the action on a mobile device (access AND mobile-visible). */
export function canMobile(role: Role | null | undefined, action: Action): boolean {
  if (!role) return false;
  return can(role, action) && !MOBILE_HIDDEN.has(`${role}:${action}`);
}
/** Access on the current device: full `can` on desktop, `canMobile` on mobile. */
export function canOnDevice(role: Role | null | undefined, action: Action, isMobile: boolean): boolean {
  return isMobile ? canMobile(role, action) : can(role, action);
}

/** All known actions (for admin UIs). */
export const ALL_ACTIONS: Action[] = Object.keys(MATRIX) as Action[];
export const ALL_ROLES: Role[] = [...ALL, "warehouse", "quality_supervisor"];

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

/**
 * Presentation registry — shared between Permissions Matrix and any UI
 * that needs to describe actions to end-users. Single source of truth.
 */
export const ACTION_GROUPS: { key: string; label: string; actions: Action[] }[] = [
  { key: "wo", label: "Work Orders", actions: ["wo.view", "wo.create", "wo.update", "wo.close", "wo.delete", "wo.force", "wo.print"] },
  { key: "downtime", label: "Downtime", actions: ["downtime.view", "downtime.manage"] },
  { key: "machines", label: "Machines & Problems", actions: ["machines.view", "machines.manage", "problems.view", "problems.manage"] },
  { key: "stock", label: "Stock", actions: ["stock.view", "stock.manage", "stock.pricing"] },
  { key: "production", label: "Production", actions: ["production.view", "production.manage", "production.target.view", "production.target.manage", "production.performance.view", "production.sku_performance.view"] },
  { key: "planner", label: "Planner & SKU", actions: ["planner.view", "planner.manage", "sku.view", "sku.manage"] },
  { key: "rag", label: "RAG Weekly", actions: ["rag.view", "rag.manage", "rag.comment"] },
  { key: "smart", label: "Smart Target", actions: ["smarttarget.view"] },
  { key: "quality", label: "Quality", actions: ["quality.view", "quality.manage"] },
  { key: "pm", label: "Preventive Maint.", actions: ["pm.view", "pm.manage"] },
  { key: "eng", label: "Engineers & Leaders", actions: ["engineers.view", "engineers.manage", "leaders.view", "leaders.manage"] },
  { key: "chat", label: "Chat & Messages", actions: ["chat.line", "chat.dm"] },
  { key: "notif", label: "Notifications", actions: ["notifications.view", "notifications.manage"] },
  { key: "intouch", label: "iTouching", actions: ["intouch.view", "intouch.manage"] },
  { key: "cc", label: "Control Center", actions: ["controlcenter.view", "assets.manage"] },
  { key: "dash", label: "Dashboards", actions: ["dashboard.executive", "dashboard.manager", "dashboard.engineer", "dashboard.operator"] },
  { key: "users", label: "Users & Audit", actions: ["users.view", "users.manage", "audit.view"] },
  { key: "reports", label: "Reports", actions: ["reports.analytics", "reports.financial", "reports.executive", "reliability.view", "suppliers.view"] },
  { key: "system", label: "System", actions: ["system.clear", "system.settings", "permissions.manage"] },
];

export const ACTION_LABELS: Partial<Record<Action, string>> = {
  "chat.line": "Line Chat",
  "chat.dm": "Contact Supervisor / Manager",
};

export const ACTION_DESCRIPTIONS: Partial<Record<Action, string>> = {
  "wo.view": "See the Work Orders list and details.",
  "wo.create": "Open new Work Orders / maintenance requests.",
  "wo.update": "Edit fields, assign engineers, change status.",
  "wo.close": "Mark Work Orders as completed.",
  "wo.delete": "Permanently remove Work Orders.",
  "wo.force": "Force-close a WO bypassing normal flow (admin action).",
  "wo.print": "Print or export Work Orders to PDF.",
  "downtime.view": "See downtime events and history.",
  "downtime.manage": "Create, edit and close downtime events.",
  "machines.view": "Browse the machines registry.",
  "machines.manage": "Add, edit or archive machines.",
  "problems.view": "See the catalogue of standard problems.",
  "problems.manage": "Add, edit or archive problem descriptions.",
  "stock.view": "See parts inventory and balances.",
  "stock.manage": "Add, adjust or consume parts and suppliers.",
  "stock.pricing": "See and edit part unit prices and financial values.",
  "production.view": "See production sessions and current runs.",
  "production.manage": "Start, edit or close production sessions.",
  "production.target.view": "See production targets per line/shift.",
  "production.target.manage": "Create and edit production targets.",
  "production.performance.view": "Access the Production Performance dashboard.",
  "production.sku_performance.view": "Access the SKU Performance dashboard with AI insights.",
  "planner.view": "Open the Planner and see the plan.",
  "planner.manage": "Edit the plan and schedule SKUs.",
  "sku.view": "Browse SKU catalogue and line speeds.",
  "sku.manage": "Create, edit or import SKUs and speeds.",
  "rag.view": "Open the RAG Weekly board.",
  "rag.manage": "Edit RAG entries and status.",
  "rag.comment": "Add comments on RAG weekly entries.",
  "smarttarget.view": "Access the Smart Target analytics page.",
  "quality.view": "See quality actions and issues.",
  "quality.manage": "Create and close quality actions.",
  "pm.view": "See preventive maintenance schedules.",
  "pm.manage": "Create schedules and register executions.",
  "engineers.view": "See the engineers list.",
  "engineers.manage": "Add, edit or deactivate engineers.",
  "leaders.view": "See line leaders and their PINs.",
  "leaders.manage": "Add, edit or deactivate line leaders.",
  "chat.line": "Use the per-line chat button and screen.",
  "chat.dm": "Send direct messages to Supervisor / Manager.",
  "notifications.view": "See the notifications center.",
  "notifications.manage": "Configure and clear notifications.",
  "intouch.view": "Open the iTouching monitoring pages.",
  "intouch.manage": "Configure iTouching mappings and imports.",
  "controlcenter.view": "Access the live factory Control Center.",
  "assets.manage": "Manage mobile assets and machine locations.",
  "dashboard.executive": "Access the Executive dashboard.",
  "dashboard.manager": "Access the Manager dashboard.",
  "dashboard.engineer": "Access the Engineer dashboard.",
  "dashboard.operator": "Access the Operator dashboard.",
  "users.view": "See the Staff Members list.",
  "users.manage": "Create, edit or deactivate users and roles.",
  "audit.view": "See the audit log of security-sensitive events.",
  "reports.analytics": "Open the Analytics reports.",
  "reports.financial": "See financial reports (labour cost, stock value).",
  "reports.executive": "Access executive-level reports.",
  "reliability.view": "Access the Reliability dashboard (MTTR/MTBF, risk).",
  "suppliers.view": "Open the Suppliers directory.",
  "system.clear": "Bulk-clear operational data (dangerous, admin only).",
  "system.settings": "Change system-wide settings.",
  "permissions.manage": "Edit this Permissions Matrix.",
};

