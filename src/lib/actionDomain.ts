export type ActionDomainFilter = "quality" | "safety" | "all";

/**
 * A row written before the `domain` column existed is quality — that is what the
 * column's default says, and reading it any other way would make the whole existing
 * log vanish from its own tab.
 */
export function domainOf(action: { domain?: string | null }): "quality" | "safety" {
  return action.domain === "safety" ? "safety" : "quality";
}

// T is intentionally unconstrained: a row typed with no `domain` field at all (as an
// action recorded before the column existed would be) is a legitimate caller, and
// binding T to `{ domain?: ... }` makes TS flag that call as a weak-type mismatch.
export function filterByDomain<T>(actions: T[], filter: ActionDomainFilter): T[] {
  return filter === "all" ? actions : actions.filter((a) => domainOf(a as { domain?: string | null }) === filter);
}
