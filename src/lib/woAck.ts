// Client-side acknowledgement tracker for WO critical alerts.
// Prevents the "🚨 NEW WORK ORDER" modal from re-firing on remount,
// reconnect, navigation, or page refresh — even before the server-side
// `engineer_notified_acknowledged_at` column propagates back.

const ACK_KEY = "engineer_acknowledged_wos";
const MAX_KEPT = 200;

function read(): string[] {
  try {
    const raw = localStorage.getItem(ACK_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function write(ids: string[]) {
  try {
    // Keep only the most recent N to bound storage size.
    const trimmed = ids.slice(-MAX_KEPT);
    localStorage.setItem(ACK_KEY, JSON.stringify(trimmed));
  } catch {
    /* ignore quota errors */
  }
}

export function isWOAcknowledged(woId: string): boolean {
  return read().includes(woId);
}

export function acknowledgeWOLocal(woId: string): void {
  const ids = read();
  if (ids.includes(woId)) return;
  ids.push(woId);
  write(ids);
}

export function clearAcknowledgedWOLocal(woId: string): void {
  const ids = read().filter((id) => id !== woId);
  write(ids);
}
