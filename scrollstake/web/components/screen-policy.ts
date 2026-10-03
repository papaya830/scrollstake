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
  { category: "social", terms: ["instagram", "tiktok", "twitter", "x.com", "facebook", "snapchat", "reddit", "pinterest"] },
  { category: "shopping", terms: ["amazon", "shein", "aliexpress", "temu", "ebay", "etsy", "shopify", "shopping cart"] },
  { category: "messaging", terms: ["imessage", "whatsapp", "messenger", "discord", "telegram"] },
  { category: "entertainment", terms: ["netflix", "twitch", "hulu", "disney+", "prime video", "youtube", "spotify"] },
  { category: "games", terms: ["roblox", "fortnite", "miniclip", "epic games", "league of legends"] },
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

export function isDetectionResult(value: unknown): value is DetectionResult {
  if (!value || typeof value !== "object") return false;
  const result = value as Partial<DetectionResult>;
  return ["allowed", "disallowed", "uncertain"].includes(String(result.classification))
    && typeof result.reason === "string"
    && typeof result.confidence === "number"
    && result.confidence >= 0
    && result.confidence <= 1;
}
