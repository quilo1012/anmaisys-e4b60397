import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ScorecardBoardRow } from "@/lib/scorecardWeek";
import { stateLabel } from "@/lib/scorecardWeek";
import { RagChip } from "./RagChip";

type Props = {
  rows: ScorecardBoardRow[];
  isLoading?: boolean;
  onOpen?: (row: ScorecardBoardRow) => void;
};

export function ScorecardWeekBoard({ rows, isLoading, onOpen }: Props) {
  if (isLoading) return <p className="text-sm text-muted-foreground">Loading the week…</p>;

  // Sem atribuicao nao ha quadro, e isso nao e um erro: e uma coisa por configurar.
  if (rows.length === 0) {
    return (
      <div className="rounded border border-dashed p-6 text-sm text-muted-foreground">
        No leader is assigned to a line for this week. Set the assignments first — the
        board is built from them, not from what happens to have been typed in.
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
            <TableHead>Volume</TableHead>
            <TableHead>Quality</TableHead>
            <TableHead>H&amp;S</TableHead>
            <TableHead>Overall</TableHead>
            <TableHead>State</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow
              key={`${r.leader_id}-${r.line_id}`}
              className="cursor-pointer"
              onClick={() => onOpen?.(r)}
            >
              <TableCell className="font-medium">{r.leader_name}</TableCell>
              <TableCell>{r.line_name}</TableCell>
              <TableCell><RagChip value={r.volume_rag} /></TableCell>
              <TableCell><RagChip value={r.quality_rag} /></TableCell>
              <TableCell><RagChip value={r.hs_rag} /></TableCell>
              <TableCell><RagChip value={r.overall_rag} /></TableCell>
              <TableCell className="text-sm text-muted-foreground">{stateLabel(r.state)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
