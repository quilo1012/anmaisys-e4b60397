/**
 * When a PIN-locked section locks itself again.
 *
 * The unlock used to last until the tab was closed, which in practice meant all day:
 * somebody unlocks the board in the morning, goes to Work Orders, comes back at four
 * and walks straight in. A lock that only engages when you shut the browser is not
 * guarding the laptop left open in the office, which is the whole reason it exists.
 *
 * So the section locks the moment you leave it — and only then. Moving between its
 * own tabs does not re-ask, because a PIN typed four times an hour stops being a lock
 * and becomes a habit somebody works around. Leaving for anywhere else does.
 */

/** The routes that make up each locked section. Leaving all of them re-locks it. */
export const PIN_SECTION_PATHS: Record<string, string[]> = {
  workforce: [
    "/dashboard/headcount",
    "/dashboard/people",
    "/dashboard/leave",
    "/dashboard/attendance",
    "/dashboard/finance-close",
  ],
};

/**
 * Whether landing on `nextPath` should re-lock `storageKey`.
 *
 * A section with no paths listed locks on any navigation, which is the safe default
 * for a screen nobody has grouped yet. An empty or unknown next path is treated as
 * leaving: a lock that stays open because it could not tell where you went is the
 * failure mode worth avoiding.
 */
export function shouldRelock(storageKey: string, nextPath: string | null | undefined): boolean {
  const paths = PIN_SECTION_PATHS[storageKey];
  if (!paths?.length) return true;
  if (!nextPath) return true;
  // Prefix match so a detail route under a section — /dashboard/leave/123 — counts as
  // still inside it. Exact-only would lock the section every time somebody opened a
  // record from it and came back.
  return !paths.some((p) => nextPath === p || nextPath.startsWith(`${p}/`));
}
