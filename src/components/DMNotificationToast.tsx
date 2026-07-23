import { toast } from "sonner";
import { X, MessageSquare, ArrowRight } from "lucide-react";
import logo from "@/assets/appliedlogo.jpeg";

function strings() {
  const lang =
    typeof localStorage !== "undefined" ? localStorage.getItem("app.language") : "en";
  return lang === "pt"
    ? { tag: "Nova mensagem", open: "Abrir conversa" }
    : { tag: "New message", open: "Open chat" };
}

/**
 * Show a discreet, MSN-style in-app notification for an incoming direct
 * message: company logo + who sent it + an "open" action. The message
 * content is intentionally NOT shown — the user opens the chat to read it.
 * Rendered through sonner's custom toast so it inherits positioning/stacking.
 */
export function showDMToast(opts: {
  senderName: string;
  onOpen: () => void;
}) {
  const t = strings();
  toast.custom(
    (id) => (
      <div className="pointer-events-auto flex w-[360px] max-w-[calc(100vw-2rem)] items-start gap-3 rounded-xl border border-border bg-card p-3 shadow-xl ring-1 ring-black/5">
        <div className="relative shrink-0">
          <img
            src={logo}
            alt=""
            className="h-11 w-11 rounded-lg bg-white object-contain ring-1 ring-border"
          />
          <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-primary-foreground ring-2 ring-card">
            <MessageSquare className="h-2.5 w-2.5" />
          </span>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-primary">
              {t.tag}
            </span>
            <button
              type="button"
              onClick={() => toast.dismiss(id)}
              aria-label="Close"
              className="-mr-1 -mt-1 rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <p className="truncate text-sm font-semibold text-foreground">
            {opts.senderName}
          </p>

          <button
            type="button"
            onClick={() => {
              opts.onOpen();
              toast.dismiss(id);
            }}
            className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary transition-opacity hover:opacity-80"
          >
            {t.open}
            <ArrowRight className="h-3 w-3" />
          </button>
        </div>
      </div>
    ),
    { duration: 8000 },
  );
}

/** Localized title for the native OS notification. */
export function dmNativeTitle(senderName: string) {
  const lang =
    typeof localStorage !== "undefined" ? localStorage.getItem("app.language") : "en";
  return lang === "pt"
    ? `Nova mensagem · ${senderName}`
    : `New message · ${senderName}`;
}

/** Localized body for the native OS notification — no message content (MSN-style). */
export function dmNativeBody() {
  const lang =
    typeof localStorage !== "undefined" ? localStorage.getItem("app.language") : "en";
  return lang === "pt" ? "Toque para abrir a conversa" : "Tap to open the chat";
}
