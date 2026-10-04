import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  convert: vi.fn(),
  client: vi.fn(),
}));

vi.mock("@elevenlabs/elevenlabs-js", () => ({
  ElevenLabsClient: mocks.client,
}));

import { POST } from "./route";

const request = (body: unknown) => new Request("http://localhost/api/tts", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

describe("POST /api/tts", () => {
  const originalKey = process.env.ELEVENLABS_API_KEY;
  const originalVoice = process.env.ELEVENLABS_VOICE_ID;

  beforeEach(() => {
    mocks.convert.mockReset();
    mocks.client.mockReset();
    mocks.client.mockImplementation(() => ({ textToSpeech: { convert: mocks.convert } }));
    delete process.env.ELEVENLABS_API_KEY;
    delete process.env.ELEVENLABS_VOICE_ID;
  });

  it("reports unconfigured text-to-speech without calling ElevenLabs", async () => {
    const response = await POST(request({ amountDeducted: 1, username: "Alex" }));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "Text-to-speech is not configured." });
    expect(mocks.client).not.toHaveBeenCalled();
  });

  it("streams provider audio using only server environment configuration", async () => {
    process.env.ELEVENLABS_API_KEY = "test-key";
    process.env.ELEVENLABS_VOICE_ID = "test-voice";
    mocks.convert.mockResolvedValue(new Uint8Array([1, 2, 3]));

    const response = await POST(request({ amountDeducted: 1, username: "Alex" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("audio/mpeg");
    expect(mocks.client).toHaveBeenCalledWith({ apiKey: "test-key" });
    expect(mocks.convert).toHaveBeenCalledWith("test-voice", expect.objectContaining({ text: expect.stringContaining("Alex") }));
  });

  it("returns a generic provider failure", async () => {
    process.env.ELEVENLABS_API_KEY = "test-key";
    process.env.ELEVENLABS_VOICE_ID = "test-voice";
    mocks.convert.mockRejectedValue(new Error("provider-only detail"));

    const response = await POST(request({ amountDeducted: 1 }));
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: "Text-to-speech generation failed." });
  });

  it("rejects invalid penalties before calling the provider", async () => {
    process.env.ELEVENLABS_API_KEY = "test-key";
    process.env.ELEVENLABS_VOICE_ID = "test-voice";
    const response = await POST(request({ amountDeducted: -1 }));
    expect(response.status).toBe(400);
    expect(mocks.convert).not.toHaveBeenCalled();
  });

  afterAll(() => {
    if (originalKey === undefined) delete process.env.ELEVENLABS_API_KEY;
    else process.env.ELEVENLABS_API_KEY = originalKey;
    if (originalVoice === undefined) delete process.env.ELEVENLABS_VOICE_ID;
    else process.env.ELEVENLABS_VOICE_ID = originalVoice;
  });
});
