/**
 * Helpers for /preview. The text builders are pure so /api/tts can build the same line
 * server-side; the only network request is playPreviewAlert's call to /api/tts.
 */

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

export const PREVIEW_PENALTY_USDC = 0.5;
export const PREVIEW_ROAST_COUNT = ROASTS.length;
export const randomRoastLine = () => Math.floor(Math.random() * ROASTS.length);
const LOCK_IN = "Now lock in!";

function roastParts(name: string, penaltyUsdc: number, line: number) {
  const who = name.trim().slice(0, 30) || "you";
  const index = Number.isInteger(line) && line >= 0 && line < ROASTS.length ? line : 0;
  return { lead: `This is a test, but ${who} would've just lost ${formatPenalty(penaltyUsdc)}.`, roast: ROASTS[index] };
}

/** The roast as shown on screen (and spoken by the browser-voice fallback). */
export function buildPreviewRoast(name: string, penaltyUsdc = 0.5, line = randomRoastLine()): string {
  const { lead, roast } = roastParts(name, penaltyUsdc, line);
  return `${lead} ${roast} ${LOCK_IN}`;
}

/** Same words with ElevenLabs audio tags, so the voice is angry and shouts the last line. */
export function buildPreviewTtsText(name: string, penaltyUsdc = 0.5, line = 0): string {
  const { lead, roast } = roastParts(name, penaltyUsdc, line);
  return `[angry] ${lead} ${roast} [shouting] ${LOCK_IN}`;
}

const speech = () => (typeof window !== "undefined" && "speechSynthesis" in window ? window.speechSynthesis : null);
let audio: AudioContext | null = null;
let player: HTMLAudioElement | null = null;
// 44-byte silent WAV: playing it inside a click "blesses" the element for later playback.
const TTS_TIMEOUT_MS = 4000;
const SILENT_WAV ="data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";

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
    player ??= new Audio();
    player.src = SILENT_WAV;
    void player.play().catch(() => undefined);
  } catch { /* falls back to speech */ }
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

export type SpeechResult = "elevenlabs" | "spoken" | "unavailable";

/** Stops whichever voice is playing (used by "Try again"). */
export function stopPreviewAlert(): void {
  player?.pause();
  speech()?.cancel();
}

/**
 * Plays the ElevenLabs preview shout from /api/tts (no session or wallet involved).
 * Falls back to the browser voice when TTS is unconfigured, fails, or playback is blocked.
 */
export async function playPreviewAlert(name: string, penaltyUsdc: number, line: number): Promise<SpeechResult> {
  let url: string | undefined;
  // A roast that arrives after the moment has passed is worse than the browser voice.
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), TTS_TIMEOUT_MS);
  try {
    const response = await fetch("/api/tts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ preview: true, username: name, amountDeducted: penaltyUsdc, line }),
      signal: timeout.signal,
    });
    if (!response.ok) throw new Error(`tts ${response.status}`);
    url = URL.createObjectURL(await response.blob());
    clearTimeout(timer);
    player ??= new Audio();
    player.src = url;
    await player.play();
    const done = url;
    player.addEventListener("ended", () => URL.revokeObjectURL(done), { once: true });
    return "elevenlabs";
  } catch {
    clearTimeout(timer);
    if (url) URL.revokeObjectURL(url);
    return speakRoast(buildPreviewRoast(name, penaltyUsdc, line));
  }
}

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
