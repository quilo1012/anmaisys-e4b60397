/**
 * Which block an area is drawn in.
 *
 * `section` decides, and it is not the same question as `kind`. Hygiene, Quality and
 * Runner are support in the totals and sit in the production block on the board,
 * because that is where the factory's own sheet puts them — the people planning the
 * day read them alongside the lines they serve.
 *
 * The fallback matters more than it looks. The board used to filter on `section`
 * alone against a fixed list of four, so an area whose section was renamed, misspelt
 * or left blank vanished from the board entirely while its allocations carried on
 * being saved. Anything unrecognised now lands in the block its `kind` implies,
 * which is wrong at worst and invisible never.
 *
 * It lives here rather than in the page because the test kept its own copy of it,
 * under a comment saying "mirrors blockOf in ProductionHeadcountPage" — and the copy
 * had drifted: it knew two blocks where the board draws three. It passed either way,
 * because the only function it ever called was its own.
 */
export const HEADCOUNT_BLOCKS = ["production", "sectors", "support"] as const;

export type HeadcountBlock = (typeof HEADCOUNT_BLOCKS)[number];

export function blockOf(area: { section: string | null; kind: string }): HeadcountBlock {
  const s = (area.section ?? "").toLowerCase();
  if (s === "production" || s === "sectors" || s === "support") return s;
  return area.kind === "production" ? "production" : "support";
}

/**
 * As duas bandas da planilha da empresa, a partir das três do board.
 *
 * Vivia dentro de `headcountSheet.ts`, onde servia o export, o papel e o import. O
 * board passou a desenhar nas duas bandas da planilha em vez das suas três, e a regra
 * ficou com dois leitores em ficheiros diferentes — que é como uma regra se torna
 * duas e as duas divergem.
 *
 * Os sectores — Hygiene, Quality, Maintenance, o armazém — caem no apoio, que é onde a
 * folha de Outubro os tem. O Runner fica na produção por ter `section = production`,
 * que é também onde a folha o tem.
 *
 * `kind` continua a ser a outra pergunta, e a resposta a essa não mudou: é ele que
 * decide o que as contagens contam.
 */
export const SHEET_BANDS = ["production", "support"] as const;

export type SheetBand = (typeof SHEET_BANDS)[number];

/**
 * Áreas que se desenham na banda de produção seja qual for a secção gravada.
 *
 * O Lab, o Blender Room e o Office fazem parte de correr as linhas — é assim que a
 * fábrica os lê, e o board já os teve aí. A coluna `section` já os levou para
 * produção (`20260807160000`) e voltou a trazê-los para os sectores: escreve-a SQL
 * directo, não a app — o board só grava `sort_order` — e um quadro que muda de forma
 * a cada escrita deixa de ser a mesma folha duas manhãs seguidas. A regra mora aqui,
 * onde o board, o export e o papel a lêem todos, e não numa coluna que se reescreve.
 *
 * Só a banda muda. `kind` continua a decidir o que as contagens contam, por isso
 * "On lines" e "Support" não se mexem.
 */
export const PRODUCTION_BAND_AREAS = ["lab", "blender room", "office"] as const;

export function sheetBandOf(
  area: { name?: string; section: string | null; kind: string },
): SheetBand {
  const name = (area.name ?? "").trim().toLowerCase();
  if ((PRODUCTION_BAND_AREAS as readonly string[]).includes(name)) return "production";
  return blockOf(area) === "production" ? "production" : "support";
}

/**
 * No board, o sítio do Lab na banda de produção é da coluna Overtime (pedido de 23/11/2026).
 *
 * A coluna Overtime estava no fim da segunda banda, quase sempre fora do ecrã, e quem trata
 * das horas extra tinha de a ir buscar lá ao fundo. Passa a ser desenhada onde o Lab estava,
 * e o Lab desce para o apoio, no fim das áreas — onde o Overtime estava. Ninguém sai do
 * board: o Lab leva quatro a seis pessoas por dia e continua à vista.
 *
 * Só o board muda. A folha (export, papel e import) continua com `sheetBandOf`, e o Lab
 * continua na banda de produção dela, no mesmo sítio. É por isso que o `sort_order` do Lab
 * se conta sempre na banda de produção: arrastar colunas no apoio não lhe mexe
 * (`boardReorderBand`), e é esse número que diz onde a coluna Overtime fica.
 */
