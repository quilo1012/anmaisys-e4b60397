export const FILL_SPEED_OVERRIDES_KEY = "fill-speed-matrix-fill-times-v1";

export type FillTimeOverrides = Record<string, number>;

/** Parse a positive fill time without letting an incomplete input produce NaN. */
export function parseFillTime(value: string): number | null {
  if (!value.trim()) return null;
  const seconds = Number(value.replace(",", "."));
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

/** One fill cycle can produce several units on capsule machines. */
export function perHourFromSeconds(seconds: number, fillsPerCycle = 1): number {
  return (3600 * fillsPerCycle) / seconds;
}

export function lineFillTimeKey(line: number, packKg: number): string {
  return `line:${line}:${packKg}`;
}

export function machineFillTimeKey(machine: string, pack: string): string {
  return `machine:${machine}:${pack}`;
}

/** Preserve the reviewed sheet figures until the user actually changes a fill time. */
export function fillSpeedMetrics(
  seconds: number,
  originalSeconds: number,
  originalPerHour: number,
  fillsPerCycle = 1,
) {
  const edited = Math.abs(seconds - originalSeconds) > 0.000001;
  const perHour = edited ? perHourFromSeconds(seconds, fillsPerCycle) : originalPerHour;
  return { edited, perHour, perMinute: perHour / 60 };
}

export function readFillTimeOverrides(): FillTimeOverrides {
  if (typeof window === "undefined") return {};
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(FILL_SPEED_OVERRIDES_KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, number] =>
        typeof entry[1] === "number" && Number.isFinite(entry[1]) && entry[1] > 0,
      ),
    );
  } catch {
    return {};
  }
}

export function writeFillTimeOverrides(overrides: FillTimeOverrides): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(FILL_SPEED_OVERRIDES_KEY, JSON.stringify(overrides));
}
