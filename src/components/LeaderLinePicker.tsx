/**
 * LeaderLinePicker — you pick a line, you never type one.
 *
 * NAME. There is already a `LinePicker` in this folder, and it is a different
 * thing: a line + mobile-asset picker for new Maintenance Orders, with props
 * `{ lineId, mobileAssetId, onChange }`. This one is the multi-select over the
 * line catalogue used by leader PINs. Two components, two jobs, two names.
 *
 * WHY THIS EXISTS
 * `leader_pins.lines` is a `text[]` with no foreign key, guarded on write by the
 * trigger `trg_leader_pins_lines_must_exist` (migration 20260906090000), which
 * raises P0001 for any value that is not a row in `public.lines`. The screen fed
 * that trigger a free-text, comma-separated input, so the only feedback a name
 * like "Gel Packing" got was a red toast AFTER the save — and "Gel Packing" is
 * not a typo the person can fix by guessing, because the catalogue calls that
 * line "GEL Line".
 *
 * A field whose value must match a catalogue exactly is not a text field. This
 * component reads the catalogue and offers it; the invalid value stops being
 * reachable, and the trigger goes back to being what it should always have been
 * — a last line of defence that nobody in the UI ever trips.
 *
 * VALUES OUTSIDE THE CATALOGUE
 * The original note here said rows already held names matching nothing, naming
 * 'Capsules & Tablets' on four leaders. Checked against production on 03/10/2026:
 * every value in `leader_pins.lines` now matches an active line, so that cleanup
 * has happened. The handling below stays anyway — it costs nothing, and the day
 * a line is renamed or deactivated the leaders pointing at the old name have to
 * be visible rather than silently dropped. They are kept in `value` until removed
 * by hand, so opening a dialog and pressing Save never quietly rewrites data.
 */
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AlertTriangle, Check, Loader2, RefreshCw, Search, X } from "lucide-react";

export type LeaderLinePickerProps = {
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  /** Ties the external <Label htmlFor> to the search box. */
  id?: string;
  className?: string;
};

type CatalogLine = { id: string; name: string };

/** Comparison the trigger does not do, so the UI does it: trim + case-fold. */
const key = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

