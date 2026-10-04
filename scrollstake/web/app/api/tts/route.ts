import { NextResponse } from "next/server";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

export async function POST(req: Request) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID;
  if (!apiKey || !voiceId) {
    return NextResponse.json({ error: "Text-to-speech is not configured." }, { status: 503 });
  }

  try {
    const { amountDeducted, username } = await req.json() as { amountDeducted?: unknown; username?: unknown };
    const user = typeof username === "string" && username.trim() ? username.trim().slice(0, 80) : "Someone";
    const amount = Number(amountDeducted ?? 0);
    if (!Number.isFinite(amount) || amount < 0) {
      return NextResponse.json({ error: "Invalid penalty amount." }, { status: 400 });
    }
    const amountText = `${amount} dollar${amount === 1 ? "" : "s"}`;
    const text = `[angry] ${user} has been caught doom scrolling. you've lost ${amountText}.`;
    const elevenlabs = new ElevenLabsClient({ apiKey });

    const audio = await elevenlabs.textToSpeech.convert(
      voiceId,
      {
        text,
        modelId: "eleven_v4_turbo",
        outputFormat: "mp3_44100_128",
      }
    );

    return new NextResponse(audio as any, {
      headers: {
        "Content-Type": "audio/mpeg",
      },
    });

  } catch (err) {
    console.error("TTS generation failed", err);
    return NextResponse.json({ error: "Text-to-speech generation failed." }, { status: 502 });
  }
}
