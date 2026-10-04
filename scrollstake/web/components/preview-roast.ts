/** Client-only helpers for /preview. Nothing here makes a network request. */

const ROASTS = [
  "Your phone is not a study resource, no matter how educational that reel claimed to be.",
  "Sixty seconds of scrolling. Your future self just filed a complaint.",
  "That notification was not worth it. It never is.",
  "The group hangout fund thanks you for your generous donation.",
  "Bold strategy, studying by osmosis through your phone screen.",
];

export function formatPenalty(usdc: number): string {
  const cents = Math.round(usdc * 100);
  if (cents < 100) return `${cents} cents`;
  if (cents % 100 === 0) return cents === 100 ? "1 dollar" : `${cents / 100} dollars`;
  return `$${(cents / 100).toFixed(2)}`;
}

export function buildPreviewRoast(name: string, penaltyUsdc = 0.5, pick = Math.random()): string {
  const who = name.trim() || "you";
  const line = ROASTS[Math.min(ROASTS.length - 1, Math.floor(pick * ROASTS.length))];
  return `This is a test, but ${who} would've just lost ${formatPenalty(penaltyUsdc)}. ${line}`;
}

const speech = () => (typeof window !== "undefined" && "speechSynthesis" in window ? window.speechSynthesis : null);
let audio: AudioContext | null = null;

/**
 * Call from a click handler. Browsers only allow audio after a user gesture, and a
 * webcam catch happens later outside one, so prime both speech and Web Audio now.
 */
export function unlockAudio(): void {
  const synth = speech();
  if (synth) {
    const primer = new SpeechSynthesisUtterance(" ");
    primer.volume = 0;
    synth.speak(primer);
  }
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (Ctx) {
      audio ??= new Ctx();
      void audio.resume();
    }
  } catch { /* the hit sound is optional */ }
}

/** Short descending "lost money" tone. Silently does nothing if audio was never unlocked. */
export function playHit(): void {
  if (!audio || audio.state !== "running") return;
  const osc = audio.createOscillator(), gain = audio.createGain(), t = audio.currentTime;
  osc.type = "square";
  osc.frequency.setValueAtTime(440, t);
  osc.frequency.exponentialRampToValueAtTime(110, t + 0.35);
  gain.gain.setValueAtTime(0.08, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
  osc.connect(gain).connect(audio.destination);
  osc.start(t);
  osc.stop(t + 0.4);
}

/** Voices often load after first paint (Chrome fires voiceschanged later). Wait briefly, then use the default. */
function voicesReady(synth: SpeechSynthesis, timeoutMs = 1500): Promise<SpeechSynthesisVoice[]> {
  const now = synth.getVoices();
  if (now.length) return Promise.resolve(now);
  return new Promise((resolve) => {
    const done = () => { synth.removeEventListener("voiceschanged", done); clearTimeout(timer); resolve(synth.getVoices()); };
    const timer = setTimeout(done, timeoutMs);
    synth.addEventListener("voiceschanged", done);
  });
}

export type SpeechResult = "spoken" | "unavailable";

/** Speaks the roast. Resolves "unavailable" when the browser has no speech support or speaking fails. */
export async function speakRoast(text: string): Promise<SpeechResult> {
  const synth = speech();
  if (!synth) return "unavailable";
  const voices = await voicesReady(synth);
  const voice = voices.find((v) => v.default && v.lang.startsWith("en")) ?? voices.find((v) => v.lang.startsWith("en"));
  return new Promise((resolve) => {
    const utterance = new SpeechSynthesisUtterance(text);
    if (voice) utterance.voice = voice;
    utterance.rate = 1.05;
    utterance.onstart = () => resolve("spoken");
    utterance.onerror = () => resolve("unavailable");
    // Some engines (no voices installed, blocked autoplay) never fire onstart.
    setTimeout(() => resolve(synth.speaking ? "spoken" : "unavailable"), 4000);
    synth.cancel();
    synth.speak(utterance);
  });
}
