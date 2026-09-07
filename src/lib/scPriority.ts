/**
 * Showing a SafetyCulture priority to a person.
 *
 * SafetyCulture sends a UUID and no name for it, so a record can be in one of three
 * states and the screen has to tell them apart: named, sent-but-not-yet-named, and
 * absent. Printing the UUID for the middle one would look like data and read as
 * noise; leaving it blank would hide a gap somebody can actually close.
 */

/** What a row shows in the Priority column. `null` means the column reads "—". */
export function priorityDisplay(action: {
  external_priority?: string | null;
  external_priority_id?: string | null;
}): string | null {
  const name = (action.external_priority ?? "").trim();
  if (name) return name;
  // SafetyCulture sent a priority; nobody has said what it is called yet.
  return action.external_priority_id ? "Not mapped" : null;
}

const ORDER = ["high", "medium", "low"];

/**
 * Most urgent first, and anything unrecognised after the three known ones rather
 * than sorted in among them — a name nobody has ranked is not a rank.
 */
export function priorityRank(name: string | null | undefined): number {
  const i = ORDER.indexOf((name ?? "").trim().toLowerCase());
  return i === -1 ? ORDER.length : i;
}

/**
 * How much of the eye a priority gets.
 *
 * Deliberately weight, not colour. Colour on this table is already spoken for:
 * severity has a badge and labels are tinted by which vocabulary they came from. And
 * priority now FEEDS severity — giving it a second colour scale would paint one fact
 * twice, in two competing languages.
 */
export function priorityWeight(name: string | null | undefined): string {
  switch ((name ?? "").trim().toLowerCase()) {
    case "high":
      return "font-semibold text-foreground";
    case "medium":
      return "text-foreground";
    case "low":
      return "text-muted-foreground";
    case "not mapped":
      return "text-muted-foreground italic";
    default:
      return "text-foreground";
  }
}
