import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Bell, Volume2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { acknowledgeWOLocal } from "@/lib/woAck";

export interface CriticalAlertPayload {
  woId: string;
  woNumber: number | string;
  machine: string;
  requester: string;
  description: string;
  priority?: string;
}

interface CriticalAlertContextType {
  triggerAlert: (payload: CriticalAlertPayload) => void;
  /** Acknowledge the active alert. If `woId` is provided, only acknowledges
   *  when it matches the currently-active alert (prevents race conditions
   *  where another engineer's status change closes this engineer's modal). */
  acknowledge: (woId?: string) => void;
  audioEnabled: boolean;
  promptEnableAudio: () => void;
}

const CriticalAlertContext = createContext<CriticalAlertContextType>({
  triggerAlert: () => {},
  acknowledge: () => {},
  audioEnabled: false,
  promptEnableAudio: () => {},
});

export const useCriticalAlert = () => useContext(CriticalAlertContext);

const AUDIO_FLAG_KEY = "alertAudioEnabled";
const MAX_LOOP_MS = 30_000;
const VIBRATE_PATTERN = [500, 200, 500, 200, 500, 200, 500];

// ─── Favicon badge ────────────────────────────────────────────────────────────
let originalFaviconHref: string | null = null;
function getFaviconLink(): HTMLLinkElement | null {
  return document.querySelector<HTMLLinkElement>("link[rel~='icon']");
}
function setFaviconBadge(count: number) {
  const link = getFaviconLink();
  if (!link) return;
  if (originalFaviconHref === null) originalFaviconHref = link.href;
  if (count <= 0) {
    link.href = originalFaviconHref;
    return;
  }
  try {
    const size = 64;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      ctx.drawImage(img, 0, 0, size, size);
      // Red badge
      ctx.fillStyle = "#dc2626";
      ctx.beginPath();
      ctx.arc(size - 18, 18, 18, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.font = "bold 24px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(count > 9 ? "9+" : String(count), size - 18, 19);
      link.href = canvas.toDataURL("image/png");
    };
    img.onerror = () => {
      // Fallback: draw badge alone
      ctx.fillStyle = "#dc2626";
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.font = "bold 36px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(count > 9 ? "9+" : String(count), size / 2, size / 2 + 2);
      link.href = canvas.toDataURL("image/png");
    };
    img.src = originalFaviconHref;
  } catch {
    /* ignore */
  }
}

// ─── Audio engine (HTMLAudio + WebAudio oscillator fallback) ─────────────────
class AlertAudioEngine {
  private ctx: AudioContext | null = null;
  private htmlAudio: HTMLAudioElement | null = null;
  private oscTimer: number | null = null;
  private vibTimer: number | null = null;
  private maxTimer: number | null = null;
  private playing = false;

  unlock() {
    try {
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      if (!this.ctx && Ctx) this.ctx = new Ctx();
      if (this.ctx?.state === "suspended") void this.ctx.resume();
      // Pre-create silent audio element to satisfy iOS
      if (!this.htmlAudio) {
        this.htmlAudio = new Audio();
        this.htmlAudio.loop = true;
        this.htmlAudio.volume = 1.0;
        this.htmlAudio.preload = "auto";
        this.htmlAudio.src = "/alert.mp3";
      }
      // Touch-play to grant permission (await play before pause to avoid AbortError)
      const a = this.htmlAudio;
      a.muted = true;
      try {
        const p = a.play();
        if (p && typeof p.then === "function") {
          p.then(() => {
            try { a.pause(); a.currentTime = 0; a.muted = false; } catch { /* ignore */ }
          }).catch(() => { /* ignore AbortError / autoplay block */ });
        }
      } catch { /* ignore */ }
    } catch { /* ignore */ }
  }

