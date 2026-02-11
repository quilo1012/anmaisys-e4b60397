export type ShiftType = "morning" | "afternoon" | "night";

const SHIFT_RANGES: Record<ShiftType, [number, number]> = {
  morning: [6, 14],
  afternoon: [14, 22],
  night: [22, 6],
};

export function getCurrentShift(): ShiftType {
  const hour = new Date().getHours();
  if (hour >= 6 && hour < 14) return "morning";
  if (hour >= 14 && hour < 22) return "afternoon";
  return "night";
}

export function isOnShift(userShift: string | null): boolean {
  if (!userShift) return true; // no shift assigned = always on
  return userShift.toLowerCase() === getCurrentShift();
}

export function playAlertSound() {
  try {
    const ctx = new AudioContext();
    const freqs = [880, 1100, 1320];
    freqs.forEach((freq, i) => {
      const startTime = ctx.currentTime + i * 0.35;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = freq;
      osc.type = "square";
      gain.gain.setValueAtTime(0.5, startTime);
      gain.gain.exponentialRampToValueAtTime(0.01, startTime + 0.3);
      osc.start(startTime);
      osc.stop(startTime + 0.3);
    });
  } catch (e) {
    console.warn("Could not play alert sound", e);
  }
}
