import { useState, useEffect, useCallback, useRef } from "react";
import { Bell, AlertTriangle, Wrench, Package, Activity, UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";

type NotifType = "new_wo" | "assigned" | "status_change" | "overdue" | "low_stock";
type Priority = "critical" | "high" | "medium" | "low";

interface Notification {
  id: string;
  title: string;
  message: string;
  timestamp: Date;
  read: boolean;
  type: NotifType;
  priority: Priority;
  woId?: string;
}

const PRIORITY_FROM_WO: Record<string, Priority> = {
  critical: "critical",
  high: "high",
  medium: "medium",
  low: "low",
};

// Industrial audio cues — Web Audio API (no asset needed)
function playAlertSound(priority: Priority) {
  try {
    const AudioCtx = (window.AudioContext || (window as any).webkitAudioContext);
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    const config = {
      critical: { freq: [880, 660, 880, 660], dur: 0.18, gain: 0.25 },
      high:     { freq: [784, 523], dur: 0.16, gain: 0.2 },
      medium:   { freq: [659], dur: 0.18, gain: 0.15 },
      low:      { freq: [523], dur: 0.12, gain: 0.1 },
    }[priority];

    config.freq.forEach((f, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "square";
      osc.frequency.value = f;
      gain.gain.setValueAtTime(0, now + i * config.dur);
      gain.gain.linearRampToValueAtTime(config.gain, now + i * config.dur + 0.01);
      gain.gain.linearRampToValueAtTime(0, now + (i + 1) * config.dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + i * config.dur);
      osc.stop(now + (i + 1) * config.dur);
    });

    // Haptic feedback on supported devices
    if ("vibrate" in navigator) {
      const patterns: Record<Priority, number[]> = {
        critical: [200, 100, 200, 100, 200],
        high: [150, 80, 150],
        medium: [120],
        low: [60],
      };
      navigator.vibrate(patterns[priority]);
    }
  } catch {
    // ignore audio failures (autoplay restrictions)
  }
}

const typeIcon: Record<NotifType, React.ComponentType<{ className?: string }>> = {
  new_wo: Wrench,
  assigned: UserCheck,
  status_change: Activity,
  overdue: AlertTriangle,
  low_stock: Package,
};

const priorityStyles: Record<Priority, { ring: string; dot: string; label: string; badge: string }> = {
  critical: { ring: "border-l-destructive", dot: "bg-destructive", label: "CRITICAL", badge: "bg-destructive text-destructive-foreground" },
  high:     { ring: "border-l-orange-500", dot: "bg-orange-500", label: "HIGH", badge: "bg-orange-500 text-white" },
  medium:   { ring: "border-l-amber-500", dot: "bg-amber-500", label: "MEDIUM", badge: "bg-amber-500 text-white" },
  low:      { ring: "border-l-muted", dot: "bg-muted-foreground", label: "LOW", badge: "bg-muted text-muted-foreground" },
};

export function NotificationPanel() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const { role, user } = useAuth();
  const navigate = useNavigate();
  const mountedAt = useRef<number>(Date.now());

  const addNotification = useCallback((n: Omit<Notification, "id" | "read" | "timestamp">) => {
    const notif: Notification = {
      ...n,
      id: crypto.randomUUID(),
      read: false,
      timestamp: new Date(),
    };
    setNotifications((prev) => [notif, ...prev.slice(0, 49)]);

    // Audio + haptic alert
    playAlertSound(n.priority);

    // Professional toast with priority styling and click-to-navigate
    const Icon = typeIcon[n.type];
    const toastFn =
      n.priority === "critical" || n.priority === "high" ? toast.error
      : n.priority === "medium" ? toast.warning
      : toast.info;

    toastFn(n.title, {
      description: n.message,
      duration: n.priority === "critical" ? 15000 : n.priority === "high" ? 10000 : 6000,
      icon: <Icon className="h-5 w-5" />,
      action: n.woId ? {
        label: "Open",
        onClick: () => navigate(`/dashboard/wo/${n.woId}`),
      } : undefined,
    });

    // Browser notification (when tab is hidden)
    if (document.visibilityState === "hidden" && "Notification" in window && Notification.permission === "granted") {
      try {
        new Notification(`[${priorityStyles[n.priority].label}] ${n.title}`, {
          body: n.message,
          tag: notif.id,
          requireInteraction: n.priority === "critical",
        });
      } catch { /* ignore */ }
    }
  }, [navigate]);

  // Request browser notification permission for engineers/managers/admins
  useEffect(() => {
    if (!role || role === "operator") return;
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission().catch(() => { /* ignore */ });
    }
  }, [role]);

  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel(`notifications_panel_${user.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "work_orders" }, (payload) => {
        const wo = payload.new as any;
        // Ignore our own backfill on first second
        if (Date.now() - mountedAt.current < 1500) return;
        // Engineers/admins receive the critical full-screen modal via useWOAlerts —
        // skip duplicate panel entries for them. Only managers see new-WO panel toasts.
        if (role === "manager") {
          const priority = PRIORITY_FROM_WO[wo.priority] || "medium";
          addNotification({
            type: "new_wo",
            title: priority === "critical" ? "🚨 Critical Work Order" : "New Work Order",
            message: `WO #${wo.wo_number} • ${wo.machine} — ${wo.description}`,
            priority,
            woId: wo.id,
          });
        }
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "work_orders" }, (payload) => {
        const wo = payload.new as any;
        const old = payload.old as any;
        const priority = PRIORITY_FROM_WO[wo.priority] || "medium";

        // Engineer assigned to this WO
        if (!old.engineer_id && wo.engineer_id && wo.engineer_id === user.id) {
          addNotification({
            type: "assigned",
            title: "Assigned to You",
            message: `WO #${wo.wo_number} • ${wo.machine}`,
            priority: priority === "low" ? "medium" : priority,
            woId: wo.id,
          });
          return;
        }

        // Line stopped → high priority alert to engineers
        if (!old.line_stopped && wo.line_stopped && (role === "engineer" || role === "admin" || role === "manager")) {
          addNotification({
            type: "overdue",
            title: "⛔ Line Stopped",
            message: `WO #${wo.wo_number} • ${wo.machine} — production halted`,
            priority: "critical",
            woId: wo.id,
          });
          return;
        }

        if (old.status !== wo.status) {
          if (wo.engineer_id === user.id && old.status === "open" && wo.status === "received") return;
          if (role === "admin" || role === "manager" || wo.engineer_id === user.id || wo.operator_id === user.id) {
            addNotification({
              type: "status_change",
              title: "Status Changed",
              message: `WO #${wo.wo_number} → ${String(wo.status).replace("_", " ")}`,
              priority: "low",
              woId: wo.id,
            });
          }
        }
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "products" }, (payload) => {
        const product = payload.new as any;
        if ((role === "admin" || role === "manager") && product.quantity <= product.min_stock) {
          addNotification({
            type: "low_stock",
            title: "Low Stock Alert",
            message: `${product.name} (${product.code}) at ${product.quantity} units (min: ${product.min_stock})`,
            priority: product.quantity === 0 ? "high" : "medium",
          });
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user, role, addNotification]);

  const unreadCount = notifications.filter((n) => !n.read).length;
  const criticalCount = notifications.filter((n) => !n.read && (n.priority === "critical" || n.priority === "high")).length;

  const markAllRead = () => setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  const handleClick = (n: Notification) => {
    setNotifications((prev) => prev.map((x) => x.id === n.id ? { ...x, read: true } : x));
    if (n.woId) { setOpen(false); navigate(`/dashboard/wo/${n.woId}`); }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={`${unreadCount} unread notifications`}>
          <Bell className={cn("h-5 w-5", criticalCount > 0 && "animate-pulse text-destructive")} />
          {unreadCount > 0 && (
            <span className={cn(
              "absolute -top-1 -right-1 h-5 min-w-5 px-1 rounded-full text-[10px] flex items-center justify-center font-bold",
              criticalCount > 0 ? "bg-destructive text-destructive-foreground animate-pulse" : "bg-primary text-primary-foreground"
            )}>
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96 p-0" align="end">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div>
            <h4 className="font-semibold text-sm">Notifications</h4>
            {criticalCount > 0 && (
              <p className="text-[11px] text-destructive font-medium">{criticalCount} urgent</p>
            )}
          </div>
          {unreadCount > 0 && (
            <Button variant="ghost" size="sm" className="text-xs h-7" onClick={markAllRead}>
              Mark all read
            </Button>
          )}
        </div>
        <ScrollArea className="h-[360px]">
          {notifications.length === 0 ? (
            <p className="text-muted-foreground text-sm text-center py-8">No notifications yet</p>
          ) : (
            <div className="divide-y">
              {notifications.map((n) => {
                const Icon = typeIcon[n.type];
                const styles = priorityStyles[n.priority];
                return (
                  <button
                    key={n.id}
                    onClick={() => handleClick(n)}
                    className={cn(
                      "w-full text-left px-4 py-3 text-sm border-l-4 transition hover:bg-accent/50",
                      styles.ring,
                      n.read && "opacity-60"
                    )}
                  >
                    <div className="flex items-start gap-2 mb-1">
                      <Icon className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium truncate">{n.title}</span>
                          <span className={cn("text-[9px] px-1.5 py-0.5 rounded font-bold tracking-wider shrink-0", styles.badge)}>
                            {styles.label}
                          </span>
                        </div>
                        <p className="text-muted-foreground text-xs mt-1 break-words">{n.message}</p>
                        <p className="text-muted-foreground text-[10px] mt-1">
                          {formatDistanceToNow(n.timestamp, { addSuffix: true })}
                        </p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