  private startOscillator() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const beep = () => {
      if (!this.playing) return;
      try {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "square";
        osc.frequency.value = 800;
        gain.gain.value = 0.3;
        osc.connect(gain).connect(ctx.destination);
        const now = ctx.currentTime;
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(0.3, now + 0.01);
        gain.gain.linearRampToValueAtTime(0, now + 0.2);
        osc.start(now);
        osc.stop(now + 0.2);
      } catch { /* ignore */ }
    };
    beep();
    this.oscTimer = window.setInterval(beep, 400);
  }

  private playPromise: Promise<void> | null = null;

  start() {
    if (this.playing) return;
    this.playing = true;
    // HTMLAudio (loops alert.mp3 if asset available)
    if (this.htmlAudio) {
      try {
        this.htmlAudio.currentTime = 0;
        this.htmlAudio.volume = 1.0;
        const p = this.htmlAudio.play();
        if (p && typeof p.then === "function") {
          this.playPromise = p.catch(() => { /* AbortError / autoplay block — fall back to oscillator */ });
        }
      } catch { /* ignore */ }
    }
    // WebAudio oscillator fallback in parallel (guarantees sound even without asset)
    if (this.ctx?.state === "suspended") void this.ctx.resume();
    this.startOscillator();
    // Vibration loop
    if ("vibrate" in navigator) {
      try { navigator.vibrate(VIBRATE_PATTERN); } catch { /* ignore */ }
      this.vibTimer = window.setInterval(() => {
        try { navigator.vibrate(VIBRATE_PATTERN); } catch { /* ignore */ }
      }, 3000);
    }
    // Auto-stop cap
    this.maxTimer = window.setTimeout(() => this.stop(), MAX_LOOP_MS);
  }

  stop() {
    this.playing = false;
    // Wait for any pending play() to resolve before pause() to avoid AbortError
    const doPause = () => {
      if (!this.htmlAudio) return;
      try { this.htmlAudio.pause(); this.htmlAudio.currentTime = 0; } catch { /* ignore */ }
    };
    if (this.playPromise) {
      this.playPromise.then(doPause).catch(() => doPause());
      this.playPromise = null;
    } else {
      doPause();
    }
    if (this.oscTimer) { clearInterval(this.oscTimer); this.oscTimer = null; }
    if (this.vibTimer) { clearInterval(this.vibTimer); this.vibTimer = null; }
    if (this.maxTimer) { clearTimeout(this.maxTimer); this.maxTimer = null; }
    if ("vibrate" in navigator) { try { navigator.vibrate(0); } catch { /* ignore */ } }
  }
}

