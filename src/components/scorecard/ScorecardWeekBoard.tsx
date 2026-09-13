import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ScorecardBoardRow } from "@/lib/scorecardWeek";
import { scoreCell, stateLabel } from "@/lib/scorecardWeek";
import { RagChip } from "./RagChip";

type Props = {
  rows: ScorecardBoardRow[];
  isLoading?: boolean;
  onOpen?: (row: ScorecardBoardRow) => void;
};

export function ScorecardWeekBoard({ rows, isLoading, onOpen }: Props) {
  if (isLoading) return <p className="text-sm text-muted-foreground">Loading the week…</p>;

  // Um board vazio nao e um erro: e uma semana em que ninguem abriu uma linha. O texto
  // mudou com a fonte — ja nao ha atribuicoes para configurar, ha turnos por registar.
  if (rows.length === 0) {
    return (
      <div className="rounded border border-dashed p-6 text-sm text-muted-foreground">
        No line was opened in this week. The board is built from the shifts recorded in
        production — who opened which line, on which day — so it stays empty until
        somebody has been on a line.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Leader</TableHead>
            <TableHead>Line</TableHead>
            <TableHead>Shifts</TableHead>
            <TableHead>Volume</TableHead>
            <TableHead>Quality</TableHead>
            <TableHead>H&amp;S</TableHead>
            <TableHead>Overall</TableHead>
            <TableHead>Score</TableHead>
            <TableHead>State</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const { text, capped, capReason } = scoreCell(r);
            const capTitle = capReason ?? "A ceiling was applied to this score.";
            return (
              <TableRow
                key={`${r.leader_id}-${r.line_id}`}
                className="cursor-pointer"
                onClick={() => onOpen?.(r)}
              >
                <TableCell className="font-medium">{r.leader_name}</TableCell>
                <TableCell>{r.line_name}</TableCell>
                <TableCell className="tabular-nums text-sm text-muted-foreground">
                  {r.shifts_led}
                </TableCell>
                <TableCell><RagChip value={r.volume_rag} /></TableCell>
                <TableCell><RagChip value={r.quality_rag} /></TableCell>
                <TableCell><RagChip value={r.hs_rag} /></TableCell>
                <TableCell><RagChip value={r.overall_rag} /></TableCell>
                <TableCell>
                  <span className="font-medium">{text}</span>
                  {capped && (
                    <span
                      title={capTitle}
                      aria-label={capTitle}
                      className="ml-2 inline-block rounded bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive"
                    >
                      Capped
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">{stateLabel(r.state)}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
