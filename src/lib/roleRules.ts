/**
 * EVERYTHING HERE IS DERIVED FROM THE LIVE MATRIX, NEVER TYPED TWICE.
 *
 * What a role may and may not do is computed through `can(role, action)` over
 * `ALL_ACTIONS` at call time, so it reflects the matrix as it is right now, including
 * any override loaded from `role_permission_overrides`. A hand-written list of rules
 * would be right the day it is written and a lie the first time somebody edits the
 * matrix — and the whole value of the Role rules page is that it can be trusted.
 */
import {
  ACTION_DESCRIPTIONS,
  ACTION_GROUPS,
  ACTION_LABELS,
  ALL_ACTIONS,
  defaultCan,
  roleHolds,
  isDeviceHidden,
  isPermissionOverridden,
  type Action,
  type Role,
} from "@/lib/permissions";

export interface RuleEntry {
  action: Action;
  /** The sentence a person reads; falls back to the action key when undescribed. */
  description: string;
  /** True when the matrix default was changed for this role/action pair. */
  customised: boolean;
  /** What the shipped matrix says, ignoring any override — printed beside the badge. */
  defaultAllowed: boolean;
  hiddenOnTablet: boolean;
  hiddenOnMobile: boolean;
}

export interface RuleGroup {
  key: string;
  label: string;
  allowed: RuleEntry[];
  denied: RuleEntry[];
  /** The role holds nothing at all in this group — print one line, not every denial. */
  noAccessAtAll: boolean;
}

export interface RoleRules {
  role: Role;
  groups: RuleGroup[];
  allowed: Action[];
  denied: Action[];
  customisedCount: number;
}

/** `wo.force` means nothing to an auditor. Turn a bare key into readable words. */
function humaniseAction(action: Action): string {
  return action
    .split(".")
    .map((part) => part.replace(/_/g, " "))
    .join(" — ")
    .replace(/^\w/, (c) => c.toUpperCase());
}

/**
 * The sentence the reader gets: the written description first, then the short label
 * used by the permissions matrix, and only as a last resort a humanised key. A raw
 * `verb.resource` is never printed on a sheet somebody signs.
 */
export function describeAction(action: Action): string {
  return ACTION_DESCRIPTIONS[action] ?? ACTION_LABELS[action] ?? humaniseAction(action);
}

function entry(role: Role, action: Action): RuleEntry {
  return {
    action,
    description: describeAction(action),
    customised: isPermissionOverridden(role, action),
    defaultAllowed: defaultCan(role, action),
    hiddenOnTablet: isDeviceHidden(role, action, "tablet"),
    hiddenOnMobile: isDeviceHidden(role, action, "mobile"),
  };
}


/** Computes the can / cannot picture for a role. Exact complements over ALL_ACTIONS. */
export function deriveRoleRules(role: Role): RoleRules {
  const groups: RuleGroup[] = ACTION_GROUPS.map((g) => {
    const allowed: RuleEntry[] = [];
    const denied: RuleEntry[] = [];
    for (const action of g.actions) {
      (roleHolds(role, action) ? allowed : denied).push(entry(role, action));
    }
    return { key: g.key, label: g.label, allowed, denied, noAccessAtAll: allowed.length === 0 };
  });

  const allowed = ALL_ACTIONS.filter((a) => roleHolds(role, a));
  const denied = ALL_ACTIONS.filter((a) => !roleHolds(role, a));

  return {
    role,
    groups,
    allowed,
    denied,
    customisedCount: ALL_ACTIONS.filter((a) => isPermissionOverridden(role, a)).length,
  };
}

/** How many actions a role holds — used for the role list counts. */
export function countAllowed(role: Role): number {
  return ALL_ACTIONS.reduce((n, a) => n + (roleHolds(role, a) ? 1 : 0), 0);
}