export const OVERTIME_SLOT_AREA = "lab";

export function isOvertimeSlotArea(area: { name?: string }): boolean {
  return (area.name ?? "").trim().toLowerCase() === OVERTIME_SLOT_AREA;
}

/** A banda em que o board desenha a área: a da folha, menos o Lab, que vai para o apoio. */
export function boardBandOf(
  area: { name?: string; section: string | null; kind: string },
): SheetBand {
  return isOvertimeSlotArea(area) ? "support" : sheetBandOf(area);
}

/**
 * As áreas cujo `sort_order` se renumera quando se arrasta uma coluna nesta banda do board.
 *
 * Na produção entra o Lab, que lá não é desenhado: ocupa o lugar da coluna Overtime, e
 * mudar uma linha de sítio mantém-no entre as mesmas vizinhas — na folha e no board. No
 * apoio fica de fora: um número de apoio pô-lo-ia, na folha, no meio das linhas.
 */
export function boardReorderBand<A extends { name: string; section: string | null; kind: string }>(
  areas: readonly A[],
  band: SheetBand,
): A[] {
  return band === "production"
    ? areas.filter((a) => sheetBandOf(a) === "production")
    : areas.filter((a) => boardBandOf(a) === "support" && !isOvertimeSlotArea(a));
}

/**
 * Antes de que coluna desenhada da banda de produção entra a coluna Overtime.
 *
 * No sítio onde o Lab ficaria pela ordem gravada (`sort_order`, depois o nome, como o board
 * ordena). Sem Lab na banda de produção da folha — renomeado, desactivado, ou tirado de
 * `PRODUCTION_BAND_AREAS` — vai para o fim da banda, à vista na mesma.
 */
export function overtimeSlot(
  drawn: readonly { name: string; sort_order: number }[],
  areas: readonly { name: string; section: string | null; kind: string; sort_order: number }[],
): number {
  const lab = areas.find((a) => isOvertimeSlotArea(a) && sheetBandOf(a) === "production");
  if (!lab) return drawn.length;
  const at = drawn.findIndex(
    (a) => a.sort_order > lab.sort_order || (a.sort_order === lab.sort_order && a.name.localeCompare(lab.name) > 0),
  );
  return at < 0 ? drawn.length : at;
}

/**
 * Uma área chamada "Training".
 *
 * A folha da empresa tem Training como uma coluna ao lado das linhas, e alguém criou
 * uma área com esse nome para o import ter onde a pôr. O board já tinha a sua coluna
 * Training — o estado `training`, ao fim da segunda banda — e passou a desenhar duas,
 * uma vazia e outra cheia, conforme o caminho por onde a pessoa lá chegou. A área é
 * ainda `kind = production`, por isso quem estava nela contava em "On lines".
 */
export function isTrainingArea(area: { name: string }): boolean {
  return area.name.trim().toLowerCase() === "training";
}

/**
 * As linhas gravadas na área Training, lidas como o estado `training`.
 *
 * Só a leitura muda: a linha fica gravada como está, e arrastar a pessoa para outro
 * sítio escreve por cima, como sempre. Overtime continua overtime — é a maneira como o
 * dia conta, não o sítio — e cai na coluna Overtime.
 */
export function foldTrainingArea<T extends { area_id: string | null; status: string }>(
  allocations: readonly T[],
  areas: readonly { id: string; name: string }[],
): T[] {
  const ids = new Set(areas.filter(isTrainingArea).map((a) => a.id));
  if (ids.size === 0) return allocations as T[];
  return allocations.map((a) =>
    a.area_id && ids.has(a.area_id)
      ? ({ ...a, area_id: null, status: a.status === "overtime" ? "overtime" : "training" } as T)
      : a,
  );
}
