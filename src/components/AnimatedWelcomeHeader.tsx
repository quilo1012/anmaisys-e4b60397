import { useEffect, useState } from "react";

/**
 * Futuristic, animated welcome header for the dashboard home.
 * - Title types out letter-by-letter with a blinking cursor.
 * - Greeting/subtitle fade up; the whole block floats gently.
 * - Soft blue/white glow + text-shadow; subtle particle field behind.
 * Respects prefers-reduced-motion (renders fully, no motion).
 */

const TITLE = "Welcome to AN Production System";

// Fixed particle field (deterministic — no hydration jitter).
const PARTICLES = [
  { left: "6%", top: "28%", size: 4, delay: 0.0, dur: 7.5 },
  { left: "14%", top: "70%", size: 3, delay: 1.2, dur: 9 },
  { left: "22%", top: "18%", size: 2, delay: 2.1, dur: 8 },
  { left: "31%", top: "58%", size: 5, delay: 0.6, dur: 10 },
  { left: "40%", top: "34%", size: 2, delay: 1.8, dur: 7 },
  { left: "49%", top: "76%", size: 3, delay: 3.0, dur: 9.5 },
  { left: "58%", top: "22%", size: 4, delay: 0.9, dur: 8.5 },
  { left: "66%", top: "62%", size: 2, delay: 2.4, dur: 7.8 },
  { left: "74%", top: "40%", size: 3, delay: 1.5, dur: 9.2 },
  { left: "82%", top: "72%", size: 5, delay: 0.3, dur: 10.5 },
  { left: "89%", top: "30%", size: 2, delay: 2.7, dur: 8.2 },
  { left: "94%", top: "56%", size: 3, delay: 1.1, dur: 7.6 },
];

function usePrefersReducedMotion(): boolean {
  const [reduce, setReduce] = useState<boolean>(() =>
    typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!mq) return;
    const on = () => setReduce(mq.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return reduce;
}

export function AnimatedWelcomeHeader({ name, dateLabel }: { name: string; dateLabel: string }) {
  const reduce = usePrefersReducedMotion();
  const [typed, setTyped] = useState(reduce ? TITLE.length : 0);
  const [done, setDone] = useState(reduce);

  useEffect(() => {
    if (reduce) {
      setTyped(TITLE.length);
      setDone(true);
      return;
    }
    setTyped(0);
    setDone(false);
    let i = 0;
    const id = window.setInterval(() => {
      i += 1;
      setTyped(i);
      if (i >= TITLE.length) {
        window.clearInterval(id);
        setDone(true);
      }
    }, 55);
    return () => window.clearInterval(id);
  }, [reduce]);

  return (
    <div className="anwh-hero relative overflow-hidden rounded-2xl px-6 py-10 shadow-sm sm:px-10 sm:py-12">
      <style>{CSS}</style>

      {!reduce && (
        <div className="anwh-particles" aria-hidden="true">
          {PARTICLES.map((p, i) => (
            <span
              key={i}
              style={{
                left: p.left,
                top: p.top,
                width: `${p.size}px`,
                height: `${p.size}px`,
                animationDelay: `${p.delay}s`,
                animationDuration: `${p.dur}s`,
              }}
            />
          ))}
        </div>
      )}
      <div className="anwh-grid" aria-hidden="true" />

      <div className={`relative z-10 ${reduce ? "" : "anwh-float"}`}>
        <p className="anwh-hello">
          Hello, <span className="anwh-name">{name}</span>
        </p>

        <h1 className="anwh-title" aria-label={TITLE}>
          <span aria-hidden="true">
            {TITLE.slice(0, typed)}
            <span className={`anwh-cursor ${done ? "anwh-cursor--blink" : ""}`}>|</span>
          </span>
        </h1>

        <p className={`anwh-sub ${done ? "anwh-sub--in" : "anwh-sub--hidden"}`}>
          Production Management Platform<span className="anwh-dot">·</span>{dateLabel}
        </p>
      </div>
    </div>
  );
}

const CSS = `
.anwh-hero {
  color: #fff;
  background:
    radial-gradient(120% 140% at 15% 0%, rgba(59,130,246,0.28) 0%, rgba(11,30,63,0) 55%),
    radial-gradient(120% 140% at 100% 100%, rgba(96,165,250,0.20) 0%, rgba(11,30,63,0) 50%),
    linear-gradient(135deg, #0b1e3f 0%, #12244a 45%, #1e3a8a 100%);
}
.anwh-grid {
  position: absolute; inset: 0;
  background-image:
    linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px);
  background-size: 34px 34px;
  mask-image: radial-gradient(120% 120% at 50% 20%, #000 0%, transparent 75%);
  -webkit-mask-image: radial-gradient(120% 120% at 50% 20%, #000 0%, transparent 75%);
}
.anwh-particles { position: absolute; inset: 0; overflow: hidden; }
.anwh-particles span {
  position: absolute; border-radius: 9999px;
  background: radial-gradient(circle, rgba(191,219,254,0.95) 0%, rgba(96,165,250,0) 70%);
  animation-name: anwhParticle; animation-timing-function: ease-in-out; animation-iteration-count: infinite;
  opacity: 0.4;
}
.anwh-float { animation: anwhFloat 6s ease-in-out infinite; }
.anwh-hello {
  font-size: 0.95rem; color: rgba(226,232,240,0.85); margin-bottom: 0.25rem;
  animation: anwhFadeUp 0.6s ease both; animation-delay: 0.1s;
}
.anwh-name { color: #fff; font-weight: 600; text-shadow: 0 0 10px rgba(96,165,250,0.5); }
.anwh-title {
  font-weight: 800; letter-spacing: -0.02em; line-height: 1.1;
  font-size: clamp(1.65rem, 4.5vw, 2.5rem);
  animation: anwhFadeUp 0.6s ease both, anwhGlow 3.2s ease-in-out 0.8s infinite;
  text-shadow: 0 0 12px rgba(96,165,250,0.55), 0 0 2px rgba(255,255,255,0.5);
}
.anwh-cursor { color: #60a5fa; font-weight: 400; margin-left: 1px; }
.anwh-cursor--blink { animation: anwhBlink 1s step-end infinite; }
.anwh-sub {
  margin-top: 0.5rem; font-size: 0.9rem; color: rgba(191,219,254,0.85);
  transition: opacity 0.6s ease, transform 0.6s ease;
}
.anwh-sub--hidden { opacity: 0; transform: translateY(6px); }
.anwh-sub--in { opacity: 1; transform: none; }
.anwh-dot { margin: 0 0.4rem; color: rgba(191,219,254,0.5); }

@keyframes anwhFadeUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
@keyframes anwhFloat { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
@keyframes anwhBlink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }
@keyframes anwhGlow {
  0%, 100% { text-shadow: 0 0 10px rgba(96,165,250,0.45), 0 0 2px rgba(255,255,255,0.4); }
  50% { text-shadow: 0 0 18px rgba(96,165,250,0.8), 0 0 5px rgba(255,255,255,0.6); }
}
@keyframes anwhParticle {
  0% { transform: translateY(6px); opacity: 0; }
  25% { opacity: 0.6; }
  100% { transform: translateY(-46px); opacity: 0; }
}
@media (prefers-reduced-motion: reduce) {
  .anwh-float, .anwh-hello, .anwh-title, .anwh-particles span { animation: none !important; }
  .anwh-sub { opacity: 1 !important; transform: none !important; }
}
`;
