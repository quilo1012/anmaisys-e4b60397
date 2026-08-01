import type { Database } from "@/integrations/supabase/types";

export type Role = Database["public"]["Enums"]["app_role"];

/**
 * All gated actions in the app. Add new keys as features grow.
 * Keep names verb-led and resource-suffixed: `verb.resource`.
 */
export type Action =
  // Maintenance Orders
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
  | "workforce.view"
  | "workforce.manage"
  | "quality.validate"
  | "quality.close"
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
  "wo.view": [...ALL, "warehouse", "production_office_admin"],
  "wo.create": ["admin", "manager", "supervisor", "maintenance_manager", "planner", "operator", "warehouse", "production_office_admin"],
  "wo.update": ["admin", "manager", "supervisor", "maintenance_manager", "planner", "engineer", "co_engineer", "production_office_admin"],
  "wo.delete": ["admin"],
  "wo.close": ["admin", "manager", "supervisor", "engineer", "co_engineer", "production_office_admin"],
  "wo.force": ["admin"],
  "wo.print": ["admin", "manager", "supervisor", "maintenance_manager", "planner", "production_office_admin"],

  "downtime.view": [...ALL, "production_office_admin"],
  "downtime.manage": ["admin", "manager", "supervisor", "engineer", "co_engineer", "production_office_admin"],

  "machines.view": [...ALL, "warehouse", "production_office_admin"],
  "machines.manage": ["admin", "manager", "supervisor", "production_office_admin"],

  "problems.view": [...ALL, "production_office_admin"],
  "problems.manage": ["admin", "manager", "supervisor", "production_office_admin"],

  "stock.view": ["admin", "manager", "supervisor", "maintenance_manager", "planner", "engineer", "co_engineer", "warehouse", "production_office_admin"],
  "stock.manage": ["admin", "manager", "supervisor", "maintenance_manager", "production_office_admin"],
  "stock.pricing": ["admin"],

  "users.view": ["admin", "manager"],
  "users.manage": ["admin", "manager"],
  "audit.view": ["admin", "manager", "supervisor"],

  "reports.analytics": ["admin", "manager", "supervisor", "production_office_admin"],

  "system.clear": ["admin"],
  "system.settings": ["admin"],

  "production.view": [...ALL, "production_office_admin"],
  // engineer/co_engineer intentionally excluded: they never edit production
  // (no RLS write path for them either). They keep production.view (read-only).
  "production.manage": ["admin", "manager", "supervisor", "maintenance_manager", "planner", "operator", "production_office_admin"],
  "production.target.view": ["admin", "manager", "supervisor", "maintenance_manager", "planner", "operator", "production_office_admin"],
  "production.target.manage": ["admin", "manager", "supervisor", "planner", "production_office_admin"],
  "production.performance.view": ["admin", "manager", "supervisor", "maintenance_manager", "planner", "operator", "production_office_admin"],
  // Packaging module: everyone who could open it before (production.view = ALL)
  // PLUS warehouse and quality_supervisor, for whom the PVS module is built.

  "planner.view": ["admin", "manager", "supervisor", "maintenance_manager", "planner", "production_office_admin"],
  "sku.view": ["production_office_admin"],
  "sku.manage": ["admin", "manager", "supervisor", "planner", "production_office_admin"],

  "rag.view": ["admin", "manager", "supervisor", "maintenance_manager", "planner", "production_office_admin"],
  "rag.manage": ["admin", "manager", "supervisor", "maintenance_manager", "planner", "production_office_admin"],
  // planner excluded: commenting wasn't part of the planner enablement (no RLS
  // insert path for planner either). supervisor is enabled to match RLS.
  "rag.comment": ["admin", "manager", "supervisor", "production_office_admin"],

  "smarttarget.view": ["production_office_admin"],

  "quality.view": ["admin", "manager", "supervisor", "quality_supervisor", "engineer", "co_engineer", "production_office_admin"],
  "quality.manage": ["admin", "manager", "supervisor", "quality_supervisor", "production_office_admin"],
  // The verdict and the closure are two different jobs, held by two different
  // people, and the database enforces exactly this split (enforce_quality_validation).
  // They are listed here so the screen offers what the database will accept: a
  // supervisor used to be shown the Validation control and got a raw Postgres
  // exception when they used it.
  // Headcount, attendance and overtime. Manager can read the board; editing
  // records (and the pay-relevant fields) stays with admin.
  "workforce.view": ["admin", "manager"],
  // Moving someone between lines and marking who turned up. Separate from viewing,
  // so a read-only account can be given later without also handing over the board.
  "workforce.manage": ["admin"],
  "quality.validate": ["admin", "quality_supervisor"],
  "quality.close": ["admin", "manager", "maintenance_manager"],

  "pm.view": ["admin", "manager", "supervisor", "maintenance_manager", "planner", "engineer", "co_engineer", "production_office_admin"],
  "pm.manage": ["admin", "manager", "maintenance_manager", "production_office_admin"],

  "engineers.view": ["admin", "manager", "supervisor", "maintenance_manager"],
  "engineers.manage": ["admin", "manager", "maintenance_manager"],
  "leaders.view": ["admin", "manager", "supervisor", "production_office_admin"],
  "leaders.manage": ["admin", "manager", "production_office_admin"],

  "chat.line": [],
  "chat.dm": ["admin", "manager", "supervisor", "operator"],

  "notifications.view": [...ALL, "quality_supervisor", "production_office_admin"],
  "notifications.manage": ["admin", "manager"],

  "intouch.view": ["admin", "manager", "maintenance_manager", "planner", "production_office_admin"],
  "intouch.manage": ["admin", "maintenance_manager"],

  "controlcenter.view": ["admin", "manager", "supervisor", "maintenance_manager", "planner", "production_office_admin"],
  "assets.manage": ["admin", "manager", "maintenance_manager", "production_office_admin"],

  "dashboard.executive": ["admin", "manager"],
  "dashboard.manager": ["admin", "manager", "supervisor", "maintenance_manager", "planner", "viewer", "production_office_admin"],
  "dashboard.engineer": ["admin", "manager", "supervisor", "maintenance_manager", "planner", "engineer", "co_engineer"],
  "dashboard.operator": ["admin", "manager", "maintenance_manager", "engineer", "co_engineer", "operator"],

  "reliability.view": ["admin", "manager", "supervisor", "maintenance_manager", "planner", "production_office_admin"],
  "suppliers.view": ["admin", "manager", "supervisor", "maintenance_manager", "planner", "production_office_admin"],

  "permissions.manage": ["admin"],
};

