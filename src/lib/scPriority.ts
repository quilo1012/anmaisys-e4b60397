/**
 * Showing a SafetyCulture priority to a person.
 *
 * SafetyCulture sends a UUID and no name for it, so a record can be in one of three
 * states and the screen has to tell them apart: named, sent-but-not-yet-named, and
 * absent. Printing the UUID for the middle one would look like data and read as
 * noise; leaving it blank would hide a gap somebody can actually close.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What a row shows in the Priority column. `null` means the column reads "—". */
export function priorityDisplay(action: {
  external_priority?: string | null;
  external_priority_id?: string | null;
}): string | null {
  const name = (action.external_priority ?? "").trim();
  // A UUID sitting in the NAME column is not a name.
  //
  // This function's whole contract is that a UUID never reaches the screen, and it
  // was reading `external_priority` as trustworthy to keep it. It is not: a sync
  // build older than the one that split the two columns writes the id into both, and
  // sixty-six rows in the log printed `16ba4717-adc9-4d48-bf7c-044cfe0d2727` where
  // the word "Low" belonged. Checking the shape costs one regex and makes the
  // promise hold whatever wrote the row.
  if (name && !UUID.test(name)) return name;
  // SafetyCulture sent a priority; nobody has said what it is called yet.
  return (name || action.external_priority_id) ? "Not mapped" : null;
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
