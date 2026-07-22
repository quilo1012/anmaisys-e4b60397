/**
 * Synthesized MSN-Messenger-style "new message" chime (no audio asset needed).
 * A short bright arpeggio reminiscent of the classic notification.
 */
export function playMsnSound() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const now = ctx.currentTime;

    // Bright, quick 4-note figure (E5, B5, E6, and a soft settle on A5).
    const notes: Array<{ f: number; t: number; d: number; g: number }> = [
      { f: 659.25, t: 0.0, d: 0.12, g: 0.16 },
      { f: 987.77, t: 0.09, d: 0.12, g: 0.16 },
      { f: 1318.51, t: 0.18, d: 0.16, g: 0.18 },
      { f: 880.0, t: 0.3, d: 0.22, g: 0.12 },
    ];

    for (const n of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.value = n.f;
      const start = now + n.t;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(n.g, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + n.d);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + n.d + 0.02);
    }

    setTimeout(() => ctx.close().catch(() => {}), 1200);
  } catch {
    /* audio not available */
  }
}
