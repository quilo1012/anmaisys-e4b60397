import { Users } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useSignedUrl } from "@/hooks/useChat";
import { initials } from "@/lib/chat";
import { cn } from "@/lib/utils";

const SIZES = { sm: "h-8 w-8 text-xs", md: "h-10 w-10 text-sm", lg: "h-16 w-16 text-lg" } as const;

/**
 * A person's or a group's photo, from the private `avatars` bucket through a signed
 * link; the initials (or a group icon) whenever there is no photo, or it fails to load.
 */
export function ChatAvatar({ name, path, size = "md", group = false, className }: {
  name: string;
  path?: string | null;
  size?: keyof typeof SIZES;
  group?: boolean;
  className?: string;
}) {
  const { data: url } = useSignedUrl("avatars", path ?? null);
  return (
    <Avatar className={cn(SIZES[size], className)}>
      {url && <AvatarImage src={url} alt="" className="object-cover" />}
      <AvatarFallback
        className={cn("font-semibold", group ? "bg-secondary text-secondary-foreground" : "bg-primary/10 text-primary")}
        aria-hidden
      >
        {group ? <Users className="h-[45%] w-[45%]" /> : initials(name)}
      </AvatarFallback>
    </Avatar>
  );
}
