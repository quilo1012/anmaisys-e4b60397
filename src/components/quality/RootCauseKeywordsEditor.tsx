import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";

/**
 * As palavras do título que dizem de quem é a culpa.
 *
 * O gatilho `default_root_cause_from_label` lê esta tabela quando a causa raiz está
 * vazia: a primeira palavra-chave activa que o título nomeia passa a ser a área, e o
 * líder deixa de ser cobrado. O padrão é uma expressão regular sem maiúsculas — `\m` e
 * `\M` são as fronteiras de palavra, e é isso que impede "Lab" de apanhar "label".
 * Só admin e quality_supervisor escrevem (RLS); a base recusa um padrão inválido.
 */
interface Keyword { id: string; area: string; pattern: string; active: boolean; note: string | null; sort: number }

const KEY = ["root_cause_area_keyword"];

export function RootCauseKeywordsEditor() {
  const qc = useQueryClient();
  const db = supabase as any;
  const [area, setArea] = useState("");
  const [pattern, setPattern] = useState("");

  const { data = [], isError } = useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<Keyword[]> => {
      const { data, error } = await db.from("root_cause_area_keyword").select("*").order("sort").order("area");
      if (error) throw error;
      return data ?? [];
    },
  });

  const run = useMutation({
    mutationFn: async (fn: () => PromiseLike<{ error: unknown }>) => {
      const { error } = await fn();
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
    onError: (e: any) => toast.error(e?.message ?? "Could not save"),
  });

  const add = async () => {
    if (!area.trim() || !pattern.trim()) return;
    const sort = (data.at(-1)?.sort ?? 0) + 10;
    await run.mutateAsync(() => db.from("root_cause_area_keyword").insert({ area: area.trim(), pattern: pattern.trim(), sort }));
    setArea(""); setPattern("");
  };

  return (
    <section className="space-y-2 border-t pt-4">
      <h3 className="text-sm font-semibold">Root cause from the title</h3>
      <p className="text-2xs text-muted-foreground">
        When an action has no root cause and its title matches one of these patterns, the area is set
        automatically and the leader is not charged. Patterns are case-insensitive; use \m and \M for word
        boundaries. Applies to new actions and renamed ones — Quality can always change it by hand.
      </p>
      {isError && <p className="text-sm text-destructive">The keyword list could not be read.</p>}
      <ul className="space-y-1.5">
        {data.map((k) => (
          <li key={k.id} className="flex items-center gap-2">
            <Input className="w-28" defaultValue={k.area}
              onBlur={(e) => e.target.value.trim() !== k.area && run.mutate(() => db.from("root_cause_area_keyword").update({ area: e.target.value.trim() }).eq("id", k.id))} />
            <Input className="flex-1 font-mono text-xs" defaultValue={k.pattern} title={k.note ?? undefined}
              onBlur={(e) => e.target.value.trim() !== k.pattern && run.mutate(() => db.from("root_cause_area_keyword").update({ pattern: e.target.value.trim() }).eq("id", k.id))} />
            <Switch checked={k.active} aria-label="Active"
              onCheckedChange={(v) => run.mutate(() => db.from("root_cause_area_keyword").update({ active: v }).eq("id", k.id))} />
            <Button variant="ghost" size="icon" aria-label="Delete"
              onClick={() => run.mutate(() => db.from("root_cause_area_keyword").delete().eq("id", k.id))}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-2">
        <Input className="w-28" placeholder="Area" value={area} onChange={(e) => setArea(e.target.value)} />
        <Input className="flex-1 font-mono text-xs" placeholder="\moffice\M" value={pattern} onChange={(e) => setPattern(e.target.value)} />
        <Button size="sm" onClick={add} disabled={run.isPending || !area.trim() || !pattern.trim()}>Add</Button>
      </div>
    </section>
  );
}
