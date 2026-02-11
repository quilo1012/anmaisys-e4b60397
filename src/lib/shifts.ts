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

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!audioCtx) {
    audioCtx = new AudioContext();
  }
  return audioCtx;
}

export function warmUpAudio() {
  const ctx = getAudioContext();
  if (ctx.state === "suspended") {
    ctx.resume().catch(() => {});
  }
}

export async function playAlertSound() {
  try {
    const ctx = getAudioContext();
    if (ctx.state === "suspended") {
      await ctx.resume();
    }

    const pattern = [880, 1100, 1320];
    // Play the pattern twice for emphasis
    for (let round = 0; round < 2; round++) {
      pattern.forEach((freq, i) => {
        const startTime = ctx.currentTime + round * 1.2 + i * 0.35;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = freq;
        osc.type = "square";
        gain.gain.setValueAtTime(0.7, startTime);
        gain.gain.exponentialRampToValueAtTime(0.01, startTime + 0.3);
        osc.start(startTime);
        osc.stop(startTime + 0.3);
      });
    }
    console.log("[Alert] Sound played successfully");
  } catch (e) {
    console.warn("[Alert] Could not play alert sound", e);
  }
}