/**
 * Default landing route per role. Single source of truth used by
 * SessionRedirect (App.tsx) and ProtectedRoute access-denied fallback.
 */
export const roleDashMap: Record<Role, string> = {
  // Management lands on the Dashboard: the welcome, the live status strip, the KPIs
  // and every shortcut, on one screen. It used to be two — a welcome page and a
  // dashboard — and they drifted apart with every change.
  admin: "/dashboard/manager",
  manager: "/dashboard/manager",
  maintenance_manager: "/dashboard/manager",
  planner: "/dashboard/manager",
  supervisor: "/dashboard/production-performance",
  engineer: "/dashboard/engineer",
  co_engineer: "/dashboard/engineer",
  operator: "/dashboard/operator/my-production",
  viewer: "/dashboard/manager",
  warehouse: "/dashboard/warehouse",
  quality_supervisor: "/dashboard/quality",
  production_office_admin: "/dashboard/production-performance",
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
 * Per-device visibility. Keys `${role}:${action}:${device}` present in this set are
 * HIDDEN on that device for that role (loaded from `public.role_mobile_hidden`, which
 * carries a `device` column: 'tablet' | 'mobile'). Desktop is never hidden. Default = shown.
 */
export type DeviceType = "desktop" | "tablet" | "mobile";
let DEVICE_HIDDEN: Set<string> = new Set();
const deviceListeners = new Set<() => void>();

export function setDeviceHidden(keys: string[]) {
  DEVICE_HIDDEN = new Set(keys ?? []);
  deviceListeners.forEach((l) => l());
}
export function subscribeDeviceHidden(fn: () => void) {
  deviceListeners.add(fn);
  return () => { deviceListeners.delete(fn); };
}
export function isDeviceHidden(role: Role, action: Action, device: DeviceType): boolean {
  if (device === "desktop") return false;
  return DEVICE_HIDDEN.has(`${role}:${action}:${device}`);
}
/** Access on a given device: full `can` on desktop; tablet/mobile also require visibility. */
export function canForDevice(role: Role | null | undefined, action: Action, device: DeviceType): boolean {
  if (!role) return false;
  return can(role, action) && !isDeviceHidden(role, action, device);
}

// Backward-compatible mobile (phone) helpers.
export const subscribeMobileHidden = subscribeDeviceHidden;
export function isMobileHidden(role: Role, action: Action): boolean { return isDeviceHidden(role, action, "mobile"); }
export function canMobile(role: Role | null | undefined, action: Action): boolean { return canForDevice(role, action, "mobile"); }
export function canOnDevice(role: Role | null | undefined, action: Action, isMobile: boolean): boolean {
  return canForDevice(role, action, isMobile ? "mobile" : "desktop");
}

/** All known actions (for admin UIs). */
export const ALL_ACTIONS: Action[] = Object.keys(MATRIX) as Action[];
export const ALL_ROLES: Role[] = [...ALL, "warehouse", "quality_supervisor", "production_office_admin"];

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
  { key: "wo", label: "Maintenance Orders", actions: ["wo.view", "wo.create", "wo.update", "wo.close", "wo.delete", "wo.force", "wo.print"] },
  { key: "downtime", label: "Downtime", actions: ["downtime.view", "downtime.manage"] },
  { key: "machines", label: "Machines & Problems", actions: ["machines.view", "machines.manage", "problems.view", "problems.manage"] },
  { key: "stock", label: "Stock", actions: ["stock.view", "stock.manage", "stock.pricing"] },
  { key: "production", label: "Production", actions: ["production.view", "production.manage", "production.target.view", "production.target.manage", "production.performance.view"] },
  { key: "planner", label: "Planner & SKU", actions: ["planner.view", "sku.view", "sku.manage"] },
  { key: "rag", label: "RAG Weekly", actions: ["rag.view", "rag.manage", "rag.comment"] },
  { key: "smart", label: "Smart Target", actions: ["smarttarget.view"] },
  { key: "workforce", label: "Workforce & Overtime", actions: ["workforce.view", "workforce.manage"] },
  { key: "quality", label: "Quality", actions: ["quality.view", "quality.manage", "quality.validate", "quality.close"] },
  { key: "pm", label: "Preventive Maint.", actions: ["pm.view", "pm.manage"] },
  { key: "eng", label: "Engineers & Leaders", actions: ["engineers.view", "engineers.manage", "leaders.view", "leaders.manage"] },
  { key: "chat", label: "Chat & Messages", actions: ["chat.line", "chat.dm"] },
  { key: "notif", label: "Notifications", actions: ["notifications.view", "notifications.manage"] },
  { key: "intouch", label: "iTouching", actions: ["intouch.view", "intouch.manage"] },
  { key: "cc", label: "Control Center", actions: ["controlcenter.view", "assets.manage"] },
  { key: "dash", label: "Dashboards", actions: ["dashboard.executive", "dashboard.manager", "dashboard.engineer", "dashboard.operator"] },
  { key: "users", label: "Users & Audit", actions: ["users.view", "users.manage", "audit.view"] },
  { key: "reports", label: "Reports", actions: ["reports.analytics", "reliability.view", "suppliers.view"] },
  { key: "system", label: "System", actions: ["system.clear", "system.settings", "permissions.manage"] },
];

