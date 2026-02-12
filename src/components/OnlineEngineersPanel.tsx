import { useOnlineEngineers } from "@/hooks/useOnlineEngineers";

export function OnlineEngineersPanel() {
  const { data: engineers } = useOnlineEngineers();
  const count = engineers?.length ?? 0;

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1.5">
        <div className={`w-2 h-2 rounded-full ${count > 0 ? "bg-green-500 animate-pulse" : "bg-muted-foreground/40"}`} />
        <span className="text-xs font-medium text-muted-foreground">
          {count} Engineer{count !== 1 ? "s" : ""} Online
        </span>
      </div>
      {count > 0 && (
        <div className="flex items-center gap-1">
          {engineers!.slice(0, 3).map((e) => (
            <span key={e.id} className="text-xs bg-secondary px-1.5 py-0.5 rounded-full">{e.name.split(" ")[0]}</span>
          ))}
          {count > 3 && <span className="text-xs text-muted-foreground">+{count - 3}</span>}
        </div>
      )}
    </div>
  );
}
