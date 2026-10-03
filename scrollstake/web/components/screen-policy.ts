export type ScreenCategory = "study" | "social" | "shopping" | "messaging" | "entertainment" | "games" | "other";
export type Classification = "allowed" | "disallowed" | "uncertain";

export type DetectionResult = {
  classification: Classification;
  category: ScreenCategory;
  confidence: number;
  matchedResource?: string;
  reason: string;
};

const BLOCKED: Array<{ category: ScreenCategory; terms: string[] }> = [
  { category: "social", terms: ["instagram", "tiktok", "twitter", "x.com", "facebook", "snapchat", "reddit", "pinterest", "tumblr", "linkedin feed"] },
  { category: "shopping", terms: ["amazon", "shein", "aliexpress", "temu", "ebay", "etsy", "shopify", "shopping cart", "walmart", "best buy"] },
  { category: "messaging", terms: ["imessage", "whatsapp", "messenger", "discord", "telegram"] },
  { category: "entertainment", terms: ["netflix", "twitch", "hulu", "disney+", "prime video", "youtube", "spotify", "crunchyroll"] },
  { category: "games", terms: ["roblox", "fortnite", "miniclip", "epic games", "league of legends", "minecraft", "valorant"] },
];

export const DEFAULT_APPROVED_RESOURCES = [
  "scrollstake",
  "localhost",
  "Visual Studio Code",
  "GitHub",
  "canvas.ubc.ca",
  "docs.google.com",
  "notion.so",
];

const NATIVE_APP_TITLES: Array<{ title: string; category: ScreenCategory }> = [
  { title: "discord", category: "messaging" },
  { title: "messages", category: "messaging" },
  { title: "slack", category: "messaging" },
  { title: "whatsapp", category: "messaging" },
  { title: "telegram", category: "messaging" },
  { title: "spotify", category: "entertainment" },
  { title: "steam", category: "games" },
];

function normalize(value: string): string {
  return value.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/[^a-z0-9.+\s/-]/g, " ").replace(/\s+/g, " ").trim();
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Matches the complete configured phrase, never a substring inside another identifier/domain. */
function containsWholePhrase(haystack: string, phrase: string): boolean {
  const needle = normalize(phrase);
  if (needle.length < 3) return false;
  return new RegExp(`(^|[^a-z0-9])${escapeRegex(needle)}(?=$|[^a-z0-9])`, "i").test(haystack);
}

export function classifyOcrText(text: string, allowedResources: string[]): DetectionResult | null {
  const haystack = normalize(text);
  if (!haystack) return null;

  for (const resource of allowedResources) {
    if (containsWholePhrase(haystack, resource)) {
      return {
        classification: "allowed",
        category: "study",
        confidence: 0.98,
        matchedResource: resource,
        reason: `Approved resource detected: ${resource}`,
      };
    }
  }

  for (const group of BLOCKED) {
    const matched = group.terms.find((term) => containsWholePhrase(haystack, term));
    if (matched) {
      return {
        classification: "disallowed",
        category: group.category,
        confidence: 0.97,
        matchedResource: matched,
        reason: `${group.category[0].toUpperCase()}${group.category.slice(1)} activity detected: ${matched}`,
      };
    }
  }

  return null;
}

/**
 * The title-bar crop is reserved for native app names. Keep this separate from
 * normal page OCR so ordinary study text containing "messages" cannot trigger.
 */
export function classifyNativeAppTitle(text: string): DetectionResult | null {
  const haystack = normalize(text);
  if (!haystack) return null;
  const nativeApp = NATIVE_APP_TITLES.find((app) => containsWholePhrase(haystack, app.title));
  if (!nativeApp) return null;
  const label = nativeApp.title[0].toUpperCase() + nativeApp.title.slice(1);
  return {
    classification: "disallowed",
    category: nativeApp.category,
    confidence: 0.97,
    matchedResource: nativeApp.title,
    reason: `Native app detected: ${label}`,
  };
}

/** Used only after both the full frame and its title bar fail to identify an approved resource. */
export function classifyUnapprovedScreen(): DetectionResult {
  return {
    classification: "disallowed",
    category: "other",
    confidence: 0.9,
    matchedResource: "unapproved_screen",
    reason: "Unapproved screen detected. Return to an approved study resource.",
  };
}

export function isDetectionResult(value: unknown): value is DetectionResult {
  if (!value || typeof value !== "object") return false;
  const result = value as Partial<DetectionResult>;
  return ["allowed", "disallowed", "uncertain"].includes(String(result.classification))
    && typeof result.reason === "string"
    && typeof result.confidence === "number"
    && result.confidence >= 0
    && result.confidence <= 1;
}
