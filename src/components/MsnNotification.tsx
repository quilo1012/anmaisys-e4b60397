import { useEffect, useState } from "react";
import { X, MessageSquare } from "lucide-react";
import logo from "@/assets/appliedlogo.jpeg";
import { cn } from "@/lib/utils";

export interface MsnNotificationProps {
  senderName: string;
  message: string;
  /** Called when the user clicks the body to open the conversation. */
  onOpen: () => void;
  /** Called when the notification is dismissed (button or auto-timeout). */
  onClose: () => void;
  /** Auto-dismiss after this many ms (default 8000). Pass 0 to disable. */
  autoCloseMs?: number;
}

/**
 * MSN-Messenger-style pop-up window: title bar with company logo, sender name,
 * and a short message preview. Slides in from the bottom-right.
 */
export function MsnNotification({
  senderName,
  message,
  onOpen,
  onClose,
  autoCloseMs = 8000,
}: MsnNotificationProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  const dismiss = () => {
    setVisible(false);
    // allow the slide-out transition to play before unmount
    setTimeout(onClose, 220);
  };

  useEffect(() => {
    if (!autoCloseMs) return;
    const t = setTimeout(dismiss, autoCloseMs);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoCloseMs]);

  return (
    <div
      role="alert"
      className={cn(
        "pointer-events-auto w-[320px] overflow-hidden rounded-lg border border-border bg-card shadow-2xl ring-1 ring-black/5",
        "transition-all duration-200 ease-out",
        visible ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0",
      )}
    >
      {/* Title bar */}
      <div className="flex items-center gap-2 bg-gradient-to-r from-primary to-primary/80 px-3 py-1.5 text-primary-foreground">
        <MessageSquare className="h-3.5 w-3.5 shrink-0" />
        <span className="flex-1 truncate text-xs font-semibold tracking-wide">
          New message
        </span>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="rounded p-0.5 transition-colors hover:bg-white/20"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Body */}
      <button
        type="button"
        onClick={() => {
          onOpen();
          dismiss();
        }}
        className="flex w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-accent"
      >
        <img
          src={logo}
          alt=""
          className="h-10 w-10 shrink-0 rounded-md object-contain ring-1 ring-border"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">
            {senderName}
          </p>
          <p className="line-clamp-2 text-xs text-muted-foreground">{message}</p>
        </div>
      </button>
    </div>
  );
}
