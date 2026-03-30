import { useState, useEffect, useCallback } from "react";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { formatDistanceToNow } from "date-fns";

interface Notification {
  id: string;
  title: string;
  message: string;
  timestamp: Date;
  read: boolean;
  type: "new_wo" | "assigned" | "status_change" | "overdue";
}

export function NotificationPanel() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const { role, user } = useAuth();

  const addNotification = useCallback((n: Omit<Notification, "id" | "read" | "timestamp">) => {
    setNotifications((prev) => [
      { ...n, id: crypto.randomUUID(), read: false, timestamp: new Date() },
      ...prev.slice(0, 49),
    ]);
  }, []);

  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel("notifications_panel")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "work_orders" }, (payload) => {
        const wo = payload.new as any;
        if (role === "admin" || role === "engineer") {
          addNotification({
            type: "new_wo",
            title: "New Work Order",
            message: `WO #${wo.wo_number} — ${wo.machine}: ${wo.description}`,
          });
        }
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "work_orders" }, (payload) => {
        const wo = payload.new as any;
        const old = payload.old as any;
        if (old.status !== wo.status) {
          if (wo.engineer_id === user.id && old.status === "open" && wo.status === "received") {
            // skip self-assignment
          } else if (role === "admin" || wo.engineer_id === user.id || wo.operator_id === user.id) {
            addNotification({
              type: "status_change",
              title: "Status Changed",
              message: `WO #${wo.wo_number} → ${wo.status.replace("_", " ")}`,
            });
          }
        }
        if (!old.engineer_id && wo.engineer_id && wo.engineer_id === user.id) {
          addNotification({
            type: "assigned",
            title: "Assigned to You",
            message: `WO #${wo.wo_number} — ${wo.machine}`,
          });
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user, role, addNotification]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const markAllRead = () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  };

  const typeColors: Record<string, string> = {
    new_wo: "bg-blue-500",
    assigned: "bg-primary",
    status_change: "bg-amber-500",
    overdue: "bg-destructive",
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-destructive text-destructive-foreground text-[10px] flex items-center justify-center font-bold">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h4 className="font-semibold text-sm">Notifications</h4>
          {unreadCount > 0 && (
            <Button variant="ghost" size="sm" className="text-xs h-7" onClick={markAllRead}>
              Mark all read
            </Button>
          )}
        </div>
        <ScrollArea className="h-[300px]">
          {notifications.length === 0 ? (
            <p className="text-muted-foreground text-sm text-center py-8">No notifications yet</p>
          ) : (
            <div className="divide-y">
              {notifications.map((n) => (
                <div key={n.id} className={`px-4 py-3 text-sm ${n.read ? "opacity-60" : ""}`}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`w-2 h-2 rounded-full ${typeColors[n.type] || "bg-muted"}`} />
                    <span className="font-medium">{n.title}</span>
                  </div>
                  <p className="text-muted-foreground text-xs">{n.message}</p>
                  <p className="text-muted-foreground text-[10px] mt-1">
                    {formatDistanceToNow(n.timestamp, { addSuffix: true })}
                  </p>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
