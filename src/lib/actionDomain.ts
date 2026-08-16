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

/**
 * What a safety occurrence cannot be saved without.
 *
 * Leader and line stay nullable in the table — tightening them would reject quality rows
 * that already exist — so the requirement lives here, on the way in. A safety row
 * missing either cannot be counted per leader or per line, and the weekly counts would
 * drop it without saying so.
 */
export function safetyFormBlockers(form: {
  domain?: string | null; safety_kind?: string | null;
  leader_name?: string | null; line?: string | null;
}): string[] {
  if (form.domain !== "safety") return [];
  const missing: string[] = [];
  if (!form.safety_kind) missing.push("Kind");
  if (!form.leader_name) missing.push("Leader");
  if (!form.line) missing.push("Line");
  return missing;
}
