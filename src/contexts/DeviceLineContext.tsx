import { createContext, useContext, ReactNode } from "react";

export interface DeviceLineContextValue {
  lineId: string;
  lineName: string;
  deviceToken: string;
  label: string | null;
}

const DeviceLineContext = createContext<DeviceLineContextValue | null>(null);

export function DeviceLineProvider({
  value,
  children,
}: {
  value: DeviceLineContextValue;
  children: ReactNode;
}) {
  return <DeviceLineContext.Provider value={value}>{children}</DeviceLineContext.Provider>;
}

/**
 * Read the device-paired line for the current operator session.
 * Throws if used outside `OperatorLineGuard` to surface misuse early.
 */
export function useDeviceLineCtx(): DeviceLineContextValue {
  const ctx = useContext(DeviceLineContext);
  if (!ctx) throw new Error("useDeviceLineCtx must be used inside <OperatorLineGuard>");
  return ctx;
}