// ─── Provider ────────────────────────────────────────────────────────────────
export function CriticalAlertProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [audioEnabled, setAudioEnabled] = useState<boolean>(() => {
    try { return localStorage.getItem(AUDIO_FLAG_KEY) === "true"; } catch { return false; }
  });
  const [showUnlock, setShowUnlock] = useState(false);
  const [active, setActive] = useState<CriticalAlertPayload | null>(null);
  const [queue, setQueue] = useState<CriticalAlertPayload[]>([]);
  const engineRef = useRef<AlertAudioEngine | null>(null);
  const titleTimerRef = useRef<number | null>(null);
  const originalTitleRef = useRef<string>(typeof document !== "undefined" ? document.title : "");

  if (!engineRef.current && typeof window !== "undefined") {
    engineRef.current = new AlertAudioEngine();
  }

  // Flash tab title while alert active
  useEffect(() => {
    const restoreTitle = () => {
      // Strip any leftover 🚨 prefix to guarantee clean restore.
      const clean = originalTitleRef.current.replace(/^🚨\s*NEW WO\s*—\s*.*$/, "").trim();
      document.title = clean || "AN Maintenance";
    };
    if (!active) {
      if (titleTimerRef.current) {
        clearInterval(titleTimerRef.current);
        titleTimerRef.current = null;
      }
      restoreTitle();
      return;
    }
    // Re-capture in case the route changed the title since mount
    if (!document.title.startsWith("🚨")) {
      originalTitleRef.current = document.title;
    }
    let toggle = false;
    titleTimerRef.current = window.setInterval(() => {
      toggle = !toggle;
      document.title = toggle ? `🚨 NEW WO — ${active.machine}` : originalTitleRef.current;
    }, 1000);
    return () => {
      if (titleTimerRef.current) {
        clearInterval(titleTimerRef.current);
        titleTimerRef.current = null;
      }
      restoreTitle();
    };
  }, [active]);

  // Favicon badge follows pending count (active + queued)
  useEffect(() => {
    const count = (active ? 1 : 0) + queue.length;
    setFaviconBadge(count);
  }, [active, queue.length]);

  // Stop title flash when user returns to tab
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible") {
        document.title = originalTitleRef.current;
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  const triggerAlert = useCallback((payload: CriticalAlertPayload) => {
    setActive((current) => {
      // Idempotency guard: same WO already active → do nothing (prevents double sound/modal).
      if (current && current.woId === payload.woId) {
        return current;
      }
      if (current) {
        // Another alert is active — queue this one (dedup by woId).
        setQueue((q) => (q.find((x) => x.woId === payload.woId) ? q : [...q, payload]));
        return current;
      }
      // Start engines for this alert
      engineRef.current?.start();
      return payload;
    });
  }, []);

  const acknowledge = useCallback((woId?: string) => {
    console.log("[acknowledge]", woId);
    // Persist client-side immediately so re-mounts/reconnects/refresh don't replay.
    if (woId) {
      acknowledgeWOLocal(woId);
      // Persist server-side as well (best effort).
      void supabase.rpc("acknowledge_wo_alert", { _wo_id: woId });
    }

    let shouldAdvance = false;

    // Close the active alert only if it matches (or no woId given).
    setActive((current) => {
      if (!current) return null;
      if (woId && current.woId !== woId) return current;
      shouldAdvance = true;
      engineRef.current?.stop();
      return null;
    });

    // Always remove this woId from the queue (no-op if not queued).
    setQueue((q) => (woId ? q.filter((x) => x.woId !== woId) : q));

    // Only promote next-in-queue when we actually closed the active alert.
    if (shouldAdvance) {
      setQueue((q) => {
        if (q.length === 0) return q;
        const [next, ...rest] = q;
        window.setTimeout(() => {
          engineRef.current?.start();
          setActive(next);
        }, 300);
        return rest;
      });
    }
  }, []);

  const enableAudio = useCallback(() => {
    engineRef.current?.unlock();
    try { localStorage.setItem(AUDIO_FLAG_KEY, "true"); } catch { /* ignore */ }
    setAudioEnabled(true);
    setShowUnlock(false);
  }, []);

  const promptEnableAudio = useCallback(() => {
    if (!audioEnabled) setShowUnlock(true);
  }, [audioEnabled]);

  const handleAccept = () => {
    if (!active) return;
    const id = active.woId;
    // Persist the acknowledgment before navigation so this same open WO
    // does not replay the modal on remount/reconnect/reload.
    acknowledge(id);
    navigate(`/dashboard/wo/${id}`);
  };

  const value = useMemo(
    () => ({ triggerAlert, acknowledge, audioEnabled, promptEnableAudio }),
    [triggerAlert, acknowledge, audioEnabled, promptEnableAudio]
  );

  return (
    <CriticalAlertContext.Provider value={value}>
      {children}

      {/* Unlock-audio modal (first login gesture) */}
      <Dialog open={showUnlock} onOpenChange={(o) => !o && setShowUnlock(false)}>
        <DialogContent className="max-w-md">
          <DialogTitle className="flex items-center gap-2">
            <Volume2 className="h-5 w-5 text-primary" /> Enable Alert Sounds
          </DialogTitle>
          <DialogDescription>
            To receive critical Work Order alerts (audio + vibration) even when this tab is in
            the background, your device requires a one-time gesture to unlock audio playback.
          </DialogDescription>
          <Button size="lg" className="h-14 text-base" onClick={enableAudio}>
            Enable Alerts
          </Button>
        </DialogContent>
      </Dialog>

      {/* Critical full-screen alert */}
      <Dialog open={!!active} onOpenChange={() => { /* cannot dismiss without acknowledge */ }}>
        <DialogContent
          className={cn(
            "max-w-lg border-4 border-destructive bg-destructive text-destructive-foreground",
            "shadow-[0_0_60px_hsl(var(--destructive)/0.6)]",
            "[&>button]:hidden", // hide close X
            "animate-pulse"
          )}
          onEscapeKeyDown={(e) => e.preventDefault()}
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
        >
          <div className="flex flex-col items-center text-center gap-4 py-2">
            <div className="rounded-full bg-destructive-foreground/10 p-4">
              <AlertTriangle className="h-12 w-12" />
            </div>
            <DialogTitle className="text-3xl font-extrabold tracking-wide">
              🚨 NEW WORK ORDER
            </DialogTitle>
            {active && (
              <DialogDescription className="text-destructive-foreground/90 text-base space-y-1">
                <div className="text-2xl font-bold">
                  WO-{String(active.woNumber).padStart(6, "0")}
                </div>
                <div className="font-semibold">{active.machine}</div>
                {active.priority && (
                  <div className="uppercase text-xs tracking-widest opacity-80">
                    Priority: {active.priority}
                  </div>
                )}
                <div className="text-sm pt-2 opacity-90">Requester: {active.requester}</div>
                <div className="text-sm opacity-90 line-clamp-3">{active.description}</div>
                {queue.length > 0 && (
                  <div className="text-xs pt-2 opacity-75">
                    + {queue.length} more pending
                  </div>
                )}
              </DialogDescription>
            )}
            <div className="grid grid-cols-2 gap-3 w-full pt-2">
              <Button
                size="lg"
                variant="secondary"
                className="h-14 font-bold"
                onClick={() => active && acknowledge(active.woId)}
              >
                <Bell className="h-5 w-5 mr-2" /> Acknowledge
              </Button>
              <Button
                size="lg"
                variant="default"
                className="h-14 font-bold bg-foreground text-background hover:bg-foreground/90"
                onClick={handleAccept}
              >
                Open Order
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </CriticalAlertContext.Provider>
  );
}
