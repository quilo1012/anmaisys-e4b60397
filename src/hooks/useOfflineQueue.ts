import { useState, useEffect } from "react";
import { toast } from "@/hooks/use-toast";

export function useOfflineDetection() {
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator !== "undefined" ? navigator.onLine : true
  );

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      toast({ title: "✅ Back online", description: "Connection restored." });
    };
    const handleOffline = () => {
      setIsOnline(false);
      toast({ title: "⚠️ You are offline", description: "Some features may be unavailable.", variant: "destructive" });
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  return { isOnline };
}