export function LeaderLinePicker({ value, onChange, disabled, id, className }: LeaderLinePickerProps) {
  const [catalog, setCatalog] = useState<CatalogLine[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    (async () => {
      const { data, error } = await supabase
        .from("lines")
        .select("id, name, display_order")
        .eq("active", true)
        .order("display_order", { ascending: true })
        .order("name", { ascending: true });
      if (cancelled) return;
      if (error) {
        // Not a toast. A dialog that cannot read the catalogue has to say so in
        // place, next to the field, and offer the retry — a toast over a form is
        // gone in four seconds and takes the explanation with it.
        setLoadError(error.message);
        setCatalog(null);
        return;
      }
      setCatalog(((data ?? []) as CatalogLine[]).map((l) => ({ id: l.id, name: l.name })));
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadTick]);

  const selectedKeys = useMemo(() => new Set(value.map(key)), [value]);

  /** Selected values with no row behind them — shown, not hidden. */
  const orphans = useMemo(() => {
    if (!catalog) return [];
    const known = new Set(catalog.map((l) => key(l.name)));
    return value.filter((v) => !known.has(key(v)));
  }, [catalog, value]);

  const visible = useMemo(() => {
    if (!catalog) return [];
    const q = key(query);
    if (!q) return catalog;
    return catalog.filter((l) => key(l.name).includes(q));
  }, [catalog, query]);

  const toggle = (name: string) => {
    if (disabled) return;
    onChange(
      selectedKeys.has(key(name))
        ? value.filter((v) => key(v) !== key(name))
        : [...value, name],
    );
  };

  const remove = (name: string) => onChange(value.filter((v) => key(v) !== key(name)));

  const selectAll = () => {
    if (!catalog) return;
    const missing = catalog.filter((l) => !selectedKeys.has(key(l.name))).map((l) => l.name);
    onChange([...value, ...missing]);
  };

  const showSearch = (catalog?.length ?? 0) > 8;

  return (
    <div className={cn("space-y-2", className)}>
      {/* What is chosen, as chips, above the list — on a tablet the list scrolls
          and the selection would otherwise be off screen while you are making it. */}
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5" role="list" aria-label="Selected lines">
          {value.map((name) => {
            const orphan = orphans.some((o) => key(o) === key(name));
            return (
              <span
                key={name}
                role="listitem"
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs",
                  orphan
                    ? "border-warning bg-warning/10 text-warning-strong"
                    : "border-input bg-muted text-foreground",
                )}
              >
                {orphan && <AlertTriangle className="h-3 w-3" aria-hidden="true" />}
                {name}
                {orphan && <span className="opacity-80">· not in catalogue</span>}
                <button
                  type="button"
                  onClick={() => remove(name)}
                  disabled={disabled}
                  aria-label={`Remove ${name}`}
                  className="ml-0.5 rounded-full p-0.5 hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                >
                  <X className="h-3 w-3" aria-hidden="true" />
                </button>
              </span>
            );
          })}
        </div>
      )}

      {orphans.length > 0 && (
        <p className="text-xs text-warning-strong">
          {orphans.length === 1 ? "This line is" : "These lines are"} stored on the leader but
          {orphans.length === 1 ? " does" : " do"} not exist in the catalogue, so nothing is ever
          counted against {orphans.length === 1 ? "it" : "them"}. Pick the real line and remove the
          old value.
        </p>
      )}

      {loadError ? (
        <div className="rounded-md border border-destructive/50 bg-destructive/5 p-3 text-sm">
          <p className="font-medium text-destructive-strong">The line catalogue did not load.</p>
          <p className="mt-1 text-xs text-muted-foreground">{loadError}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={() => setReloadTick((t) => t + 1)}
          >
            <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
            Try again
          </Button>
        </div>
      ) : catalog === null ? (
        <div className="flex items-center gap-2 rounded-md border p-3 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Loading lines…
        </div>
      ) : (
        <>
          {showSearch && (
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                id={id}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search lines"
                className="pl-9"
                disabled={disabled}
                autoComplete="off"
              />
            </div>
          )}

          <div className="max-h-60 overflow-y-auto rounded-md border" role="group" aria-label="Lines">
            {visible.length === 0 ? (
              <p className="p-3 text-sm text-muted-foreground">
                {catalog.length === 0
                  ? "No active lines in the catalogue."
                  : `No line matches “${query}”.`}
              </p>
            ) : (
              visible.map((line) => {
                const on = selectedKeys.has(key(line.name));
                return (
                  <button
                    key={line.id}
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    disabled={disabled}
                    onClick={() => toggle(line.name)}
                    /* 48px, because this dialog is used on the Galaxy Tab on the
                       floor with gloves on. */
                    className={cn(
                      "flex min-h-[48px] w-full items-center gap-3 border-b px-3 py-2 text-left text-sm last:border-b-0",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                      on ? "bg-accent/60 font-medium" : "hover:bg-accent/40",
                      disabled && "cursor-not-allowed opacity-50",
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-5 w-5 shrink-0 items-center justify-center rounded border",
                        on ? "border-primary bg-primary text-primary-foreground" : "border-input",
                      )}
                      aria-hidden="true"
                    >
                      {on && <Check className="h-3.5 w-3.5" />}
                    </span>
                    {line.name}
                  </button>
                );
              })
            )}
          </div>

          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground" aria-live="polite">
              {value.length} of {catalog.length} line{catalog.length === 1 ? "" : "s"} selected
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={selectAll}
                disabled={disabled || catalog.length === 0 || catalog.every((l) => selectedKeys.has(key(l.name)))}
              >
                Select all
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onChange([])}
                disabled={disabled || value.length === 0}
              >
                Clear
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default LeaderLinePicker;
