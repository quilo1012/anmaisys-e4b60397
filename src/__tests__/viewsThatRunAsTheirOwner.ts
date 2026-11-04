const ON = String.raw`security_invoker\s*=\s*'?(?:true|on)\b`;

/**
 * The views a migration creates or replaces that will run as their owner: no
 * `security_invoker = true` in the view's own header, and no `ALTER VIEW … SET
 * (security_invoker = true)` for it later in the same migration. Comments are not SQL,
 * so a view inside one does not count and neither does the option written in one.
 */
export function viewsThatRunAsTheirOwner(sql: string): string[] {
  const code = sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
  const views =
    /create\s+(?:or\s+replace\s+)?(?:(?:temp|temporary|recursive)\s+)*view\s+(?:if\s+not\s+exists\s+)?(?:"?\w+"?\.)?"?(\w+)"?([\s\S]*?)\bas\b/gi;
  const owners: string[] = [];
  for (const m of code.matchAll(views)) {
    const [, name, header] = m;
    if (new RegExp(ON, "i").test(header)) continue;
    const later = code.slice(m.index! + m[0].length);
    const setLater = new RegExp(
      String.raw`alter\s+view\s+(?:if\s+exists\s+)?(?:"?\w+"?\.)?"?${name}"?\s+set\s*\([^)]*${ON}`,
      "i",
    );
    if (!setLater.test(later)) owners.push(name);
  }
  return owners;
}
