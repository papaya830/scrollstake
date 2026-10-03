import { describe, expect, it } from "vitest";
import { classifyNativeAppTitle, classifyOcrText, classifyUnapprovedScreen } from "./screen-policy";

describe("classifyOcrText", () => {
  it("matches x.com as a complete domain, never inside dropbox.com", () => {
    expect(classifyOcrText("dropbox.com project files", [])).toBeNull();
    expect(classifyOcrText("x.com home timeline", [])).toMatchObject({ classification: "disallowed", category: "social", matchedResource: "x.com" });
  });

  it("does not flag ambiguous ordinary-work terms", () => {
    expect(classifyOcrText("signal messages threads steam checkout slack", [])).toBeNull();
  });

  it("identifies exact native Discord and Messages titles", () => {
    expect(classifyNativeAppTitle("Discord File Edit View Window Help")).toMatchObject({ classification: "disallowed", category: "messaging", matchedResource: "discord" });
    expect(classifyNativeAppTitle("Messages File Edit View Window Help")).toMatchObject({ classification: "disallowed", category: "messaging", matchedResource: "messages" });
    expect(classifyNativeAppTitle("Disc0rd File Edit")).toBeNull();
    expect(classifyNativeAppTitle("Message File Edit")).toBeNull();
    expect(classifyOcrText("GitHub issue messages", ["GitHub"])).toMatchObject({ classification: "allowed", matchedResource: "GitHub" });
  });

  it("covers common native distraction apps in a title-bar crop", () => {
    expect(classifyNativeAppTitle("Slack · team-chat")).toMatchObject({ classification: "disallowed", category: "messaging", matchedResource: "slack" });
    expect(classifyNativeAppTitle("Spotify Premium")).toMatchObject({ classification: "disallowed", category: "entertainment", matchedResource: "spotify" });
    expect(classifyNativeAppTitle("Steam")).toMatchObject({ classification: "disallowed", category: "games", matchedResource: "steam" });
  });

  it("still identifies unequivocal distraction sites", () => {
    expect(classifyOcrText("Instagram feed", [])).toMatchObject({ classification: "disallowed", category: "social", matchedResource: "instagram" });
    expect(classifyOcrText("Amazon shopping cart", [])).toMatchObject({ classification: "disallowed", category: "shopping", matchedResource: "amazon" });
    expect(classifyOcrText("TikTok for you", [])).toMatchObject({ classification: "disallowed", category: "social", matchedResource: "tiktok" });
    expect(classifyOcrText("Discord Friends", [])).toMatchObject({ classification: "disallowed", category: "messaging", matchedResource: "discord" });
  });

  it("lets a complete approved resource win over a blocked term", () => {
    expect(classifyOcrText("Amazon data analysis lecture", ["Amazon data analysis lecture"])).toMatchObject({ classification: "allowed", matchedResource: "Amazon data analysis lecture" });
  });

  it("does not allow partial resource identifiers", () => {
    expect(classifyOcrText("mygithubmirror instagram", ["GitHub"])).toMatchObject({ classification: "disallowed", matchedResource: "instagram" });
  });

  it("turns an unrecognized or text-free screen into an allowlist violation", () => {
    expect(classifyOcrText("", ["GitHub"])).toBeNull();
    expect(classifyOcrText("Personal finance dashboard", ["GitHub"])).toBeNull();
    expect(classifyUnapprovedScreen()).toMatchObject({ classification: "disallowed", category: "other", confidence: 0.9, matchedResource: "unapproved_screen" });
  });
});