export const ACTION_LABELS: Partial<Record<Action, string>> = {
  "chat.line": "Line Chat",
  "chat.dm": "Contact Supervisor / Manager",
};

export const ACTION_DESCRIPTIONS: Partial<Record<Action, string>> = {
  "wo.view": "See the Maintenance Orders list and details.",
  "wo.create": "Open new Maintenance Orders / maintenance requests.",
  "wo.update": "Edit fields, assign engineers, change status.",
  "wo.close": "Mark Maintenance Orders as completed.",
  "wo.delete": "Permanently remove Maintenance Orders.",
  "wo.force": "Force-close a WO bypassing normal flow (admin action).",
  "wo.print": "Print or export Maintenance Orders to PDF.",
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
  "planner.view": "Open the Planner and see the plan.",
  "sku.view": "Browse SKU catalogue and line speeds.",
  "sku.manage": "Create, edit or import SKUs and speeds.",
  "rag.view": "Open the RAG Weekly board.",
  "rag.manage": "Edit RAG entries and status.",
  "rag.comment": "Add comments on RAG weekly entries.",
  "smarttarget.view": "Access the Smart Target analytics page.",
  "quality.view": "See quality actions and issues.",
  "quality.manage": "Create and edit quality actions.",
  "workforce.view": "See the Workforce / Overtime dashboard (headcount, overtime, attendance).",
  "workforce.manage": "Edit attendance, overtime and employee records.",
  "quality.validate": "Validate or reject a quality action — the audit verdict, evidence required.",
  "quality.close": "Approve the closure of a quality action once Quality has ruled on it.",
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
  "reliability.view": "Access the Reliability dashboard (MTTR/MTBF, risk).",
  "suppliers.view": "Open the Suppliers directory.",
  "system.clear": "Bulk-clear operational data (dangerous, admin only).",
  "system.settings": "Change system-wide settings.",
  "permissions.manage": "Edit this Permissions Matrix.",
};

