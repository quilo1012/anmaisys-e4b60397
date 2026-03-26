import { useState, useRef, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useWOMessages, useSendWOMessage } from "@/hooks/useWOMessages";
import { useAuth } from "@/contexts/AuthContext";
import { MessageCircle, Send, Loader2, Image as ImageIcon } from "lucide-react";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";

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
    try {
      const path = `chat/${workOrderId}/${Date.now()}_${file.name}`;
      const { error } = await supabase.storage.from("wo-photos").upload(path, file);
      if (error) throw error;
      const { data: urlData } = supabase.storage.from("wo-photos").getPublicUrl(path);
      await sendMessage.mutateAsync({ workOrderId, message: "📷 Image", imageUrl: urlData.publicUrl });
    } catch {
      // silently fail
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
                      {!isOwn && <p className="text-[10px] font-semibold opacity-70 mb-0.5">{msg.user_name}</p>}
                      {msg.image_url && (
                        <img src={msg.image_url} alt="Attachment" className="rounded max-h-32 mb-1 cursor-pointer" onClick={() => window.open(msg.image_url!, "_blank")} />
                      )}
                      {msg.message && msg.message !== "📷 Image" && <p className="text-sm">{msg.message}</p>}
                      {msg.message === "📷 Image" && !msg.image_url && <p className="text-sm">📷 Image</p>}
                    </div>
                    <span className="text-[10px] text-muted-foreground mt-0.5">{format(new Date(msg.created_at), "HH:mm")}</span>
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
