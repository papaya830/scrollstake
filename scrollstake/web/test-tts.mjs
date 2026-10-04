import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

const elevenlabs = new ElevenLabsClient({
  apiKey: "sk_1310c58087c885934804c186dd0affc98158c4325bd761bf"
});

async function test() {
  const audio = await elevenlabs.textToSpeech.convert(
    "JBFqnCBsd6RMkjVDRZzb",
    {
      text: "Testing audio output type",
      model_id: "eleven_multilingual_v2",
      output_format: "mp3_44100_128",
    }
  );
  console.log("Audio type:", typeof audio);
  console.log("Is Buffer?", Buffer.isBuffer(audio));
  console.log("Audio constructor:", audio.constructor.name);
}

test().catch(console.error);
