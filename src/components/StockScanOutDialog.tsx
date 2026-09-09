import { useEffect, useMemo, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { format } from "date-fns";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, Undo2, ScanLine } from "lucide-react";
import type { Product } from "@/hooks/useStock";
import { codeFromQr } from "@/lib/stockQrLabels";

/**
 * Taking parts out of stock by pointing the phone at their shelf labels.
 *
 * The camera stays open; every QR read takes one unit off, at once, with no dialog.
 * The write itself is not here — `onAdjust` is the page's own one-unit adjustment, so
 * a scanned withdrawal leaves exactly the record a tapped one does.
 */

/** The camera reads the same label many times a second; and a hand moving from one
 *  shelf to the next takes a moment. Nothing is debited within this window of the
 *  previous read, whichever label it is. */
const COOLDOWN_MS = 3000;

interface ScanEntry {
  id: string;
  product: Product;
  at: Date;
  newQty: number;
  undone?: boolean;
}

type Flash =
  | { kind: "ok"; text: string }
  | { kind: "bad"; text: string }
  | null;

function beep(ok: boolean) {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = ok ? 1200 : 300;
    gain.gain.value = 0.15;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + (ok ? 0.08 : 0.25));
    osc.onended = () => ctx.close();
  } catch { /* no audio, no problem */ }
  try { navigator.vibrate?.(ok ? 60 : [80, 60, 80]); } catch { /* ignore */ }
}

