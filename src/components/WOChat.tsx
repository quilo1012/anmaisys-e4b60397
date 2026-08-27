import { useState, useRef, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useWOMessages, useSendWOMessage } from "@/hooks/useWOMessages";
import { useAuth } from "@/contexts/AuthContext";
import { MessageCircle, Send, Loader2, Image as ImageIcon } from "lucide-react";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { compressImage, getWOPhotoUrl } from "@/hooks/useWOPhotos";
import { toast } from "sonner";

/**
 * One signed URL per photo, asked for when the message is drawn.
 *
 * Signatures expire (an hour, from `getWOPhotoUrl`), so there is nothing worth storing:
 * the path is the durable half and the URL is derived. Mirrors `SignedPhoto` in
 * WorkOrderDetail — same bucket, same helper, same one-hour window.
 */
function ChatPhoto({ storagePath }: { storagePath: string }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let vivo = true;
    getWOPhotoUrl(storagePath).then((u) => { if (vivo) setUrl(u); });
    return () => { vivo = false; };
  }, [storagePath]);

  // A signature that could not be obtained is not a broken image with a torn-page icon:
  // it is worth saying, because the file may still be there and the next reload may work.
  if (!url) return <div className="mb-1 h-20 w-28 animate-pulse rounded bg-muted-foreground/20" />;
  return (
    <img
      src={url}
      alt="Fotografia anexada à mensagem"
      className="rounded max-h-32 mb-1 cursor-pointer"
      onClick={() => window.open(url, "_blank", "noopener,noreferrer")}
    />
  );
}

export function WOChat({ workOrderId }: { workOrderId: string }) {
  const { data: messages, isLoading } = useWOMessages(workOrderId);
  const sendMessage = useSendWOMessage();
  const { user } = useAuth();
  const [text, setText] = useState("");
  const [uploading, setUploading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async () => {
    if (!text.trim()) return;
    await sendMessage.mutateAsync({ workOrderId, message: text.trim() });
    setText("");
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    setUploading(true);
    // The path is what gets stored. `wo-photos` is private, so a URL built now would be
    // dead on arrival — the signature has to be asked for at read time, per message.
    const path = `chat/${workOrderId}/${Date.now()}_${file.name}`;
    try {
      const compressed = await compressImage(file);
      const { error } = await supabase.storage.from("wo-photos").upload(path, compressed);
      if (error) throw error;
      await sendMessage.mutateAsync({ workOrderId, message: "📷 Image", imagePath: path });
    } catch (err) {
      // Not silent. The upload can succeed and the insert still fail, which leaves a
      // file in the bucket and no message — it happened once in March and nobody could
      // have known, because this block said nothing.
      toast.error("A fotografia não foi enviada", {
        description: (err as { message?: string })?.message ?? "Tente novamente.",
      });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2"><MessageCircle className="h-4 w-4" /> Internal Chat</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="border rounded-lg">
          <div className="h-64 overflow-y-auto p-3 space-y-2 bg-muted/30">
            {isLoading ? (
              <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
            ) : !messages?.length ? (
              <p className="text-muted-foreground text-xs text-center py-8">No messages yet. Start the conversation.</p>
            ) : (
              messages.map((msg) => {
                const isOwn = msg.user_id === user?.id;
                return (
                  <div key={msg.id} className={`flex flex-col ${isOwn ? "items-end" : "items-start"}`}>
                    <div className={`max-w-[80%] rounded-lg px-3 py-2 ${isOwn ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                      {!isOwn && <p className="text-2xs font-semibold opacity-70 mb-0.5">{msg.user_name}</p>}
                      {msg.image_path && <ChatPhoto storagePath={msg.image_path} />}
                      {msg.message && msg.message !== "📷 Image" && <p className="text-sm">{msg.message}</p>}
                      {msg.message === "📷 Image" && !msg.image_path && <p className="text-sm">📷 Image</p>}
                    </div>
                    <span className="text-2xs text-muted-foreground mt-0.5">{format(new Date(msg.created_at), "HH:mm")}</span>
                  </div>
                );
              })
            )}
            <div ref={bottomRef} />
          </div>
          <div className="flex gap-2 p-2 border-t">
            <input type="file" accept="image/*" ref={fileRef} className="hidden" onChange={handleImageUpload} />
            <Button variant="ghost" size="icon" onClick={() => fileRef.current?.click()} disabled={uploading}>
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageIcon className="h-4 w-4" />}
            </Button>
            <Input
              placeholder="Type a message..."
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
              className="flex-1"
            />
            <Button size="icon" onClick={handleSend} disabled={!text.trim() || sendMessage.isPending}>
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
