import { Users } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useMyPhoto, useSignedUrl } from "@/hooks/useChat";
import { useAuth } from "@/contexts/AuthContext";
import { initials } from "@/lib/chat";
import { cn } from "@/lib/utils";
import { AvailabilityDot } from "@/components/chat/AvailabilityDot";
import { useMyDisplayedAvailability } from "@/hooks/useCommunicationPresence";
import type { AvailabilityStatus } from "@/lib/communicationPresence";

const SIZES = { xs: "h-7 w-7 text-xs", sm: "h-8 w-8 text-xs", md: "h-10 w-10 text-sm", lg: "h-16 w-16 text-lg", xl: "h-32 w-32 text-3xl" } as const;

/**
 * A person's or a group's photo, from the private `avatars` bucket through a signed
 * link; the initials (or a group icon) whenever there is no photo, or it fails to load.
 */
export function ChatAvatar({ name, path, size = "md", group = false, className, status }: {
  name: string;
  path?: string | null;
  size?: keyof typeof SIZES;
  group?: boolean;
  className?: string;
  /** Availability, shown as a dot on the photo's corner. Nothing is drawn when it is null: not seen, not "offline". */
  status?: AvailabilityStatus | null;
}) {
  const { data: url } = useSignedUrl("avatars", path ?? null);
  const avatar = (
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
  if (!status) return avatar;
  // The dot sits outside the round photo (which clips), on a wrapper that keeps its size.
  return (
    <span className="relative inline-flex shrink-0">
      {avatar}
      <AvailabilityDot
        status={status} size={size === "xs" || size === "sm" ? "sm" : "md"}
        className="absolute -bottom-0.5 -right-0.5 ring-2 ring-background"
      />
    </span>
  );
}

/** The signed-in person, with their photo when they have one, and their availability. */
export function MyAvatar({ size = "sm", className }: { size?: keyof typeof SIZES; className?: string }) {
  const { profile } = useAuth();
  const { data } = useMyPhoto();
  const status = useMyDisplayedAvailability();
  return <ChatAvatar name={profile?.name ?? "?"} path={data?.path} size={size} className={className} status={status} />;
}
