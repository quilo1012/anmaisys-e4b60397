import * as React from "react";
import type { DeviceType } from "@/lib/permissions";

// Phone < 768 ≤ Tablet ≤ 1023 < Desktop
const MOBILE_MAX = 767;
const TABLET_MAX = 1023;

function compute(): DeviceType {
  if (typeof window === "undefined") return "desktop";
  const w = window.innerWidth;
  if (w <= MOBILE_MAX) return "mobile";
  if (w <= TABLET_MAX) return "tablet";
  return "desktop";
}

/** Current device class based on viewport width: 'desktop' | 'tablet' | 'mobile'. */
export function useDeviceType(): DeviceType {
  const [device, setDevice] = React.useState<DeviceType>(compute);
  React.useEffect(() => {
    const onResize = () => setDevice(compute());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return device;
}
