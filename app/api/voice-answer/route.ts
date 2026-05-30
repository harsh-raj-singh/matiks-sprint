import { NextResponse } from "next/server";
import { getOpenAiApiKey } from "@/lib/openai-key";
import { parseSpokenInteger } from "@/lib/sprint/spoken-number";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_AUDIO_BYTES = 2_500_000;
const OPENAI_AUDIO_TIMEOUT_MS = 12_000;
const TRANSCRIBE_MODEL = process.env.OPENAI_TRANSCRIBE_MODEL?.trim() || "gpt-4o-mini-transcribe";

type TranscriptionResponse = {
  text?: string;
};

export async function POST(request: Request) {
  let form: FormData;

  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid voice upload." }, { status: 400 });
  }

  const audio = form.get("audio");
  if (!(audio instanceof File)) {
    return NextResponse.json({ error: "Missing audio recording." }, { status: 400 });
  }

  if (audio.size <= 0) {
    return NextResponse.json({ error: "Empty audio recording." }, { status: 400 });
  }

  if (audio.size > MAX_AUDIO_BYTES) {
    return NextResponse.json({ error: "Audio recording is too large." }, { status: 413 });
  }

  const apiKey = await getOpenAiApiKey();
  if (!apiKey) {
    return NextResponse.json({ error: "OpenAI API key is not configured." }, { status: 503 });
  }

  const body = new FormData();
  body.append("model", TRANSCRIBE_MODEL);
  body.append("response_format", "json");
  body.append(
    "prompt",
    "This is a fast mental math sprint. The speaker says exactly one integer answer. Prefer digits only, with a leading minus sign when needed.",
  );
  body.append("file", audio, audio.name || "math-sprint-answer.webm");

  let response: Response;

  try {
    response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body,
      signal: AbortSignal.timeout(OPENAI_AUDIO_TIMEOUT_MS),
    });
  } catch {
    return NextResponse.json({ error: "Voice recognition timed out." }, { status: 504 });
  }

  if (!response.ok) {
    return NextResponse.json({ error: "Voice recognition failed." }, { status: 502 });
  }

  let data: TranscriptionResponse;

  try {
    data = (await response.json()) as TranscriptionResponse;
  } catch {
    return NextResponse.json({ error: "Voice recognition returned invalid data." }, { status: 502 });
  }

  const transcript = data.text?.trim() ?? "";
  const value = parseSpokenInteger(transcript);

  return NextResponse.json({
    value,
    transcript,
    model: TRANSCRIBE_MODEL,
  });
}
