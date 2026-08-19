/**
 * How a leader's name is matched against a column that stores it as free text.
 *
 * The same person is spelled two ways in this database and has been for months:
 * `leader_pins` holds HENRIQUE, CAINAN, FILIPI, KAZ and JULIANO in capitals, while
 * `production_sessions.leader_name` and `quality_actions.leader_name` hold Henrique,
 * Cainan, Filipi, Kaz and Juliano. The two are filled in by different hands — a
 * quality action takes its name from `line_leaders`, a session from whoever typed it
 * on the tablet — and nothing has ever forced them to agree about capitals.
 *
 * `.eq()` is case-sensitive, and the damage it does here is silent and one-sided. A
 * card opened for "Cainan" found his twelve production sessions and none of his
 * quality actions, then printed "No quality action was raised against this leader in
 * this period" over Quality 100%. A leader's worst month and their cleanest month
 * render identically when the name does not match, and the failure always flatters —
 * which is why nobody reports it.
 *
 * The real fix is a foreign key: `quality_actions.leader_id` already exists and
 * `scorecard_safety_counts` counts on it. But `production_sessions` has no such
 * column, so until it does there is a name comparison in the middle of this score,
 * and it must at least be the forgiving kind.
 */

/**
 * `%` and `_` are wildcards to `ilike`, so a name containing either would match rows
 * belonging to other people. No leader is spelled that way today; this is here so the
 * day one is, the score does not quietly widen instead of breaking.
 */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/**
 * The pattern for an exact, case-insensitive match — no wildcards of its own.
 *
 * Surrounding whitespace is dropped because a name arrives here from a URL segment,
 * and a trailing space in a hand-edited or mail-wrapped link is not a different
 * person.
 */
export function leaderNamePattern(leaderName: string): string {
  return escapeLikePattern(leaderName.trim());
}

/**
 * The same forgiveness, for a join done in memory rather than in the database.
 *
 * `leaderNamePattern` is for `ilike`; this is for `Map` keys. Analytics builds its
 * Leader Performance card by grouping production sessions by name and then looking up
 * each leader's quality actions by that name — two maps, one key, and until now no
 * case folding on either side. For the five leaders the log spells in capitals the
 * lookup simply missed, and the row rendered with their real production, zero open
 * actions, and a score computed over no quality actions at all.
 *
 * Group by this; display the name the row actually carries. The key is for matching
 * and is not fit to show anyone.
 *
 * Empty for a blank name, and never a group of its own: the callers skip it. Bucketing
 * the unnamed rows together would invent a leader called nothing and hang everybody's
 * orphaned actions on them.
 */
export function leaderNameKey(leaderName: string | null | undefined): string {
  return String(leaderName ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * The id of the leader a free-text name belongs to — or null, said out loud.
 *
 * Written for the Excel import, which reads a "Leader" column and had no way to turn
 * it into `quality_actions.leader_id`. Every imported row landed with a name and a
 * null id, and `scorecard_safety_counts` counts on the id, so imported occurrences
 * counted against nobody. The board showed them; no weekly card did.
 *
 * Exactly one match, or nothing. This is the same rule the migration used when it
 * rehomed the ids already in the table (20260819092343), and it is a rule rather than
 * a nicety: two leaders can share a first name, and this database stores first names.
 * Picking either one moves a real occurrence onto an innocent leader's card, where it
 * costs them points they cannot appeal because the row looks like theirs. A null costs
 * the count one row and tells the truth — `leader_name` still prints beside it.
 *
 * Blank never matches, on either side. An empty cell and a leader row with an empty
 * name would otherwise find each other, and every unnamed import would be attributed
 * to the same accidental person.
 *
 * Match against ALL leaders, not just the active ones. An import is usually history,
 * and history contains people who have since left; filtering by `active` would drop
 * exactly the rows nobody is left to notice are missing.
 */
export function resolveLeaderId(
  leaderName: string | null | undefined,
  leaders: ReadonlyArray<{ id: string; name: string }>,
): string | null {
  const key = leaderNameKey(leaderName);
  if (!key) return null;
  const matches = leaders.filter((l) => leaderNameKey(l.name) === key);
  return matches.length === 1 ? matches[0].id : null;
}
