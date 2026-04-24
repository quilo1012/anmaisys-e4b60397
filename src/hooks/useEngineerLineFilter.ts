import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Per-engineer (per-user) localStorage-backed preference for which production
 * lines should trigger the critical siren. Empty selection means "all lines".
 *
 * Design notes:
 * - Stored under a user-scoped key so multiple engineers sharing a workstation
 *   keep their own filter.
 * - Returned helpers are stable references (useCallback) so they can be used
 *   inside hook dependency arrays without re-subscribing channels.
 * - `shouldAlertForLine(lineId)` is the single decision point used by alert
 *   hooks. WOs with a missing line_id (legacy/orphan) always alert so we never
 *   silently drop a request for help.
 */
const STORAGE_PREFIX = "engineer_alert_lines:";

function readStored(userId: string | undefined): string[] {
  if (!userId) return [];
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + userId);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function writeStored(userId: string | undefined, ids: string[]) {
  if (!userId) return;
  try {
    localStorage.setItem(STORAGE_PREFIX + userId, JSON.stringify(ids));
  } catch {
    // ignore quota / privacy-mode failures
  }
}

export function useEngineerLineFilter() {
  const { user } = useAuth();
  const [selectedLineIds, setSelectedLineIds] = useState<string[]>(() => readStored(user?.id));

  // Re-hydrate when the user changes (login/logout, account switch).
  useEffect(() => {
    setSelectedLineIds(readStored(user?.id));
  }, [user?.id]);

  // Cross-tab sync — if the same engineer has the dashboard open in two tabs
  // and toggles a line, both should agree.
  useEffect(() => {
    if (!user?.id) return;
    const key = STORAGE_PREFIX + user.id;
    const onStorage = (e: StorageEvent) => {
      if (e.key === key) setSelectedLineIds(readStored(user.id));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [user?.id]);

  const setSelection = useCallback(
    (ids: string[]) => {
      setSelectedLineIds(ids);
      writeStored(user?.id, ids);
    },
    [user?.id]
  );

  const toggleLine = useCallback(
    (id: string) => {
      setSelectedLineIds((prev) => {
        const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
        writeStored(user?.id, next);
        return next;
      });
    },
    [user?.id]
  );

  const clearSelection = useCallback(() => {
    setSelection([]);
  }, [setSelection]);

  /**
   * Returns true when the alert subsystem should fire for a WO on this line.
   * Empty selection = monitor everything (default). Unknown/missing line_id
   * always alerts to avoid silent drops on legacy data.
   */
  const shouldAlertForLine = useCallback(
    (lineId: string | null | undefined) => {
      if (selectedLineIds.length === 0) return true;
      if (!lineId) return true;
      return selectedLineIds.includes(lineId);
    },
    [selectedLineIds]
  );

  return {
    selectedLineIds,
    setSelection,
    toggleLine,
    clearSelection,
    shouldAlertForLine,
    isFilteringActive: selectedLineIds.length > 0,
  };
}
