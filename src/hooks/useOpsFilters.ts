import { useCallback, useEffect, useState } from "react";
import type { ShiftValue } from "@/components/ShiftFilter";

/**
 * One period and one shift, shared by every operations screen.
 *
 * The screens used to hold these separately: Downtime remembered its range under
 * `downtime-page` and offered the shift as a dropdown reading "Day (06–18)", while
 * Maintenance Orders remembered `work-orders` and offered the same choice as pills.
 * Walk from one to the other and the filters silently changed underneath you — the
 * heatmap showing nothing for a line while the order list showed a stoppage on it,
 * because one was on Day and the other on All. The numbers were never wrong; the
 * question each screen was answering had changed without saying so.
 *
 * Same key, same value, so the answer travels with you.
 */
const SHIFT_KEY = "ops:shift";

/** The range storage key every operations screen shares. */
export const OPS_RANGE_KEY = "ops";

function readShift(): ShiftValue {
  try {
    const raw = localStorage.getItem(SHIFT_KEY);
    if (raw === "DAY" || raw === "NIGHT" || raw === "ALL") return raw;
  } catch {
    // Private browsing and blocked storage both land here. A filter that cannot be
    // remembered is a smaller problem than a screen that will not open.
  }
  return "ALL";
}

export function useOpsShift(): [ShiftValue, (v: ShiftValue) => void] {
  const [shift, setShiftState] = useState<ShiftValue>(readShift);

  const setShift = useCallback((v: ShiftValue) => {
    setShiftState(v);
    try {
      localStorage.setItem(SHIFT_KEY, v);
      // Same tab, other screen: `storage` only fires for other tabs, so a screen
      // mounted beside this one would keep the stale value without this nudge.
      window.dispatchEvent(new CustomEvent("ops-shift-changed", { detail: v }));
    } catch {
      // Ignored for the same reason as above.
    }
  }, []);

  useEffect(() => {
    const onCustom = (e: Event) => setShiftState((e as CustomEvent).detail as ShiftValue);
    const onStorage = (e: StorageEvent) => {
      if (e.key === SHIFT_KEY) setShiftState(readShift());
    };
    window.addEventListener("ops-shift-changed", onCustom);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("ops-shift-changed", onCustom);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  return [shift, setShift];
}
