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
  | "system.hub"
  | "system.diagnostics"
  | "system.shiftpasswords"
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
  // Leader Scorecard
  | "scorecard.fill"
  | "scorecard.approve"
  // Smart Target
  | "smarttarget.view"
  // Quality
  | "quality.view"
  | "quality.manage"
  | "workforce.view"
  | "workforce.manage"
  | "quality.validate"
  | "quality.close"
  // Production Headcount
  | "headcount.view"
  | "headcount.manage"
  | "attendance.manage"
  | "downtime.adjust"
  | "downtime.correct"
  | "reports.export"

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
  | "chat.settings"
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
  | "dashboard.warehouse"
  // Reliability / Suppliers (dedicated view actions)
  | "reliability.view"
  | "suppliers.view"
  // Permissions matrix
  | "permissions.manage";

/**
 * The roles a person is given TODAY. Four values of the `app_role` enum — `supervisor`,
 * `planner`, `viewer` and `co_engineer` — were retired on 10/09/2026: nobody held them,
 * and everything they could do is covered by the eight below. The enum in the database
 * is untouched, and so are the `Record<Role, …>` maps further down: an old record
 * carrying a retired value must go on rendering, it simply holds no action any more.
 *
 * Order = authority. This is the list the Permissions page, the Role rules page and the
 * role picker in ManageUsers walk — NOT `ALL_ROLES`.
 */
export const ACTIVE_ROLES: Role[] = [
  "admin",
  "manager",
  "production_office_admin",
  "maintenance_manager",
  "engineer",
  "quality_supervisor",
  "warehouse",
  "operator",
];

/**
 * The shorthand several matrix rows spread with `...ALL`: the active roles minus the
 * three that are granted case by case (warehouse, quality_supervisor,
 * production_office_admin). It used to also carry the four retired values.
 */
const ALL: Role[] = ["admin", "manager", "maintenance_manager", "engineer", "operator"];

