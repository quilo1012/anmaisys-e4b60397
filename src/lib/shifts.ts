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
  if (!userShift) return true;
  return userShift.toLowerCase() === getCurrentShift();
}

// --- HTML5 Audio-based alert sound ---

// Generate a simple beep WAV as base64 data URI
function generateBeepWav(): string {
  const sampleRate = 8000;
  const duration = 0.3;
  const freq = 1000;
  const numSamples = Math.floor(sampleRate * duration);
  const dataSize = numSamples * 2;
  const fileSize = 44 + dataSize;

  const buffer = new ArrayBuffer(fileSize);
  const view = new DataView(buffer);

  // WAV header
  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeString(0, "RIFF");
  view.setUint32(4, fileSize - 8, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, dataSize, true);

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const envelope = Math.min(1, Math.min(t / 0.01, (duration - t) / 0.01));
    const sample = Math.sin(2 * Math.PI * freq * t) * envelope * 0.9;
    view.setInt16(44 + i * 2, Math.floor(sample * 32767), true);
  }

  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return "data:audio/wav;base64," + btoa(binary);
}

const BEEP_WAV = generateBeepWav();
let audioElement: HTMLAudioElement | null = null;
let warmedUp = false;

function getAudioElement(): HTMLAudioElement {
  if (!audioElement) {
    audioElement = new Audio(BEEP_WAV);
    audioElement.preload = "auto";
  }
  return audioElement;
}

export function warmUpAudio() {
  if (warmedUp) return;
  try {
    const audio = getAudioElement();
    audio.volume = 0;
    audio.currentTime = 0;
    const p = audio.play();
    if (p) p.then(() => { audio.pause(); audio.currentTime = 0; }).catch(() => {});
    warmedUp = true;
    console.log("[Alert] Audio warmed up on user gesture");
  } catch (e) {
    console.warn("[Alert] Warmup failed", e);
  }
}

export async function playAlertSound() {
  console.log("[Alert] playAlertSound called");
  // Play beep 3 times with gaps
  for (let i = 0; i < 3; i++) {
    await playBeepOnce();
    if (i < 2) await sleep(400);
  }
}

function playBeepOnce(): Promise<void> {
  return new Promise((resolve) => {
    try {
      const audio = getAudioElement();
      audio.volume = 1.0;
      audio.currentTime = 0;
      const p = audio.play();
      if (p) {
        p.then(() => {
          audio.addEventListener("ended", () => resolve(), { once: true });
        }).catch((e) => {
          console.warn("[Alert] Beep play failed", e);
          resolve();
        });
      } else {
        setTimeout(resolve, 350);
      }
    } catch (e) {
      console.warn("[Alert] Beep error", e);
      resolve();
    }
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// --- Web Notifications API ---

export async function requestNotificationPermission() {
  if (!("Notification" in window)) {
    console.warn("[Notify] Browser does not support Notifications API");
    return;
  }
  if (Notification.permission === "granted" || Notification.permission === "denied") {
    console.log("[Notify] Permission already:", Notification.permission);
    return;
  }
  try {
    const result = await Notification.requestPermission();
    console.log("[Notify] Permission result:", result);
  } catch (e) {
    console.warn("[Notify] Permission request failed", e);
  }
}

export function sendWebNotification(title: string, body: string) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  try {
    new Notification(title, { body, icon: "/favicon.ico" });
    console.log("[Notify] Notification sent:", title);
  } catch (e) {
    console.warn("[Notify] Failed to send notification", e);
  }
}
