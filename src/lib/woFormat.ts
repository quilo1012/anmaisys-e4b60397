/**
 * Format WO number as WO-YYYY-000XXX
 */
export function formatWONumber(woNumber: number, createdAt: string): string {
  const year = new Date(createdAt).getFullYear();
  return `WO-${year}-${String(woNumber).padStart(6, "0")}`;
}
