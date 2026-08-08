/**
 * The colour iTouching paints each stop code, taken from the Intouch
 * configuration for the AppliedNutrition instance and checked against the pixels
 * of the live panel: "No Planned Shift" #A9BC15, "Breaks" #1DE9ED and "Brushing
 * and Cleaning" #7030A0 match the screen exactly.
 *
 * WHY COPY SOMEBODY ELSE'S PALETTE. The floor already reads these colours all
 * shift on the iTouching board. A second palette for the same twelve facts would
 * mean learning the same thing twice and translating between them at the moment
 * somebody is trying to work out why a line is down.
 *
 * WHAT THE COLOUR MEANS, AND WHAT IT DOES NOT. It identifies WHICH stop this is,
 * grouped by the nature of the stop — warm for faults and waiting, cool for
 * planned process, cleaning, setup and no shift. It says nothing about how the
 * line is doing against its target: that stays on the StatusRail, which is the
 * one carrier of state in this app. Two different questions, two different
 * carriers, and they are allowed to disagree — a line can be on a planned deep
 * clean and still be the worst-performing line of the shift.
 *
 * Keyed by NAME rather than by GUID because the name is what both systems hold
 * in common; the poll now keeps our labels in step with iTouching's, so a rename
 * carries the colour with it.
 */

/** Warm: something broke. */
const FAULT = "#E36C09";
/** Red is kept for two codes only, and iTouching means it. */
const ALARM = "#FF0000";
/** Quality, and waiting on somebody else. */
const WAITING = "#FFC000";
/** Cool: planned process work. */
const PROCESS = "#7030A0";
const CLEANING = "#00B0F0";
const CHANGEOVER = "#23A0CD";
const BREAK = "#1DE9ED";
const SHIFT_CHANGE = "#4F38FF";
const NO_REQUIREMENT = "#BFBFBF";
const NO_SHIFT = "#A9BC15";
const OVERRAN = "#A08946";
const CHECKS = "#E88787";

/** iTouching's separate legend palette, for the states that are not a stop code. */
export const ITOUCH_RUNNING = "#00C000";

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

const BY_NAME: Record<string, string> = {};
const assign = (colour: string, names: string[]) => {
  for (const n of names) BY_NAME[norm(n)] = colour;
};

assign(FAULT, [
  "Machine Shutdown", "Label Issue", "Filler Fault", "Maintenance Issue", "Capper Fault",
  "Printer Fault", "Box Sealer Fault", "Labeller Issue", "Drill Fault", "Electrical Issue",
  "Scale Issue", "Hopper Issue", "Seeve Issue", "Sensor Issue", "Conveyor Issues",
  "Powder Leak", "L4 Wheel Issue",
]);
assign(ALARM, ["Alarm", "Blender Fault"]);
assign(WAITING, [
  "Changeover Complete", "Quality Issue", "Awaiting Sample Approval", "Leaks",
  "Reblend More Mixing Required", "Reblend Silicon Dioxide Required",
  "Warehouse/Awaiting Packaging",
]);
assign(PROCESS, ["Filling Blender/Blending", "Filling Blender/ Blending", "Brushing and Cleaning", "Awaiting Line Approval"]);
assign(CLEANING, ["Deep Clean", "Drill Cleaning", "Line Preparation"]);
assign(CHANGEOVER, ["Changeover"]);
assign(BREAK, ["Breaks"]);
assign(SHIFT_CHANGE, ["Shift Change Over"]);
assign(NO_REQUIREMENT, ["No Requirement"]);
assign(NO_SHIFT, ["No Planned Shift"]);
assign(OVERRAN, ["Over ran on drill clean", "Over ran on drill / deep clean"]);
assign(CHECKS, ["Metal Detector Checks"]);

/**
 * "Metal Detected" exists TWICE in iTouching with two different colours — id 59
 * amber, id 81 orange — and the two are indistinguishable here: our stop-code map
 * is keyed by GUID and the catalogue by an integer id, with only the name joining
 * them. Amber is used, because a metal detection is a quality event before it is
 * an equipment one, and `metalDetectedIsAmbiguous` lets a screen say so rather
 * than present a coin toss as fact.
 */
assign(WAITING, ["Metal Detected"]);
export const AMBIGUOUS_STOP_NAMES = new Set([norm("Metal Detected")]);

export function stopColour(name: string | null | undefined): string | null {
  if (!name) return null;
  return BY_NAME[norm(name)] ?? null;
}

export function isAmbiguousStop(name: string | null | undefined): boolean {
  return !!name && AMBIGUOUS_STOP_NAMES.has(norm(name));
}

/** Every colour in the scheme, for a legend. */
export const STOP_COLOUR_GROUPS: Array<{ colour: string; label: string }> = [
  { colour: FAULT, label: "Equipment fault" },
  { colour: ALARM, label: "Alarm / blender fault" },
  { colour: WAITING, label: "Quality or waiting" },
  { colour: PROCESS, label: "Process work" },
  { colour: CLEANING, label: "Cleaning" },
  { colour: CHANGEOVER, label: "Changeover" },
  { colour: BREAK, label: "Break" },
  { colour: SHIFT_CHANGE, label: "Shift change" },
  { colour: NO_SHIFT, label: "No planned shift" },
  { colour: NO_REQUIREMENT, label: "No requirement" },
  { colour: OVERRAN, label: "Over-ran cleaning" },
  { colour: CHECKS, label: "Detector checks" },
];
