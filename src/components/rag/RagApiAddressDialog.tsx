import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { invokeFunction } from "@/lib/invokeFunction";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { CloudDownload, Plug } from "lucide-react";

/**
 * The SharePoint RAG reader runs behind a tunnel whose address changes each time
 * it restarts. Rather than a code change every time, an admin edits it here.
 * The access key stays on the server and is never shown.
 */
export function RagApiAddressDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    (async () => {
      const { data, error } = await (supabase as any)
        .from("system_settings")
        .select("rag_api_base_url")
        .limit(1)
        .maybeSingle();
      if (error) toast.error(error.message);
      setUrl(String(data?.rag_api_base_url ?? ""));
      setLoading(false);
    })();
  }, [open]);

  const save = async () => {
    const value = url.trim().replace(/\/+$/, "");
    if (value && !/^https?:\/\/\S+$/i.test(value)) {
      toast.error("Enter a full address starting with https://");
      return;
    }
    setSaving(true);
    const { data: row } = await (supabase as any)
      .from("system_settings").select("id").limit(1).maybeSingle();
    if (!row?.id) { toast.error("Settings row is missing"); setSaving(false); return; }
    const { error } = await (supabase as any)
      .from("system_settings")
      .update({ rag_api_base_url: value || null })
      .eq("id", row.id);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("SharePoint service address saved");
    onOpenChange(false);
  };

  const test = async () => {
    setTesting(true);
    try {
      const { data, error } = await invokeFunction<any>("rag-sharepoint-sync", { mode: "health" });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.message || data.error);
      toast.success(`Connected — ${data?.health?.service ?? "service"} is reachable`);
    } catch (e) {
      toast.error((e as Error).message || "Could not reach the service");
    } finally {
      setTesting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CloudDownload className="h-4 w-4" /> SharePoint RAG service
          </DialogTitle>
          <DialogDescription>
            Address of the service that reads the factory RAG workbooks from SharePoint.
            Update it whenever the address changes. The access key is kept on the server.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="rag-api-url">Service address</Label>
          <Input
            id="rag-api-url"
            value={url}
            placeholder="https://example.trycloudflare.com"
            onChange={(e) => setUrl(e.target.value)}
            disabled={loading}
            autoComplete="off"
          />
        </div>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={test} disabled={testing || loading}>
            <Plug className="h-4 w-4 mr-2" />
            {testing ? "Testing…" : "Test connection"}
          </Button>
          <Button onClick={save} disabled={saving || loading}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
