import { NextResponse } from "next/server";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

const elevenlabs = new ElevenLabsClient({
  apiKey: process.env.ELEVENLABS_API_KEY
});

export async function POST(req: Request) {
  try {
    const { amountDeducted, username } = await req.json();
    const user = username?.trim() || "Someone";
    const amount = Number(amountDeducted ?? 0);
    const amountText = `${amount} dollar${amount === 1 ? "" : "s"}`;
    const text = `[angry] ${user} has been caught doom scrolling. you've lost ${amountText}.`;

    const audio = await elevenlabs.textToSpeech.convert(
      "YOq2y2Up4RgXP2HyXjE5",
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

  } catch (err: any) {
    console.error("TTS error:", err?.statusCode, err?.body || err?.message || err);
    return NextResponse.json({ error: "TTS failed", details: err?.message || String(err) }, { status: 500 });
  }
}

