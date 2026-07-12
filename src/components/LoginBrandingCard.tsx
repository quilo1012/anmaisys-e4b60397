import { useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Tablet, User as UserIcon, Upload, Trash2, Image as ImageIcon } from "lucide-react";
import {
  useLoginBranding,
  useSaveLoginBranding,
  useDeleteLoginBranding,
  type LoginMode,
} from "@/hooks/useLoginBranding";
import { useAuth } from "@/contexts/AuthContext";
import { fileToFaviconDataUrl } from "@/lib/faviconResize";

const ACCEPT = "image/png,image/jpeg,image/webp,image/svg+xml,image/x-icon";

function BrandingRow({ mode, label, icon }: { mode: LoginMode; label: string; icon: React.ReactNode }) {
  const { data } = useLoginBranding();
  const save = useSaveLoginBranding();
  const del = useDeleteLoginBranding();
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const current = data?.[mode];

  const onPick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const url = await fileToFaviconDataUrl(file);
      await save.mutateAsync({ mode, url });
      toast({ title: "Favicon updated", description: `Applied to ${label} sign-in.` });
    } catch (e: any) {
      toast({ title: "Failed to save", description: e.message, variant: "destructive" });
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="flex items-center gap-4 rounded-lg border p-4">
      <div className="flex h-14 w-14 items-center justify-center rounded-lg border bg-muted/40 overflow-hidden">
        {current?.url ? (
          <img src={current.url} alt="" className="h-full w-full object-contain" />
        ) : (
          <ImageIcon className="h-6 w-6 text-muted-foreground" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 font-medium">
          {icon}
          {label} sign-in
        </div>
        <p className="text-xs text-muted-foreground">
          {current ? `Custom favicon set · ${new Date(current.updated_at).toLocaleString()}` : "Using default favicon"}
        </p>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        hidden
        onChange={(e) => onPick(e.target.files?.[0])}
      />
      <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()} disabled={busy}>
        <Upload className="mr-2 h-4 w-4" /> {current ? "Replace" : "Upload"}
      </Button>
      {current && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => del.mutate(mode)}
          disabled={busy || del.isPending}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}

export function LoginBrandingCard() {
  const { role } = useAuth();
  if (role !== "admin") return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Login Favicons</CardTitle>
        <CardDescription>
          Set a distinct favicon for each sign-in mode. PNG/SVG recommended, max 200KB.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <BrandingRow mode="staff" label="Staff" icon={<UserIcon className="h-4 w-4" />} />
        <BrandingRow mode="tablet" label="Tablet" icon={<Tablet className="h-4 w-4" />} />
      </CardContent>
    </Card>
  );
}
