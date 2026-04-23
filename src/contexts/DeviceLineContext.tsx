import { createContext, useContext, useEffect, useMemo, useState, ReactNode } from "react";

const SELECTED_LINE_KEY = "an_selected_line_id";

export interface AllowedLine {
  id: string;
  name: string;
}

export interface DeviceLineContextValue {
  allowedLineIds: string[];
  allowedLines: AllowedLine[];
  selectedLineId: string;
  selectedLineName: string;
  setSelectedLineId: (id: string) => void;
  deviceToken: string;
  label: string | null;
}

const DeviceLineContext = createContext<DeviceLineContextValue | null>(null);

export function DeviceLineProvider({
  allowedLines,
  deviceToken,
  label,
  children,
}: {
  allowedLines: AllowedLine[];
  deviceToken: string;
  label: string | null;
  children: ReactNode;
}) {
  const allowedLineIds = useMemo(() => allowedLines.map((l) => l.id), [allowedLines]);

  const initialSelected = useMemo(() => {
    if (allowedLineIds.length === 0) return "";
    if (allowedLineIds.length === 1) return allowedLineIds[0];
    const stored = localStorage.getItem(SELECTED_LINE_KEY);
    if (stored && allowedLineIds.includes(stored)) return stored;
    return allowedLineIds[0];
  }, [allowedLineIds]);

  const [selectedLineId, setSelectedLineIdState] = useState<string>(initialSelected);

  // Re-sync if the allowed set changes (e.g. admin re-pairs the tablet).
  useEffect(() => {
    if (allowedLineIds.length === 0) {
      setSelectedLineIdState("");
      return;
    }
    if (!allowedLineIds.includes(selectedLineId)) {
      const stored = localStorage.getItem(SELECTED_LINE_KEY);
      const next =
        stored && allowedLineIds.includes(stored) ? stored : allowedLineIds[0];
      setSelectedLineIdState(next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowedLineIds.join(",")]);

  const setSelectedLineId = (id: string) => {
    if (!allowedLineIds.includes(id)) return;
    localStorage.setItem(SELECTED_LINE_KEY, id);
    setSelectedLineIdState(id);
  };

  const selectedLineName =
    allowedLines.find((l) => l.id === selectedLineId)?.name ?? "";

  const value: DeviceLineContextValue = {
    allowedLineIds,
    allowedLines,
    selectedLineId,
    selectedLineName,
    setSelectedLineId,
    deviceToken,
    label,
  };

  return <DeviceLineContext.Provider value={value}>{children}</DeviceLineContext.Provider>;
}

/**
 * Read the device-paired lines for the current operator session.
 * Throws if used outside `OperatorLineGuard` to surface misuse early.
 */
export function useDeviceLineCtx(): DeviceLineContextValue {
  const ctx = useContext(DeviceLineContext);
  if (!ctx) throw new Error("useDeviceLineCtx must be used inside <OperatorLineGuard>");
  return ctx;
}
