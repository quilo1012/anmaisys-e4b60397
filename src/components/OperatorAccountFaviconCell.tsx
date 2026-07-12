import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { ImageIcon, Upload, X, Loader2 } from "lucide-react";
import { useUpdateOperatorAccountFavicon, type OperatorLineAccount } from "@/hooks/useOperatorAccounts";
import { fileToFaviconDataUrl } from "@/lib/faviconResize";

const ACCEPT = "image/png,image/jpeg,image/webp,image/svg+xml,image/x-icon";

export function OperatorAccountFaviconCell({ acc }: { acc: OperatorLineAccount }) {
  const { toast } = useToast();
  const save = useUpdateOperatorAccountFavicon();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const onPick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const url = await fileToFaviconDataUrl(file);
      await save.mutateAsync({ id: acc.id, favicon_url: url });
      toast({ title: "Favicon updated", description: acc.label });
    } catch (e: any) {
      toast({ title: "Failed to save", description: e.message, variant: "destructive" });
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const clear = async () => {
    setBusy(true);
    try {
      await save.mutateAsync({ id: acc.id, favicon_url: null });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <div className="flex h-9 w-9 items-center justify-center rounded-md border bg-muted/40 overflow-hidden">
        {acc.favicon_url ? (
          <img src={acc.favicon_url} alt="" className="h-full w-full object-contain" />
        ) : (
          <ImageIcon className="h-4 w-4 text-muted-foreground" />
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        hidden
        onChange={(e) => onPick(e.target.files?.[0])}
      />
      <Button
        variant="ghost"
        size="icon"
        title={acc.favicon_url ? "Replace favicon" : "Upload favicon"}
        onClick={() => inputRef.current?.click()}
        disabled={busy}
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
      </Button>
      {acc.favicon_url && (
        <Button variant="ghost" size="icon" title="Remove favicon" onClick={clear} disabled={busy}>
          <X className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
