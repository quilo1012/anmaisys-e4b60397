import { useAuth } from "@/contexts/AuthContext";
import { can, canAny, canAll, type Action, type Role } from "@/lib/permissions";

/**
 * Convenience hook bridging AuthContext.role with the permission matrix.
 *
 * Usage:
 *   const { role, can } = useRole();
 *   if (can("wo.delete")) { ... }
 */
export function useRole() {
  const { role, loading } = useAuth();
  const r: Role | null = role ?? null;

  return {
    role: r,
    loading,
    is: (target: Role) => r === target,
    isAny: (targets: Role[]) => !!r && targets.includes(r),
    can: (action: Action) => can(r, action),
    canAny: (actions: Action[]) => canAny(r, actions),
    canAll: (actions: Action[]) => canAll(r, actions),
  };
}
