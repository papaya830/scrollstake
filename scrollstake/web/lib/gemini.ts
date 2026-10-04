import { applyCaptions, type WrappedStory } from "./wrapped";

type Caption = { title?: unknown; detail?: unknown };

const cache = globalThis as typeof globalThis & { __scrollstakeGemini?: Map<string, WrappedStory & { narratedBy: "gemini" }> };
const narrations = (cache.__scrollstakeGemini ??= new Map());

const preferredModels = () => [...new Set([process.env.GEMINI_MODEL, "gemini-3.8-flash", "gemini-flash-latest"].filter((model): model is string => Boolean(model)))];

function geminiUrl(model: string) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
}

function fingerprint(story: WrappedStory) {
  return story.cards.map((card) => `${card.id}:${card.stat}:${card.detail}`).join("|");
}

function keepsMeasuredAmounts(original: string, next: string) {
  const amounts = original.match(/\$\d+(?:\.\d{2})?/g) ?? [];
  return amounts.every((amount) => next.includes(amount));
}

function prompt(story: WrappedStory) {
  return `You write the spoken lines for a Spotify Wrapped recap of one study-focus session.
Keep every number, name, and dollar amount already in the cards. Do not invent people, payments to a friend, or extra stats.
The slashed money stays in a shared hang-out jar. It is not paid to another member.
Tone: short, specific, a little sharp, never cruel. No hashtags. No emojis.
Return JSON only: {"captions":{"cardId":{"title":"short title","detail":"one sentence"}}}
Cards:
${JSON.stringify(story.cards.map((card) => ({ id: card.id, kicker: card.kicker, stat: card.stat, title: card.title, detail: card.detail })))}`;
}

export async function narrateWrapped(story: WrappedStory): Promise<WrappedStory & { narratedBy: "gemini" | "local" }> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) return { ...story, narratedBy: "local" };
  const cached = narrations.get(fingerprint(story));
  if (cached) return cached;
  try {
    let response: Response | undefined;
    for (const model of preferredModels()) {
      response = await fetch(geminiUrl(model), {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        signal: AbortSignal.timeout(12_000),
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt(story) }] }],
          generationConfig: { temperature: 0.7, responseMimeType: "application/json" },
        }),
      });
      if (response.status === 503) {
        await new Promise((resolve) => setTimeout(resolve, 1200));
        response = await fetch(geminiUrl(model), {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": key },
          signal: AbortSignal.timeout(12_000),
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: prompt(story) }] }],
            generationConfig: { temperature: 0.7, responseMimeType: "application/json" },
          }),
        });
      }
      if (response.ok || ![404, 429, 503].includes(response.status)) break;
      console.error("[wrapped] gemini skipped", model, response.status);
    }
    if (!response?.ok) {
      const detail = await response?.text().catch(() => "");
      console.error("[wrapped] gemini", response?.status, detail?.slice(0, 160));
      return { ...story, narratedBy: "local" };
    }
    const body = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const text = body.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
    const parsed = JSON.parse(text) as { captions?: Record<string, Caption> };
    const captions = Object.fromEntries(story.cards.flatMap((card) => {
      const next = parsed.captions?.[card.id];
      if (!next) return [];
      const detail = typeof next.detail === "string" && keepsMeasuredAmounts(card.detail, next.detail) ? next.detail : undefined;
      return [[card.id, { title: next.title, detail }]];
    }));
    const narrated = { focusType: story.focusType, cards: applyCaptions(story.cards, captions), narratedBy: "gemini" as const };
    narrations.set(fingerprint(story), narrated);
    return narrated;
  } catch (error) {
    console.error("[wrapped] gemini failed", error);
    return { ...story, narratedBy: "local" };
  }
}
