import { NextResponse } from "next/server";
import { mapAttemptRow } from "@/lib/sprint/attempts";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = getSupabaseServerClient();

  if (!supabase) {
    return NextResponse.json({ entries: [], configured: false });
  }

  const { data, error } = await supabase
    .from("sprint_attempts")
    .select(
      "id, created_at, player_name, score, correct_count, attempted_count, max_streak, average_ms_per_question, accuracy_percent",
    )
    .eq("mode", "sixty_second_sprint")
    .order("score", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(10);

  if (error) {
    return NextResponse.json({ entries: [], configured: true, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ entries: data.map(mapAttemptRow), configured: true });
}
