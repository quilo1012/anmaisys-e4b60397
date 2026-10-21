import { AlertCircle, Plus, RotateCw, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ChatAvatar } from "@/components/chat/ChatAvatar";
import { listTime, type ConversationKey, type ConversationSummary } from "@/lib/chat";
import { cn } from "@/lib/utils";
import type { AvailabilityStatus } from "@/lib/communicationPresence";

export type ListFilter = "all" | "dm" | "group";

const FILTERS: { key: ListFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "dm", label: "Private" },
  { key: "group", label: "Groups" },
];

function Row({ c, active, onSelect, status }: { c: ConversationSummary; active: boolean; onSelect: () => void; status: AvailabilityStatus | null }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? "true" : undefined}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active ? "bg-accent" : "hover:bg-muted/70",
      )}
    >
      <ChatAvatar name={c.name} path={c.avatarPath} group={c.kind === "group"} status={c.kind === "dm" ? status : null} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className={cn("truncate text-sm", c.unread > 0 ? "font-semibold text-foreground" : "font-medium")}>{c.name}</span>
          <span className={cn("shrink-0 text-2xs tabular-nums", c.unread > 0 ? "font-semibold text-primary" : "text-muted-foreground")}>
            {listTime(c.lastAt)}
          </span>
        </span>
        <span className="mt-0.5 flex items-center justify-between gap-2">
          <span className={cn("truncate text-xs", c.unread > 0 ? "text-foreground" : "text-muted-foreground")}>
            {c.preview ?? c.subtitle ?? " "}
          </span>
          {c.unread > 0 && (
            <span
              className="shrink-0 rounded-full bg-primary px-1.5 py-0.5 text-2xs font-semibold leading-none text-primary-foreground"
              aria-label={`${c.unread} unread`}
            >
              {c.unread > 99 ? "99+" : c.unread}
            </span>
          )}
        </span>
      </span>
    </button>
  );
}

export function ConversationList({
  conversations, activeKey, onSelect, search, onSearch, filter, onFilter,
  loading, error, onRetry, groupsNotSetUp, canCreateGroup, onNewGroup, header, presence,
}: {
  conversations: ConversationSummary[];
  activeKey: ConversationKey | null;
  onSelect: (key: ConversationKey) => void;
  search: string;
  onSearch: (s: string) => void;
  filter: ListFilter;
  onFilter: (f: ListFilter) => void;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  groupsNotSetUp: boolean;
  canCreateGroup: boolean;
  onNewGroup: () => void;
  header?: React.ReactNode;
  /** Availability by user id, as the server shows it to you. A person not in it gets no dot. */
  presence?: ReadonlyMap<string, AvailabilityStatus>;
}) {
  const groups = conversations.filter((c) => c.kind === "group");
  const dms = conversations.filter((c) => c.kind === "dm");
  const sections = filter === "all"
    ? [{ title: "Groups", items: groups }, { title: "Private", items: dms }]
    : [{ title: null, items: filter === "group" ? groups : dms }];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-3 border-b p-3">
        {header}
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
          <Input
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search people and groups"
            aria-label="Search conversations"
            className="h-9 pl-8"
          />
        </div>
        <div className="flex items-center gap-2">
          <div role="tablist" aria-label="Show" className="flex flex-1 rounded-md bg-muted p-0.5">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                role="tab"
                aria-selected={filter === f.key}
                onClick={() => onFilter(f.key)}
                className={cn(
                  "flex-1 rounded px-2 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  filter === f.key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
          {canCreateGroup && (
            <Button size="sm" variant="outline" className="h-8 gap-1" onClick={onNewGroup}>
              <Plus className="h-3.5 w-3.5" /> Group
            </Button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {loading ? (
          <div className="space-y-1" aria-busy="true" aria-label="Loading conversations">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-3 py-2.5">
                <Skeleton className="h-10 w-10 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3 w-2/3" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="flex flex-col items-center gap-3 px-4 py-10 text-center text-sm">
            <AlertCircle className="h-6 w-6 text-destructive-strong" aria-hidden />
            <p className="text-muted-foreground">Conversations could not be loaded. {error}</p>
            <Button size="sm" variant="outline" onClick={onRetry} className="gap-1.5">
              <RotateCw className="h-3.5 w-3.5" /> Try again
            </Button>
          </div>
        ) : (
          sections.map((s, i) => (
            <section key={i} aria-label={s.title ?? undefined} className="mb-2">
              {s.title && (
                <h3 className="px-3 pb-1 pt-2 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">{s.title}</h3>
              )}
              {s.items.length === 0 ? (
                <p className="px-3 py-3 text-xs text-muted-foreground">
                  {search
                    ? "Nothing matches."
                    : s.title === "Groups" || filter === "group"
                      ? groupsNotSetUp
                        ? "Groups are being set up."
                        : canCreateGroup ? "No groups yet. Create one for a department or a team." : "You are not in any group yet."
                      : "Nobody to write to yet."}
                </p>
              ) : (
                s.items.map((c) => (
                  <Row key={c.key} c={c} active={c.key === activeKey} onSelect={() => onSelect(c.key)} status={presence?.get(c.id) ?? null} />
                ))
              )}
            </section>
          ))
        )}
      </div>
    </div>
  );
}
