import { useEffect, useRef, useState } from "react";
import { ImagePlus, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ChatAvatar } from "@/components/chat/ChatAvatar";
import { useAuth } from "@/contexts/AuthContext";
import { useMyPhoto, useSetMyPhoto } from "@/hooks/useChat";
import { AVATAR_MAX_BYTES, AVATAR_TYPES, avatarProblem, formatBytes, initials } from "@/lib/chat";

/**
 * Your own photo: choose one, see it, then save — or remove the one you have.
 *
 * Everybody signed in sets their own, whatever their role; nobody sets somebody
 * else's from here. The database agrees: `set_avatar()` writes only the caller's row
 * (an admin may name another person, and this screen never does), and storage takes a
 * file only into the caller's own folder of the private `avatars` bucket (BLOCO 108).
 */
export function ProfilePhotoDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { profile } = useAuth();
  const name = profile?.name ?? "You";
  const mine = useMyPhoto();
  const save = useSetMyPhoto();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => { if (!open) setFile(null); }, [open]);
  useEffect(() => {
    if (!file) { setPreview(null); return; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const choose = (f: File | undefined) => {
    if (!f) return;
    const problem = avatarProblem(f);
    if (problem) { toast.error(problem); return; }
    setFile(f);
  };

  const run = async (next: File | null) => {
    try {
      await save.mutateAsync({ file: next, previous: mine.data?.path ?? null });
      toast.success(next ? "Photo saved" : "Photo removed");
      onOpenChange(false);
    } catch (e) {
      toast.error((e as Error)?.message || "The photo could not be saved");
    }
  };

  const hasPhoto = !!mine.data?.path;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Your photo</DialogTitle>
          <DialogDescription>Shown next to your name in the Communication Hub and the menu.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col items-center gap-3 py-2">
          {preview ? (
            <Avatar className="h-32 w-32 text-3xl">
              <AvatarImage src={preview} alt="Preview of your new photo" className="object-cover" />
              <AvatarFallback>{initials(name)}</AvatarFallback>
            </Avatar>
          ) : (
            <ChatAvatar name={name} path={mine.data?.path} size="xl" />
          )}
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {file ? `${file.name} · ${formatBytes(file.size)} — not saved yet` : `JPEG, PNG or WebP, up to ${formatBytes(AVATAR_MAX_BYTES)}`}
          </p>
          <input
            ref={input}
            type="file"
            accept={AVATAR_TYPES.join(",")}
            className="hidden"
            onChange={(e) => { choose(e.target.files?.[0]); e.target.value = ""; }}
          />
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => input.current?.click()} disabled={save.isPending}>
            <ImagePlus className="h-4 w-4" /> {file || hasPhoto ? "Choose another photo" : "Choose a photo"}
          </Button>
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          {hasPhoto && !file ? (
            <Button variant="ghost" className="gap-1.5 text-destructive-strong" onClick={() => run(null)} disabled={save.isPending}>
              <Trash2 className="h-4 w-4" /> Remove photo
            </Button>
          ) : <span />}
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>Cancel</Button>
            <Button onClick={() => file && run(file)} disabled={!file || save.isPending}>
              {save.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} Save photo
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
