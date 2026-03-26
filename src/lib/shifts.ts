// --- Professional Industrial Alert Sound ---
// Three-tone descending siren: 1200Hz → 900Hz → 600Hz with harmonics

function generateIndustrialSiren(): string {
  const sampleRate = 22050;
  const duration = 1.2;
  const numSamples = Math.floor(sampleRate * duration);
  const dataSize = numSamples * 2;
  const fileSize = 44 + dataSize;

  const buffer = new ArrayBuffer(fileSize);
  const view = new DataView(buffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeString(0, "RIFF");
  view.setUint32(4, fileSize - 8, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, dataSize, true);

  // Three descending tones: urgent industrial feel
  const tones = [
    { freq: 1200, start: 0, end: 0.35 },
    { freq: 900, start: 0.35, end: 0.7 },
    { freq: 600, start: 0.7, end: 1.05 },
  ];

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const fadeIn = Math.min(1, t / 0.01);
    const fadeOut = Math.min(1, (duration - t) / 0.1);

    let sample = 0;
    for (const tone of tones) {
      if (t >= tone.start && t < tone.end) {
        const localT = (t - tone.start) / (tone.end - tone.start);
        const env = Math.sin(localT * Math.PI); // bell curve envelope
        const fundamental = Math.sin(2 * Math.PI * tone.freq * t);
        const harmonic2 = Math.sin(2 * Math.PI * tone.freq * 2 * t) * 0.3;
        const harmonic3 = Math.sin(2 * Math.PI * tone.freq * 3 * t) * 0.1;
        sample += (fundamental + harmonic2 + harmonic3) * env;
      }
    }

    // Tail reverb effect
    if (t >= 1.05) {
      const tailEnv = Math.max(0, 1 - (t - 1.05) / 0.15);
      sample += Math.sin(2 * Math.PI * 600 * t) * tailEnv * 0.3;
    }

    sample *= fadeIn * fadeOut * 0.55;
    view.setInt16(44 + i * 2, Math.floor(Math.max(-1, Math.min(1, sample)) * 32767), true);
  }

  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return "data:audio/wav;base64," + btoa(binary);
}

// Single pleasant notification chime (for operator feedback)
function generateNotificationChime(): string {
  const sampleRate = 16000;
  const duration = 0.4;
  const numSamples = Math.floor(sampleRate * duration);
  const dataSize = numSamples * 2;
  const fileSize = 44 + dataSize;

  const buffer = new ArrayBuffer(fileSize);
  const view = new DataView(buffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeString(0, "RIFF");
  view.setUint32(4, fileSize - 8, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, dataSize, true);

  const freq1 = 523;
  const freq2 = 659;

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const fadeIn = Math.min(1, t / 0.01);
    const fadeOut = Math.min(1, (duration - t) / 0.08);
    const freq = t < duration * 0.45 ? freq1 : freq2;
    const sample = Math.sin(2 * Math.PI * freq * t) * fadeIn * fadeOut * 0.6;
    view.setInt16(44 + i * 2, Math.floor(sample * 32767), true);
  }

  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return "data:audio/wav;base64," + btoa(binary);
}

const ALERT_WAV = generateIndustrialSiren();
const NOTIFICATION_WAV = generateNotificationChime();
let alertAudio: HTMLAudioElement | null = null;
let notifAudio: HTMLAudioElement | null = null;
let warmedUp = false;

function getAlertAudio(): HTMLAudioElement {
  if (!alertAudio) {
    alertAudio = new Audio(ALERT_WAV);
    alertAudio.preload = "auto";
  }
  return alertAudio;
}

function getNotifAudio(): HTMLAudioElement {
  if (!notifAudio) {
    notifAudio = new Audio(NOTIFICATION_WAV);
    notifAudio.preload = "auto";
  }
  return notifAudio;
}

export function warmUpAudio() {
  if (warmedUp) return;
  try {
    const audio = getAlertAudio();
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

let alertIntervalId: ReturnType<typeof setInterval> | null = null;
let alertTimeoutId: ReturnType<typeof setTimeout> | null = null;

export function playAlertSound() {
  console.log("[Alert] playAlertSound called — starting continuous loop");
  stopAlertSound();

  const playLoop = async () => {
    try {
      const audio = getAlertAudio();
      audio.volume = 1.0;
      audio.currentTime = 0;
      await audio.play();
    } catch (e) {
      console.warn("[Alert] Play failed", e);
    }
  };

  playLoop();
  alertIntervalId = setInterval(playLoop, 3000);

  alertTimeoutId = setTimeout(() => {
    console.log("[Alert] 60s timeout — stopping alert");
    stopAlertSound();
  }, 60000);
}

export function stopAlertSound() {
  if (alertIntervalId) {
    clearInterval(alertIntervalId);
    alertIntervalId = null;
  }
  if (alertTimeoutId) {
    clearTimeout(alertTimeoutId);
    alertTimeoutId = null;
  }
  if (alertAudio) {
    alertAudio.pause();
    alertAudio.currentTime = 0;
  }
  console.log("[Alert] Sound stopped");
}

/** Single pleasant chime — no loop */
export function playNotificationChime() {
  try {
    const audio = getNotifAudio();
    audio.volume = 1.0;
    audio.currentTime = 0;
    const p = audio.play();
    if (p) p.catch((e) => console.warn("[Alert] Notification chime failed", e));
    console.log("[Alert] Notification chime played");
  } catch (e) {
    console.warn("[Alert] Notification chime error", e);
  }
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