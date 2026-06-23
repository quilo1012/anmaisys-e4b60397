import { useOnlineEngineers } from "@/hooks/useOnlineEngineers";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { format } from "date-fns";

export function OnlineEngineersPanel() {
  const { data: engineers } = useOnlineEngineers();
  const count = engineers?.length ?? 0;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-muted transition-colors"
          aria-label={`${count} engineers online`}
        >
          <div className="flex items-center gap-1.5">
            <div className={`w-2 h-2 rounded-full ${count > 0 ? "bg-green-500 animate-pulse" : "bg-muted-foreground/40"}`} />
            <span className="text-xs font-medium text-muted-foreground">
              {count} Engineer{count !== 1 ? "s" : ""} Online
            </span>
          </div>
          {count > 0 && (
            <div className="flex items-center gap-1">
              {engineers!.slice(0, 3).map((e) => (
                <span key={e.id} className="text-xs bg-secondary px-1.5 py-0.5 rounded-full">
                  {e.name.split(" ")[0]}
                </span>
              ))}
              {count > 3 && <span className="text-xs text-muted-foreground">+{count - 3}</span>}
            </div>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        <div className="px-3 py-2 border-b">
          <p className="text-sm font-semibold">Engineers Online</p>
          <p className="text-xs text-muted-foreground">{count} currently active</p>
        </div>
        <div className="max-h-72 overflow-y-auto">
          {count === 0 ? (
            <p className="px-3 py-4 text-sm text-muted-foreground text-center">No engineers online right now.</p>
          ) : (
            <ul className="divide-y">
              {engineers!.map((e) => (
                <li key={e.id} className="px-3 py-2 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
                    <span className="text-sm font-medium truncate">{e.name}</span>
                  </div>
                  <span className="text-[10px] text-muted-foreground shrink-0">
                    since {format(new Date(e.last_seen_at), "HH:mm")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
