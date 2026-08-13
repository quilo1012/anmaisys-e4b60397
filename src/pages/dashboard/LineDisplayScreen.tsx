import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getCurrentFactoryShift, getCurrentShiftEnd, getCurrentShiftStart, SHIFT_LABEL } from "@/lib/shifts";
import {
  shiftClockPct,
  lineReading,
  balanceLabel,
  lastEntryAgeMinutes,
  BAND_STATUS,
  BAND_BG,
  LINE_STATUS,
  LINE_MESSAGES,
} from "@/lib/linePerformance";
import { identifyItemSku, pickLineSku, type LineSkuItem } from "@/lib/lineSku";
import { useSkuCatalogue } from "@/hooks/useSkuCatalogue";
import { ArrowLeft, Maximize2, Pencil, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";



type RagEntry = {
  id: string;
  entry_date: string;
  line: string;
  shift: string;
  plan_qty: number;
  actual_qty: number;
  updated_at: string;
};

type ProductionItem = {
  id: string;
  sku_id: string | null;
  sku_code_text: string | null;
  planned_qty: number | null;
  actual_qty: number | null;
  started_at: string | null;
  finished_at: string | null;
  updated_at: string | null;
};

const toSkuItem = (it: ProductionItem): LineSkuItem => ({
  sku_id: it.sku_id,
  sku_code_text: it.sku_code_text,
  actual: Number(it.actual_qty ?? 0),
  started_at: it.started_at,
  finished_at: it.finished_at,
});

function formatCountdown(ms: number) {
  if (ms <= 0) return "00:00:00";
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

export default function LineDisplayScreen() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const qc = useQueryClient();
  const { catalogue } = useSkuCatalogue();
  const [now, setNow] = useState(new Date());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>("");
  const [saving, setSaving] = useState(false);


  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Use the factory shift's session date/shift (Europe/London, with the
  // 00:00–06:00 night rollback) so the board matches the WRITE path — otherwise
  // the night shift's data lives under the previous calendar day and the board
  // shows blank ("No SKUs scheduled yet") from midnight to 06:00.
  const { sessionDate: date, shiftCode: shift } = getCurrentFactoryShift(now);
  const shiftDb = shift.toUpperCase(); // rag_weekly_entries stores DAY/NIGHT

  const { data: profile } = useQuery({
    queryKey: ["profile-line", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      // 1) Try profiles.production_line (explicit string match with rag_weekly_entries.line)
      const { data: prof } = await supabase
        .from("profiles")
        .select("name, production_line")
        .eq("id", user!.id)
        .maybeSingle();
      if (prof?.production_line) {
        return { name: prof.name, production_line: prof.production_line as string };
      }
      // 2) Fallback: resolve via operator_line_accounts.line_ids[0] -> lines.name
      const { data: ola } = await supabase
        .from("operator_line_accounts")
        .select("line_ids")
        .eq("user_id", user!.id)
        .maybeSingle();
      const firstLineId = (ola?.line_ids ?? [])[0];
      if (!firstLineId) return { name: prof?.name ?? "", production_line: null };
      const { data: ln } = await supabase
        .from("lines")
        .select("name")
        .eq("id", firstLineId)
        .maybeSingle();
      return { name: prof?.name ?? "", production_line: (ln?.name ?? null) as string | null };
    },
  });

  const line = profile?.production_line ?? null;

  // Permission to open REQUEST WO: admin/manager OR operator mapped to this line
  const { data: canRequest } = useQuery({
    queryKey: ["can-request-wo", user?.id, line],
    enabled: !!user?.id && !!line,
    queryFn: async () => {
      const { data: roles } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user!.id);
      const r = (roles ?? []).map((x: any) => x.role);
      if (r.includes("admin") || r.includes("manager")) return true;
      const { data: ln } = await supabase
        .from("lines")
        .select("id")
        .eq("name", line!)
        .maybeSingle();
      if (!ln?.id) return false;
      const { data: ola } = await supabase
        .from("operator_line_accounts")
        .select("line_ids")
        .eq("user_id", user!.id)
        .maybeSingle();
      return (ola?.line_ids ?? []).includes(ln.id);
    },
  });


  const { data: rag } = useQuery({
    queryKey: ["rag-live", date, line, shift],
    enabled: !!line,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rag_weekly_entries")
        .select("*")
        .eq("entry_date", date)
        .eq("line", line!)
        .eq("shift", shiftDb)
        .maybeSingle();
      if (error) throw error;
      return data as RagEntry | null;
    },
  });

  const { data: itemsData } = useQuery({
    queryKey: ["prod-items-live", date, line, shift],
    enabled: !!line,
    queryFn: async () => {
      const { data: sessions, error: e1 } = await supabase
        .from("production_sessions")
        .select("id, leader_name")
        .eq("session_date", date)
        .eq("line", line!)
        .eq("shift", shiftDb);
      if (e1) throw e1;
      const ids = (sessions ?? []).map((s: any) => s.id);
      // No session at all is a different answer from a session with no items,
      // so the absence is reported rather than flattened into an empty list.
      if (!ids.length) return { hasSession: false, hasLeader: false, items: [] as ProductionItem[] };
      const { data, error } = await supabase
        .from("production_items")
        // `sku_id` e `sku_code_text` os dois: um item identifica o produto por
        // qualquer uma das colunas e nenhuma é de fiar sozinha. Este ecrã lia só
        // o join por `sku_id` e escrevia um travessão nos outros — 11 dos 185
        // itens da última semana. A regra vive em `lineSku.ts`.
        .select("id, sku_id, sku_code_text, planned_qty, actual_qty, started_at, finished_at, updated_at")
        .in("session_id", ids);
      if (error) throw error;
      return {
        hasSession: true,
        hasLeader: (sessions ?? []).some((s) => !!s.leader_name),
        items: (data ?? []) as unknown as ProductionItem[],
      };
    },
  });

  const items = itemsData?.items;

  // Realtime subscriptions
  useEffect(() => {
    if (!line) return;
    const ch = supabase
      .channel(`line-display-${line}-${shift}-${date}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "rag_weekly_entries" }, () => {
        qc.invalidateQueries({ queryKey: ["rag-live", date, line, shift] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "production_sessions" }, () => {
        qc.invalidateQueries({ queryKey: ["prod-items-live", date, line, shift] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "production_items" }, () => {
        qc.invalidateQueries({ queryKey: ["prod-items-live", date, line, shift] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [line, shift, date, qc]);


  const target = Number(rag?.plan_qty ?? 0);
  const actual = Number(rag?.actual_qty ?? 0);

  const end = useMemo(() => getCurrentShiftEnd(now), [now]);
  const start = useMemo(() => getCurrentShiftStart(now), [now]);
  const countdown = formatCountdown(end.getTime() - now.getTime());

  // Quanto do turno já passou. É a única coisa de que a cor deste ecrã precisa
  // além do que já está nos mosaicos — e ao contrário da taxa padrão do SKU,
  // que aqui esteve e que a maior parte dos produtos não tem, está no relógio
  // da parede ao lado deste ecrã.
  const elapsedPct = useMemo(() => shiftClockPct(start, end, now), [start, end, now]);

  // A mesma leitura que veste o cartão do board, pela mesma função: se um dia
  // forem duas contas, é este ecrã que perde a autoridade, porque é o que se lê
  // de longe e ninguém confere.
  const reading = useMemo(
    () =>
      lineReading({
        target,
        actual,
        elapsedPct,
        hasSession: itemsData?.hasSession ?? false,
        hasLeader: itemsData?.hasLeader ?? false,
        orderCount: (items ?? []).length,
      }),
    [target, actual, elapsedPct, itemsData, items],
  );

  const entryAge = useMemo(
    () => lastEntryAgeMinutes((items ?? []).map((it) => it.updated_at), now),
    [items, now],
  );

  /** As duas colunas que identificam o produto, na forma que `lineSku.ts` lê. */
  const skuItems = useMemo<LineSkuItem[]>(() => (items ?? []).map(toSkuItem), [items]);

  const scored = reading.kind === "SCORED" ? reading : null;
  // Feito a dividir pelo alvo do turno — os dois mosaicos ACTUAL e TARGET que
  // estão um palmo acima. Nada mais: o "60%" do ritmo que aqui esteve era a
  // única percentagem do ecrã cujo denominador não está escrito na parede.
  const measure = scored ? `${scored.attainedPct.toFixed(1)}%` : LINE_MESSAGES[reading.kind];
  const status = scored
    ? { label: BAND_STATUS[scored.band].toUpperCase(), color: BAND_BG[scored.band] }
    : { label: LINE_STATUS[reading.kind].toUpperCase(), color: "bg-wall-line" };

  // A largura é o feito sobre o alvo; a marca é onde o relógio já vai. A
  // distância entre as duas É o relatório, e é a mesma distância de que a cor
  // sai — nada nesta barra vem de um número que não esteja nela.
  const planPct = target > 0 ? Math.min(100, (actual / target) * 100) : 0;
  const barColor = scored ? BAND_BG[scored.band] : "bg-wall-line";

  const goFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => {});
  };

  if (!line) {
    return (
      <div className="min-h-screen bg-wall text-wall-ink flex items-center justify-center p-8 text-center">
        <div>
          <h1 className="text-4xl font-bold mb-4">No Production Line Assigned</h1>
          <p className="text-xl text-wall-ink-muted">
            Ask an admin to assign a production line to your account.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-wall text-wall-ink p-6 flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-5xl font-black tracking-tight">{line}</h1>
          <p className="text-wall-ink-muted text-xl mt-1">{SHIFT_LABEL[shift]}</p>
        </div>
        <div className="flex items-center gap-4">
          <div className={`px-6 py-3 rounded-xl text-2xl font-bold ${status.color}`}>{status.label}</div>
          <div className="text-right">
            <div className="text-4xl font-figure font-bold">
              {now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </div>
            <div className="text-sm text-wall-ink-muted">
              Updated {rag?.updated_at ? new Date(rag.updated_at).toLocaleTimeString("en-GB") : "—"}
            </div>
          </div>
          <Button variant="outline" onClick={goFullscreen} className="h-12 px-4">
            <Maximize2 className="h-5 w-5" />
          </Button>
          <Button
            onClick={() => canRequest && navigate("/dashboard/operator")}
            disabled={!canRequest}
            title={canRequest ? "" : "Not authorized for this line"}
            className="h-12 px-4 bg-destructive hover:bg-destructive/90 text-destructive-foreground font-bold disabled:opacity-40 disabled:cursor-not-allowed"
          >
            REQUEST WO
          </Button>

          <Button variant="outline" onClick={() => navigate("/dashboard/line-hub")} className="h-12 px-4 gap-2">
            <ArrowLeft className="h-5 w-5" /> Back
          </Button>

        </div>
      </header>


      {(() => {
        /* Era `sort((a,b) => b.actual_qty - a.actual_qty)[0]`: a maior corrida do
           turno, que é outra pergunta e quase sempre outro produto. `pickLineSku`
           responde à certa — o item a correr, ou o que começou por último quando
           está tudo fechado — e é a mesma função que veste o cartão do board.

           As quantidades somam TODAS as linhas do mesmo produto. Line 6, 12/08
           tinha duas linhas para o mesmo SKU, uma ligada por `sku_id` e a outra
           só com o código em texto; mostrar uma delas dizia metade do que a linha
           fez. */
        const current = pickLineSku(skuItems, catalogue);
        if (!current) return null;
        const mine = (items ?? []).filter(
          (it) => identifyItemSku(toSkuItem(it), catalogue)?.code === current.code,
        );
        const p = mine.reduce((s, it) => s + Number(it.planned_qty ?? 0), 0);
        const a = mine.reduce((s, it) => s + Number(it.actual_qty ?? 0), 0);
        const pc = p > 0 ? Math.min(100, (a / p) * 100) : 0;
        const c = pc >= 95 ? "bg-success" : pc >= 75 ? "bg-warning" : "bg-destructive";
        /* Azul fixo, e não `--primary`. Este era o último sítio da parede onde uma
           cor virava com o tema, num ecrã cujo `index.css` diz por escrito que não
           pode: a preferência guardada no portátil de um supervisor mudava o painel
           pendurado sobre a linha. Com `--primary` o branco por cima dava 6,4:1 no
           tema claro e 3,1:1 no escuro; com o azul-900 dá 10,4:1 nos dois, e o
           gradiente para roxo — que já era uma cor fixa — deixa de estar meio preso
           ao tema e meio não. */
        return (
          <div className="bg-gradient-to-r from-blue-900 via-blue-900 to-purple-900 border-2 border-blue-900/40 rounded-2xl p-6 shadow-xl">
            {/* Branco, e não `text-primary`: o fundo deste painel era `--primary`, nas
                suas duas primeiras paragens, e o texto lia-se sobre a sua própria cor —
                1:1, invisível, em ambos os temas. Só o código do SKU escapava, por não
                trazer classe de cor nenhuma e herdar o `text-wall-ink` da página.
                `wall-ink` e não `wall-ink-muted`: sobre este fundo o cinzento dá 1,4:1,
                que é trocar um texto invisível por outro. */}
            <div className="flex items-center justify-between mb-4">
              {/* `text-xl` e não `text-sm`: a 3,1:1 no tema escuro isto só cumpre o AA
                  como texto grande, e 14 px num ecrã lido a três metros era pequeno de
                  qualquer forma. */}
              <div className="text-wall-ink text-xl tracking-widest font-bold">CURRENT JOB</div>
              <div className="text-wall-ink text-2xl font-figure font-bold">
                {a.toLocaleString()} / {p.toLocaleString()}
              </div>
            </div>
            <div className="text-5xl font-black mb-1">{current.code}</div>
            <div className="text-2xl text-wall-ink mb-4">{current.name}</div>
            <div className="h-4 bg-wall-panel/60 rounded-full overflow-hidden">
              <div className={`h-full ${c} transition-all duration-700`} style={{ width: `${pc}%` }} />
            </div>
          </div>
        );
      })()}

      <div className="grid grid-cols-4 gap-6">

        {/* Sem cor por mosaico, e a razão não é o contraste — é o que a cor diz.
            ACTUAL estava verde e REMAINING âmbar SEMPRE, corresse a linha bem ou
            mal: quatro rótulos fixos a gastar o vocabulário de andon que a chapa
            de estado e as barras desta mesma página usam a sério. Uma parede que
            está meia verde e meia âmbar a toda a hora é uma parede onde o verde
            deixa de querer dizer alguma coisa.

            Resolve de caminho um problema de leitura: `--primary` e os `-strong`
            viram com o tema, e no tema claro são cores ESCURAS — o TARGET dava
            2,6:1 e o ACTUAL 2,99:1 sobre o painel, abaixo do mínimo de 3:1 para
            texto grande. O `wall-ink` é fixo nos dois temas e dá 16,5:1. */}
        <WallTile label="TARGET" value={target.toLocaleString()} />
        <WallTile label="ACTUAL" value={actual.toLocaleString()} />
        <WallTile label="REMAINING" value={balanceLabel(target, actual)} />
        <WallTile label="SHIFT ENDS IN" value={countdown} mono />
      </div>

      <div className="bg-wall-panel rounded-2xl p-6">
        <div className="flex justify-between mb-3 text-xl">
          <span className="text-wall-ink-muted">Made — against the shift target</span>
          <span className="font-bold">{measure}</span>
        </div>
        <div className="relative h-12 bg-wall-line rounded-full overflow-hidden">
          <div className={`h-full ${barColor} transition-all duration-700`} style={{ width: `${planPct}%` }} />
          {/* A marca do relógio: onde o turno já vai. É contra ela que a cor da
              barra é decidida, e é por isso que está desenhada — a cor deste
              ecrã não pode sair de um número que não esteja no ecrã. */}
          <div
            className="absolute inset-y-0 w-1 -translate-x-1/2 bg-wall-ink"
            style={{ left: `${elapsedPct}%` }}
            aria-hidden
          />
        </div>
        <div className="mt-2 flex justify-between text-lg text-wall-ink-muted">
          <span>{Math.round(elapsedPct)}% of the shift has passed</span>
          <span>{actual.toLocaleString()} / {target.toLocaleString()}</span>
        </div>
        {/* The screen states its own imprecision rather than leaving it to be
            found out. Both notes are removable the day their cause is fixed. */}
        <div className="mt-3 text-sm text-wall-ink-muted space-y-1">
          <p>Planned stops (deep clean, breaks, no planned shift) count as shift time — the mark sits slightly ahead of the work.</p>
          <p>
            Figures are operator entries, not a live machine count
            {entryAge != null ? ` · last entry ${entryAge} min ago` : " · nothing entered yet"}.
          </p>
        </div>
      </div>

      <div className="bg-wall-panel rounded-2xl p-6 flex-1">
        <h2 className="text-2xl font-bold mb-4">SKUs this shift</h2>
        {!items?.length ? (
          <p className="text-wall-ink-muted text-xl">No SKUs scheduled yet.</p>
        ) : (
          <ul className="space-y-3">
            {items.map((it) => {
              const p = Number(it.planned_qty ?? 0);
              const a = Number(it.actual_qty ?? 0);
              const pc = p > 0 ? Math.min(100, (a / p) * 100) : 0;
              const c = pc >= 95 ? "bg-success" : pc >= 75 ? "bg-warning" : "bg-destructive";
              return (
                <li key={it.id} className="bg-wall-line rounded-xl p-4">
                  <div className="flex justify-between items-center text-lg mb-2 gap-3">
                    <span className="font-semibold flex-1 min-w-0 truncate">
                      {identifyItemSku(toSkuItem(it), catalogue)?.code ?? "—"}{" "}
                      <span className="text-wall-ink-muted font-normal">
                        {identifyItemSku(toSkuItem(it), catalogue)?.name ?? ""}
                      </span>
                    </span>
                    {editingId === it.id ? (
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          inputMode="numeric"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          className="w-24 h-9 bg-wall-panel text-wall-ink"
                          autoFocus
                        />
                        <span className="font-figure">/ {p.toLocaleString()}</span>
                        <Button
                          size="icon"
                          className="h-11 w-11 touch-manipulation bg-success hover:bg-success/90"
                          disabled={saving}
                          onClick={async () => {
                            const v = Math.max(0, Math.floor(Number(editValue) || 0));
                            setSaving(true);
                            const { error } = await supabase
                              .from("production_items")
                              .update({ actual_qty: v })
                              .eq("id", it.id);
                            setSaving(false);
                            if (error) {
                              toast.error(error.message);
                              return;
                            }
                            toast.success("Actual qty updated");
                            setEditingId(null);
                            qc.invalidateQueries({ queryKey: ["prod-items-live", date, line, shift] });
                            qc.invalidateQueries({ queryKey: ["rag-live", date, line, shift] });
                          }}
                        >
                          <Check className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="outline"
                          className="h-11 w-11 touch-manipulation"
                          onClick={() => setEditingId(null)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="font-figure">
                          {a.toLocaleString()} / {p.toLocaleString()}
                        </span>
                        {canRequest && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-11 w-11 touch-manipulation text-wall-ink-muted hover:text-wall-ink"
                            onClick={() => {
                              setEditingId(it.id);
                              setEditValue(String(a));
                            }}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="h-3 bg-wall-line rounded-full overflow-hidden">
                    <div className={`h-full ${c}`} style={{ width: `${pc}%` }} />
                  </div>
                </li>

              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

/**
 * A tile on the line's wall display. Not the same object as a `Figure`: this is read
 * from across the floor at 6xl on black, and it shared the name `Kpi` with two other
 * unrelated components.
 */
function WallTile({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="bg-wall-panel rounded-2xl p-6 text-center">
      <div className="text-wall-ink-muted text-sm tracking-widest mb-2">{label}</div>
      <div className={`text-wall-ink ${mono ? "font-figure" : ""} text-6xl font-black`}>{value}</div>
    </div>
  );
}
