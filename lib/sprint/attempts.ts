import { z } from "zod";

export const sprintAttemptSchema = z
  .object({
    playerName: z.string().trim().min(2).max(40).default("Guest"),
    score: z.number().int().min(0).max(100000),
    correctCount: z.number().int().min(0).max(240),
    attemptedCount: z.number().int().min(0).max(240),
    durationSeconds: z.literal(60),
    maxStreak: z.number().int().min(0).max(240).default(0),
    averageMsPerQuestion: z.number().int().min(0).max(60000).nullable(),
    clientMetadata: z
      .object({
        localBest: z.number().int().min(0).max(100000).optional(),
        userAgent: z.string().max(180).optional(),
      })
      .default({}),
  })
  .superRefine((attempt, context) => {
    if (attempt.correctCount > attempt.attemptedCount) {
      context.addIssue({
        code: "custom",
        message: "correctCount cannot exceed attemptedCount",
        path: ["correctCount"],
      });
    }

    if (attempt.maxStreak > attempt.correctCount) {
      context.addIssue({
        code: "custom",
        message: "maxStreak cannot exceed correctCount",
        path: ["maxStreak"],
      });
    }
  });

export type SprintAttemptInput = z.input<typeof sprintAttemptSchema>;

export type LeaderboardEntry = {
  id: string;
  createdAt: string;
  playerName: string;
  score: number;
  correctCount: number;
  attemptedCount: number;
  maxStreak: number;
  averageMsPerQuestion: number | null;
  accuracyPercent: number;
};

export function formatSprintAttemptError(error: unknown): string {
  if (error instanceof z.ZodError) {
    return error.issues[0]?.message ?? "Invalid attempt payload";
  }

  return error instanceof Error ? error.message : "Invalid attempt payload";
}

export function mapAttemptRow(row: {
  id: string;
  created_at: string;
  player_name: string;
  score: number;
  correct_count: number;
  attempted_count: number;
  max_streak: number;
  average_ms_per_question: number | null;
  accuracy_percent: number | string;
}): LeaderboardEntry {
  return {
    id: row.id,
    createdAt: row.created_at,
    playerName: row.player_name,
    score: row.score,
    correctCount: row.correct_count,
    attemptedCount: row.attempted_count,
    maxStreak: row.max_streak,
    averageMsPerQuestion: row.average_ms_per_question,
    accuracyPercent: Number(row.accuracy_percent),
  };
}