const MATRIX: Record<Action, Role[]> = {
  "wo.view": [...ALL, "warehouse", "production_office_admin"],
  "wo.create": ["admin", "manager", "maintenance_manager", "operator", "warehouse", "production_office_admin"],
  "wo.update": ["admin", "manager", "maintenance_manager", "engineer", "production_office_admin"],
  "wo.delete": ["admin"],
  "wo.close": ["admin", "manager", "engineer", "production_office_admin"],
  // Forcing an order shut is maintenance work, not only an admin's: the maintenance
  // manager signs off the stoppage record and did it 16 times in a month while the
  // matrix said he could not. The screen asks `can(role, "wo.force")` now, so the
  // rule and the button say the same thing.
  "wo.force": ["admin", "maintenance_manager"],
  "wo.print": ["admin", "manager", "maintenance_manager", "production_office_admin"],

  "downtime.view": [...ALL, "production_office_admin"],
  "downtime.manage": ["admin", "manager", "engineer", "production_office_admin"],

  "machines.view": [...ALL, "warehouse", "production_office_admin"],
  "machines.manage": ["admin", "manager", "production_office_admin"],

  "problems.view": [...ALL, "production_office_admin"],
  "problems.manage": ["admin", "manager", "production_office_admin"],

  "stock.view": ["admin", "manager", "maintenance_manager", "engineer", "warehouse", "production_office_admin"],
  "stock.manage": ["admin", "manager", "maintenance_manager", "production_office_admin"],
  "stock.pricing": ["admin"],

  "users.view": ["admin", "manager"],
  "users.manage": ["admin", "manager"],
  "audit.view": ["admin", "manager"],

  "reports.analytics": ["admin", "manager", "production_office_admin"],

  "system.clear": ["admin"],
  "system.settings": ["admin"],
  // The System hub gathers the audit trail, the integration settings and the
  // diagnostics behind one door. Admin only, by decision: a manager keeps the Users
  // screen (users.manage) and nothing else that lives in there.
  "system.hub": ["admin"],
  "system.diagnostics": ["admin"],
  "system.shiftpasswords": ["admin"],

  "production.view": [...ALL, "production_office_admin"],
  // engineer intentionally excluded: they never edit production (no RLS write path
  // for them either). They keep production.view (read-only).
  "production.manage": ["admin", "manager", "maintenance_manager", "operator", "production_office_admin"],
  "production.target.view": ["admin", "manager", "maintenance_manager", "operator", "production_office_admin"],
  "production.target.manage": ["admin", "manager", "production_office_admin"],
  // quality_supervisor added 08/09/2026. The two accounts holding it fill in and
  // approve the leader scorecard (scorecard.fill / scorecard.approve), and a
  // leader's card is opened from Production Performance — scorecardPath() is built
  // there and nowhere else.
  "production.performance.view": ["admin", "manager", "quality_supervisor", "maintenance_manager", "operator", "production_office_admin"],

  "planner.view": ["admin", "manager", "maintenance_manager", "production_office_admin"],
  "sku.view": ["admin", "production_office_admin"],
  "sku.manage": ["admin", "manager", "production_office_admin"],

  "rag.view": ["admin", "manager", "maintenance_manager", "production_office_admin"],
  "rag.manage": ["admin", "manager", "maintenance_manager", "production_office_admin"],
  "rag.comment": ["admin", "manager", "production_office_admin"],

  "scorecard.fill": ["admin", "manager", "quality_supervisor", "production_office_admin"],
  // Mais restrita do que preencher, de proposito: aprovar uma semana com Fail e o
  // controlo que impede uma investigacao de ser dispensada por quem a devia fazer.
  "scorecard.approve": ["admin", "manager", "quality_supervisor"],

  "smarttarget.view": ["admin", "production_office_admin"],

  "quality.view": ["admin", "manager", "quality_supervisor", "engineer", "production_office_admin"],
  "quality.manage": ["admin", "manager", "quality_supervisor", "production_office_admin"],
  // Headcount, attendance and overtime. Admin only, viewing included: the module is
  // still paused and off the menu, and the route stays live, so anyone holding this
  // reaches the board by URL.
  "workforce.view": ["admin"],
  // Moving someone between lines and marking who turned up. Separate from viewing,
  // so a read-only account can be given later without also handing over the board.
  "workforce.manage": ["admin"],
  // The verdict and the closure are two different jobs, held by two different
  // people, and the database enforces exactly this split (enforce_quality_validation).
  "quality.validate": ["admin", "quality_supervisor"],
  "quality.close": ["admin", "manager", "maintenance_manager"],

  // Production Headcount (Day/Night allocation board). Admin only, viewing included,
  // and deliberately narrower than the board deserves: the allocation is still being
  // built and the day opens mostly empty.
  "headcount.view": ["admin"],
  "headcount.manage": ["admin"],
  "attendance.manage": ["admin", "manager"],
  "downtime.adjust": ["admin", "manager", "maintenance_manager", "engineer"],
  // Rewriting a stoppage number that is already on the record is deliberately
  // narrower than `downtime.adjust`: it changes how a line and an engineer are
  // measured, so only the admin and the maintenance manager may do it.
  "downtime.correct": ["admin", "maintenance_manager"],
  // production_office_admin builds the boards — the weekly RAG and the targets — so
  // taking the CSV/Excel/PDF export off them would be a regression the day the six
  // accounts move across from admin.
  "reports.export": ["admin", "manager", "production_office_admin"],

  "pm.view": ["admin", "manager", "maintenance_manager", "engineer", "production_office_admin"],
  // O engineer cria e corrige o proprio plano de preventiva.
  "pm.manage": ["admin", "manager", "maintenance_manager", "engineer", "production_office_admin"],

  "engineers.view": ["admin", "manager", "maintenance_manager"],
  "engineers.manage": ["admin", "manager", "maintenance_manager"],
  "leaders.view": ["admin", "manager", "production_office_admin"],
  "leaders.manage": ["admin", "manager", "production_office_admin"],

  "chat.line": [...ALL, "warehouse", "quality_supervisor", "production_office_admin"],
  "chat.dm": ["admin", "manager", "operator"],
  // Who may name the chat administrators the operators write to.
  "chat.settings": ["admin", "manager"],


  "notifications.view": [...ALL, "quality_supervisor", "production_office_admin"],
  "notifications.manage": ["admin", "manager"],

  "intouch.view": ["admin", "manager", "maintenance_manager", "production_office_admin"],
  "intouch.manage": ["admin", "maintenance_manager"],

  "controlcenter.view": ["admin", "manager", "maintenance_manager", "production_office_admin"],
  "assets.manage": ["admin", "manager", "maintenance_manager", "production_office_admin"],

  "dashboard.executive": ["admin", "manager"],
  "dashboard.manager": ["admin", "manager", "maintenance_manager", "production_office_admin"],
  "dashboard.engineer": ["admin", "manager", "maintenance_manager", "engineer"],
  "dashboard.operator": ["admin", "manager", "maintenance_manager", "engineer", "operator"],
  "dashboard.warehouse": ["admin", "warehouse"],

  "reliability.view": ["admin", "manager", "maintenance_manager", "production_office_admin"],
  "suppliers.view": ["admin", "manager", "maintenance_manager", "production_office_admin"],

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

/**
 * A conta owner — a válvula de segurança, e a única coisa que passa sempre.
 *
 * O `admin` deixou de ter passe livre: é resolvido pela MATRIX e pelos overrides como
 * qualquer outro perfil, para que a página de permissões diga a verdade sobre o que um
 * admin alcança. O que substitui esse bypass é uma conta, não um papel: quem estiver em
 * `public.app_owner` passa em tudo, e é por isso que nenhuma edição de permissões
 * consegue trancar toda a gente para fora.
 *
 * Vive num sinalizador de módulo em vez de num argumento porque `can(role, action)` é
 * chamado em ~74 ficheiros; o AuthContext liga-o uma vez, à entrada.
 */
let IS_OWNER = false;
const ownerListeners = new Set<() => void>();

export function setIsOwner(v: boolean) {
  if (IS_OWNER === v) return;
  IS_OWNER = v;
  ownerListeners.forEach((l) => l());
}
export function subscribeIsOwner(fn: () => void) {
  ownerListeners.add(fn);
  return () => { ownerListeners.delete(fn); };
}
export function isOwnerSession(): boolean {
  return IS_OWNER;
}

/**
 * What a ROLE holds — the matrix plus any override, and deliberately NOT the owner
 * bypass in `can()`. `can()` answers "may this session do this", which for the app
 * owner is always yes; that is the right answer for a button and the wrong one for a
 * page describing what a role is allowed to do. Read this from anything that
 * DESCRIBES permissions rather than enforcing them.
 */
export function roleHolds(role: Role, action: Action): boolean {
  const key = `${role}:${action}`;
  if (key in OVERRIDES) return OVERRIDES[key];
  return MATRIX[action]?.includes(role) ?? false;
}

/** Returns true if the given role can perform the action. Null role → false. */
export function can(role: Role | null | undefined, action: Action): boolean {
  // A válvula de segurança, e o único passe livre que resta. Vem antes do teste de
  // papel de propósito: o owner passa mesmo que o papel ainda não tenha resolvido.
  if (IS_OWNER) return true;
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
/**
 * Every value the `app_role` enum has ever carried — including the four retired on
 * 10/09/2026. Kept whole so an account or an override saved against a retired role can
 * still be counted and shown. Use `ACTIVE_ROLES` for anything a person picks today.
 */
export const ALL_ROLES: Role[] = [
  "admin", "manager", "supervisor", "maintenance_manager", "planner", "engineer",
  "co_engineer", "operator", "viewer", "warehouse", "quality_supervisor",
  "production_office_admin",
];

/**
 * The display name of each role, in one place.
 *
 * It used to live inside DashboardLayout, which meant any other screen naming a role
 * either imported a layout component or wrote the twelve names out again.
 */
export const roleTitle: Record<Role, string> = {
  admin: "Admin",
  manager: "Manager",
  supervisor: "Supervisor",
  maintenance_manager: "Maintenance Manager",
  planner: "Planner",
  engineer: "Engineer",
  co_engineer: "Co-Engineer",
  operator: "Operator",
  viewer: "Viewer",
  warehouse: "Warehouse Admin",
  quality_supervisor: "Quality Supervisor",
  production_office_admin: "Production Office",
};

/**
 * One plain sentence per role, for a person on the factory floor. This is the only
 * hand-written text about a role anywhere: everything else on the Role rules page is
 * derived from the live matrix, so it cannot fall out of date.
 */
export const ROLE_SUMMARY: Record<Role, string> = {
  admin: "Runs the system: every screen, every setting, and the things nobody else may touch.",
  manager: "Runs the factory day: sees every board, approves work, and manages the people and their accounts.",
  supervisor: "Retired profile. What it did is now split between Manager and Production Office.",
  maintenance_manager: "Runs maintenance: the engineers, the preventive plan, the parts and the stoppage record.",
  planner: "Retired profile. Planning the SKUs, the targets and the reports is now Production Office work.",
  engineer: "Fixes machines: takes maintenance orders, records what was done and keeps the preventive plan.",
  co_engineer: "Retired profile. An account still carrying it works as an Engineer — the inheritance is kept on purpose.",
  operator: "Runs a line: logs production, raises maintenance calls, sees their own targets.",
  viewer: "Retired profile. Read-only access is no longer given as a profile of its own; Manager covers it.",
  warehouse: "Runs the store: parts in and out, and the service requests that come from the floor.",
  quality_supervisor: "Owns quality: raises and rules on quality actions, and signs off the leader scorecards.",
  production_office_admin: "The production office: keeps the boards, the plan and the paperwork behind the lines up to date.",
};


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
 * Printing or exporting a report — Analytics, Reports, and anything else that puts a
 * period on paper.
 *
 * It exists because the Analytics page had the rule written out by hand:
 * `role !== "admin" && (role !== "manager" && role !== "maintenance_manager")`. That is
 * a fourth authorization model living beside the matrix, and it disagreed with it in
 * both directions — a supervisor holds `reports.export` and was refused, a
 * maintenance_manager holds neither `reports.export` nor `reports.analytics` and was
 * waved through by a branch he could never reach.
 *
 * Named rather than inlined, like canUseLineChat above: a screen asks "may this person
 * print?", not "is this person one of these four strings", and only the second of those
 * questions can drift away from the matrix without anybody noticing.
 */
export function canPrintReport(role: Role | null | undefined): boolean {
  return can(role, "reports.export");
}

/**
 * Presentation registry — shared between Permissions Matrix and any UI
 * that needs to describe actions to end-users. Single source of truth.
 */
export const ACTION_GROUPS: { key: string; label: string; actions: Action[] }[] = [
  { key: "wo", label: "Maintenance Orders", actions: ["wo.view", "wo.create", "wo.update", "wo.close", "wo.delete", "wo.force", "wo.print"] },
  { key: "downtime", label: "Downtime", actions: ["downtime.view", "downtime.manage", "downtime.adjust", "downtime.correct"] },
  { key: "machines", label: "Machines & Problems", actions: ["machines.view", "machines.manage", "problems.view", "problems.manage"] },
  { key: "stock", label: "Stock", actions: ["stock.view", "stock.manage", "stock.pricing"] },
  { key: "production", label: "Production", actions: ["production.view", "production.manage", "production.target.view", "production.target.manage", "production.performance.view"] },
  { key: "planner", label: "Planner & SKU", actions: ["planner.view", "sku.view", "sku.manage"] },
  { key: "rag", label: "RAG Weekly", actions: ["rag.view", "rag.manage", "rag.comment"] },
  { key: "scorecard", label: "Leader Scorecard", actions: ["scorecard.fill", "scorecard.approve"] },
  { key: "smart", label: "Smart Target", actions: ["smarttarget.view"] },
  { key: "workforce", label: "Workforce & Overtime", actions: ["workforce.view", "workforce.manage", "attendance.manage"] },
  { key: "headcount", label: "Production Headcount", actions: ["headcount.view", "headcount.manage"] },
  { key: "quality", label: "Quality", actions: ["quality.view", "quality.manage", "quality.validate", "quality.close"] },
  { key: "pm", label: "Preventive Maint.", actions: ["pm.view", "pm.manage"] },
  { key: "eng", label: "Engineers & Leaders", actions: ["engineers.view", "engineers.manage", "leaders.view", "leaders.manage"] },
  { key: "chat", label: "Chat & Messages", actions: ["chat.line", "chat.dm", "chat.settings"] },
  { key: "notif", label: "Notifications", actions: ["notifications.view", "notifications.manage"] },
  { key: "intouch", label: "iTouching", actions: ["intouch.view", "intouch.manage"] },
  { key: "cc", label: "Control Center", actions: ["controlcenter.view", "assets.manage"] },
  { key: "dash", label: "Dashboards", actions: ["dashboard.executive", "dashboard.manager", "dashboard.engineer", "dashboard.operator", "dashboard.warehouse"] },
  { key: "users", label: "Users & Audit", actions: ["users.view", "users.manage", "audit.view"] },
  { key: "reports", label: "Reports", actions: ["reports.analytics", "reports.export", "reliability.view", "suppliers.view"] },
  { key: "system", label: "System", actions: ["system.hub", "system.clear", "system.settings", "system.shiftpasswords", "system.diagnostics", "permissions.manage"] },
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
  "downtime.adjust": "Adjust downtime records (exclusions, corrections).",
  "downtime.correct": "Correct a recorded stoppage's start, end or duration (logged with the corrector's name).",
  "headcount.view": "See the daily Production Headcount board (Day / Night).",
  "headcount.manage": "Allocate people to areas and record absence, holidays and overtime.",
  "attendance.manage": "Record attendance for the shift.",
  "reports.export": "Export reports to CSV / Excel / PDF.",
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
  "scorecard.fill": "Fill in and submit a leader's weekly scorecard.",
  "scorecard.approve": "Approve a submitted week, including one carrying a CAPA.",
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
  "chat.settings": "Choose who the operators reach when they write from a line.",
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
  "dashboard.warehouse": "Access the Warehouse dashboard and its service requests.",
  "users.view": "See the Staff Members list.",
  "users.manage": "Create, edit or deactivate users and roles.",
  "audit.view": "See the audit log of security-sensitive events.",
  "reports.analytics": "Open the Analytics reports.",
  "reliability.view": "Access the Reliability dashboard (MTTR/MTBF, risk).",
  "suppliers.view": "Open the Suppliers directory.",
  "system.clear": "Bulk-clear operational data (dangerous, admin only).",
  "system.settings": "Change system-wide settings.",
  "system.hub": "Open the System hub — setup, integrations and the audit trail behind one door.",
  "system.diagnostics": "Open Root Diagnostics (raw system state, for troubleshooting).",
  "system.shiftpasswords": "Set the shift passwords the line tablets are unlocked with.",
  "permissions.manage": "Edit this Permissions Matrix.",
};