export function StockScanOutDialog({
  open, onOpenChange, products, onAdjust,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  products: Product[];
  /** Applies ±1 and returns the resulting quantity. Throws on failure. */
  onAdjust: (p: Product, delta: 1 | -1) => Promise<number>;
}) {
  const [entries, setEntries] = useState<ScanEntry[]>([]);
  const [flash, setFlash] = useState<Flash>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cooldownLeft, setCooldownLeft] = useState(0);

  const scannerRef = useRef<Html5Qrcode | null>(null);
  // The <video> html5-qrcode appends to the reader container. Held because the
  // library's own handlers on it have to be detached before the camera is closed,
  // and by then React has already taken the container out of the document.
  const surfaceRef = useRef<HTMLVideoElement | null>(null);
  const lastReadAt = useRef(0);
  const lastCode = useRef("");
  const busyRef = useRef(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout>>();
  // The quantity this session last wrote for a part — the list from the server may
  // lag a moment behind our own writes, and two scans a few seconds apart must not
  // both start from the same stale figure.
  const knownQty = useRef<Record<string, number>>({});
  const productsRef = useRef(products);
  productsRef.current = products;

  const byCode = useMemo(() => {
    const m = new Map<string, Product>();
    for (const p of products) m.set(codeFromQr(p.code), p);
    return m;
  }, [products]);
  const byCodeRef = useRef(byCode);
  byCodeRef.current = byCode;

  const showFlash = (f: Flash) => {
    setFlash(f);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 2500);
  };

  const handleRead = async (text: string) => {
    const now = Date.now();
    const code = codeFromQr(text);
    if (busyRef.current) return;
    // Same code again inside the window: the camera re-reading the label it is still
    // pointed at. Any code inside the window: too soon after the previous debit.
    if (now - lastReadAt.current < COOLDOWN_MS) return;
    lastReadAt.current = now;
    lastCode.current = code;

    const p = byCodeRef.current.get(code);
    if (!p) {
      beep(false);
      showFlash({ kind: "bad", text: `Part not found: ${text.trim().slice(0, 40)}` });
      return;
    }
    const current = knownQty.current[p.id] ?? p.quantity;
    if (current <= 0) {
      beep(false);
      showFlash({ kind: "bad", text: `${p.code} · out of stock (0) — not debited` });
      return;
    }
    busyRef.current = true; setBusy(true);
    try {
      const newQty = await onAdjust({ ...p, quantity: current }, -1);
      knownQty.current[p.id] = newQty;
      beep(true);
      showFlash({ kind: "ok", text: `${p.code}  −1  →  ${newQty} left` });
      setEntries((prev) => [{ id: `${now}-${p.id}`, product: p, at: new Date(now), newQty }, ...prev]);
    } catch (err: unknown) {
      beep(false);
      showFlash({ kind: "bad", text: (err as Error)?.message || "Could not update stock" });
    } finally {
      busyRef.current = false; setBusy(false);
    }
  };

  const undoLast = async () => {
    const last = entries.find((e) => !e.undone);
    if (!last || busyRef.current) return;
    busyRef.current = true; setBusy(true);
    try {
      const p = last.product;
      const current = knownQty.current[p.id] ?? productsRef.current.find((x) => x.id === p.id)?.quantity ?? p.quantity;
      const newQty = await onAdjust({ ...p, quantity: current }, 1);
      knownQty.current[p.id] = newQty;
      setEntries((prev) => prev.map((e) => (e.id === last.id ? { ...e, undone: true } : e)));
      showFlash({ kind: "ok", text: `${p.code}  +1 restored  →  ${newQty}` });
    } catch (err: unknown) {
      showFlash({ kind: "bad", text: (err as Error)?.message || "Could not restore" });
    } finally {
      busyRef.current = false; setBusy(false);
    }
  };

  // Countdown shown while reads are ignored, so a silent camera does not look broken.
  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => {
      setCooldownLeft(Math.max(0, COOLDOWN_MS - (Date.now() - lastReadAt.current)));
    }, 100);
    return () => clearInterval(t);
  }, [open]);

  // Camera lifecycle: start when opened, stop when closed or unmounted.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setCameraError(null); setStarting(true);
    setEntries([]); setFlash(null);
    knownQty.current = {}; lastReadAt.current = 0; lastCode.current = "";

    // The dialog mounts its content in a portal; the container element only exists a
    // frame or two later. Constructing the reader before it is there throws, so wait
    // for the node itself rather than for a guessed delay.
    let timer: ReturnType<typeof setTimeout>;
    let tries = 0;
    const attach = () => {
      if (cancelled) return;
      const el = document.getElementById("stock-scan-out-reader");
      if (!el) {
        if (tries++ > 60) { setStarting(false); setCameraError("Could not open the camera view"); return; }
        timer = setTimeout(attach, 50);
        return;
      }
      let scanner: Html5Qrcode;
      try {
        scanner = new Html5Qrcode("stock-scan-out-reader", { verbose: false });
      } catch (err: unknown) {
        setStarting(false);
        setCameraError((err as Error)?.message || "Could not open the camera view");
        return;
      }
      scannerRef.current = scanner;
      scanner
        .start(
          { facingMode: "environment" },
          { fps: 10, qrbox: (w, h) => { const s = Math.min(w, h) * 0.7; return { width: s, height: s }; } },
          (text) => { void handleRead(text); },
          () => { /* no code in frame — normal */ },
        )
        .then(() => {
          surfaceRef.current = el.querySelector("video");
          if (!cancelled) setStarting(false);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          setStarting(false);
          setCameraError((err as Error)?.message || String(err) || "Camera unavailable");
        });
    };
    timer = setTimeout(attach, 0);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      // html5-qrcode sets `onabort` and `onerror` on the video it creates, and both
      // THROW a bare string (camera/core-impl.js). Closing the camera pulls the tracks
      // off the MediaStream while the video is still pointed at it, so the browser
      // fires `abort` on the way out — and that throw, from a DOM event handler, lands
      // in window.onerror. The scanner shut down exactly as asked and the telemetry log
      // fills with "RenderedCameraImpl video surface onabort() called". Detach them
      // first: nothing reads them, and a camera that genuinely fails still reports
      // through the start() rejection above.
      const surface = surfaceRef.current;
      surfaceRef.current = null;
      if (surface) { surface.onabort = null; surface.onerror = null; }
      const s = scannerRef.current;
      scannerRef.current = null;
      if (s) {
        const stop = s.isScanning ? s.stop() : Promise.resolve();
        stop.catch(() => undefined).finally(() => { try { s.clear(); } catch { /* ignore */ } });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const activeEntries = entries.filter((e) => !e.undone);
  const canUndo = activeEntries.length > 0 && !busy;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-4 pt-4 pb-2">
          <DialogTitle className="flex items-center gap-2 uppercase tracking-wide">
            <ScanLine className="h-5 w-5" /> Scan out
          </DialogTitle>
          <DialogDescription>Each QR read takes 1 unit out of stock. The camera stays on.</DialogDescription>
        </DialogHeader>

        {/* Feedback strip: short, at the top, never blocks the next read. */}
        <div
          role="status"
          aria-live="polite"
          className={`mx-4 mb-2 min-h-10 rounded-md px-3 py-2 text-sm font-semibold tabular-nums transition-colors ${
            flash?.kind === "ok"
              ? "bg-success/15 text-success"
              : flash?.kind === "bad"
                ? "bg-destructive/15 text-destructive-strong"
                : "bg-muted text-muted-foreground"
          }`}
        >
          {flash ? flash.text : busy ? "Saving…" : cooldownLeft > 0 ? `Ready in ${(cooldownLeft / 1000).toFixed(1)}s` : "Point the camera at a part label"}
        </div>

        <div className="relative mx-4 overflow-hidden rounded-md bg-black aspect-square max-h-[45vh]">
          <div id="stock-scan-out-reader" className="h-full w-full [&_video]:h-full [&_video]:w-full [&_video]:object-cover" />
          {starting && !cameraError && (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Opening camera…
            </div>
          )}
          {cameraError && (
            <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-destructive-strong">
              Camera unavailable: {cameraError}
            </div>
          )}
          {cooldownLeft > 0 && !starting && !cameraError && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-black/60 px-3 py-1 text-center text-xs text-white/80">
              Paused {(cooldownLeft / 1000).toFixed(1)}s
            </div>
          )}
        </div>

        <div className="flex items-center justify-between px-4 pt-3 pb-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            This session · {activeEntries.length} {activeEntries.length === 1 ? "part" : "parts"}
          </p>
          <Button size="sm" variant="outline" onClick={undoLast} disabled={!canUndo}>
            <Undo2 className="mr-1 h-4 w-4" /> Undo last
          </Button>
        </div>

        <ul className="max-h-40 overflow-y-auto px-4 pb-4 text-sm divide-y">
          {entries.length === 0 ? (
            <li className="py-3 text-muted-foreground">No reads yet.</li>
          ) : entries.map((e) => (
            <li key={e.id} className={`flex items-center justify-between gap-3 py-2 ${e.undone ? "line-through opacity-50" : ""}`}>
              <span className="min-w-0 truncate font-medium">{e.product.code}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {e.undone ? "restored" : `−1 → ${e.newQty}`} · {format(e.at, "HH:mm:ss")}
              </span>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
