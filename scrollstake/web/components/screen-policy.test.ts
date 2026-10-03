import { describe, expect, it } from "vitest";
import { classifyOcrText } from "./screen-policy";

describe("classifyOcrText", () => {
  it("matches x.com as a complete domain, never inside dropbox.com", () => {
    expect(classifyOcrText("dropbox.com project files", [])).toBeNull();
    expect(classifyOcrText("x.com home timeline", [])).toMatchObject({ classification: "disallowed", category: "social", matchedResource: "x.com" });
  });

  it("does not flag ambiguous ordinary-work terms", () => {
    expect(classifyOcrText("signal messages threads steam checkout slack", [])).toBeNull();
  });

  it("still identifies unequivocal distraction sites", () => {
    expect(classifyOcrText("Instagram feed", [])).toMatchObject({ classification: "disallowed", category: "social", matchedResource: "instagram" });
    expect(classifyOcrText("Amazon shopping cart", [])).toMatchObject({ classification: "disallowed", category: "shopping", matchedResource: "amazon" });
    expect(classifyOcrText("TikTok for you", [])).toMatchObject({ classification: "disallowed", category: "social", matchedResource: "tiktok" });
  });

  it("lets a complete approved resource win over a blocked term", () => {
    expect(classifyOcrText("Amazon data analysis lecture", ["Amazon data analysis lecture"])).toMatchObject({ classification: "allowed", matchedResource: "Amazon data analysis lecture" });
  });

  it("does not allow partial resource identifiers", () => {
    expect(classifyOcrText("mygithubmirror instagram", ["GitHub"])).toMatchObject({ classification: "disallowed", matchedResource: "instagram" });
  });
});
