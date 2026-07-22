import { useEffect, useRef, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { playMsnSound } from "@/lib/msnSound";
import { MsnNotification } from "@/components/MsnNotification";

interface Incoming {
  id: string;
  senderId: string;
  senderName: string;
  message: string;
}

const MESSAGES_PATH = "/dashboard/messages";

/**
 * App-wide listener for incoming direct messages. Shows an MSN-style pop-up
 * window with a chime for any DM addressed to the current user, in both
 * directions (operator↔supervisor). Suppressed while the user is already on
 * the messages page (they see the thread live there).
 */
export function GlobalDMNotifier() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [queue, setQueue] = useState<Incoming[]>([]);

  // Keep the latest pathname available inside the realtime callback.
  const pathRef = useRef(location.pathname);
  useEffect(() => {
    pathRef.current = location.pathname;
  }, [location.pathname]);

  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`global_dm_${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "direct_messages",
          filter: `recipient_id=eq.${user.id}`,
        },
        (payload) => {
          const row = payload.new as {
            id: string;
            sender_id: string;
            sender_name: string;
            message: string;
          };
          if (!row || row.sender_id === user.id) return;

          queryClient.invalidateQueries({ queryKey: ["dm_unread", user.id] });
          queryClient.invalidateQueries({ queryKey: ["dm_thread"] });

          // Don't pop while the user is already in the chat screen.
          if (pathRef.current.startsWith(MESSAGES_PATH)) return;

          playMsnSound();

          // Native notification when the tab is in the background.
          if (typeof document !== "undefined" && document.hidden && "Notification" in window) {
            if (Notification.permission === "granted") {
              try {
                new Notification(row.sender_name || "New message", {
                  body: row.message,
                  icon: "/appliedlogo.jpeg",
                });
              } catch {
                /* ignore */
              }
            }
          }

          setQueue((q) => {
            if (q.some((n) => n.id === row.id)) return q;
            const next: Incoming = {
              id: row.id,
              senderId: row.sender_id,
              senderName: row.sender_name || "Message",
              message: row.message || "",
            };
            // Keep at most 3 visible windows.
            return [...q, next].slice(-3);
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, queryClient]);

  // Ask for native-notification permission once (best-effort).
  useEffect(() => {
    if (!user || typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
  }, [user]);

  const remove = (id: string) => setQueue((q) => q.filter((n) => n.id !== id));

  if (!user || queue.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col-reverse gap-2 pointer-events-none">
      {queue.map((n) => (
        <MsnNotification
          key={n.id}
          senderName={n.senderName}
          message={n.message}
          onOpen={() => navigate(`${MESSAGES_PATH}?dm=${n.senderId}`)}
          onClose={() => remove(n.id)}
        />
      ))}
    </div>
  );
}
