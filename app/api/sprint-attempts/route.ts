import { NextResponse } from "next/server";
import {
  formatSprintAttemptError,
  mapAttemptRow,
  sprintAttemptSchema,
} from "@/lib/sprint/attempts";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  let attempt;

  try {
    attempt = sprintAttemptSchema.parse(payload);
  } catch (error) {
    return NextResponse.json({ error: formatSprintAttemptError(error) }, { status: 400 });
  }

  const supabase = getSupabaseServerClient();

  if (!supabase) {
    return NextResponse.json(
      { saved: false, reason: "Supabase environment variables are not configured." },
      { status: 202 },
    );
  }

  const { data, error } = await supabase
    .from("sprint_attempts")
    .insert({
      player_name: attempt.playerName,
      score: attempt.score,
      correct_count: attempt.correctCount,
      attempted_count: attempt.attemptedCount,
      duration_seconds: attempt.durationSeconds,
      max_streak: attempt.maxStreak,
      average_ms_per_question: attempt.averageMsPerQuestion,
      mode: "sixty_second_sprint",
      client_metadata: attempt.clientMetadata,
    })
    .select(
      "id, created_at, player_name, score, correct_count, attempted_count, max_streak, average_ms_per_question, accuracy_percent",
    )
    .single();

  if (error) {
    return NextResponse.json({ saved: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ saved: true, attempt: mapAttemptRow(data) }, { status: 201 });
}
